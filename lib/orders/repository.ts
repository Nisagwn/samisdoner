import {
  Prisma,
  type Fulfillment,
  type OrderStatus,
  type PaymentMethod,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { CACHE_KEYS, invalidate } from "@/lib/cache";
import type { PricedLine, VatBucket } from "@/lib/admin/store";
import type { DiscountLine } from "./campaign";
import { redeemCoupon } from "./coupons";
import { InvalidTransitionError, canTransition } from "./status";
import { composeTotals } from "./totals";

/**
 * Sipariş kayıtlarının veritabanı katmanı.
 *
 * İki kural burada uygulanır:
 *  - Sipariş satırı bir **anlık görüntüdür**. Ürünün o andaki adı, birim fiyatı
 *    ve KDV oranı satıra kopyalanır; ürün sonradan değişse veya silinse bile
 *    sipariş olduğu gibi kalır.
 *  - Durum geçmişi **append-only**. Her geçiş bir OrderEvent yazar; kayıt
 *    güncellenmez, silinmez (GoBD).
 */

/* -------------------------------------------------------- sipariş numarası */

/** Europe/Berlin'e göre "260907" — sayaç anahtarı ve numaranın gün parçası. */
function berlinDayKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

/**
 * Sıradaki sipariş numarası: "SD-260907-001".
 *
 * Sıralılık GoBD açısından istenen bir özelliktir; zaman damgasından türetilen
 * rastgele numaralar hem çakışabilir hem de boşluk denetimine izin vermez.
 *
 * Aynı gün ilk siparişte iki istek yarışırsa upsert P2002 ile düşebilir;
 * o durumda satır artık var demektir, tekrar denemek yeter.
 */
async function nextOrderNo(tx: Prisma.TransactionClient, now: Date = new Date()): Promise<string> {
  const day = berlinDayKey(now);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const counter = await tx.orderCounter.upsert({
        where: { day },
        create: { day, seq: 1 },
        update: { seq: { increment: 1 } },
      });
      return `SD-${day}-${String(counter.seq).padStart(3, "0")}`;
    } catch (error) {
      const conflict =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!conflict || attempt === 2) throw error;
    }
  }
  throw new Error("Sipariş numarası üretilemedi.");
}

/* -------------------------------------------------------------- oluşturma */

export type CreateOrderData = {
  /**
   * Siparişi veren hesap. **Misafir siparişinde null.** Üyelik hiçbir zaman
   * zorunlu değildir; bu alan yalnızca "hesabımın siparişleri" listesini
   * mümkün kılar.
   */
  customerId: string | null;
  lines: PricedLine[];
  subtotalCents: number;
  serviceFeeCents: number;
  deliveryFeeCents: number;
  /**
   * **Sepet** indirimi (yüzde / sabit kampanya), pozitif cent; yoksa 0.
   * Ürün indirimleri `lineDiscountCents` ile ayrı gelir.
   */
  discountCents: number;
  /** Satır başına ürün indirimi (ayın ürünü, menü fiyatı); `lines` ile aynı sırada. */
  lineDiscountCents?: number[];
  /**
   * Uygulanan kampanyalar. Her biri için kullanım kaydı yazılır ve döküm
   * siparişe dondurulur (`Order.discountLines`).
   */
  campaigns?: {
    id: string;
    code: string;
    titleDe: string;
    titleTr: string;
    amountCents: number;
  }[];
  /** Kabul edilen kodun kendisi; kod yoksa boş. */
  couponCode: string;
  /** Bahşiş (pozitif cent). Toplama eklenir, KDV matrahına girmez. */
  tipCents: number;
  /**
   * Ödeme yöntemi. ONLINE'da Stripe oturumu açılır; CASH ve
   * CARD_ON_DELIVERY'de para kapıda alınır ve sipariş ödeme beklemeden
   * mutfağa düşer (bkz. `placeOnSiteOrder`).
   */
  paymentMethod: PaymentMethod;
  fulfillment: Fulfillment;
  lang: string;
  customerName: string;
  phone: string;
  email: string;
  street: string;
  houseNo: string;
  floor: string;
  bellName: string;
  zip: string;
  city: string;
  note: string;
  requestedAt: Date | null;
  /**
   * Sipariş anındaki tahmini süre (dk). Ödeme onaylandığında bundan
   * `promisedAt` türetilir; bölge ayarı sonradan değişse bile bu siparişe
   * verilen söz değişmez.
   */
  etaMinutes: number | null;
  /**
   * Ödenmeyen sipariş bu andan sonra EXPIRED sayılır.
   *
   * Kapıda ödemede **null**: ödeme penceresi diye bir şey yok, sipariş
   * beklenecek bir tahsilat olmadan mutfağa düşüyor. Bakım görevi de yalnızca
   * `expiresAt` dolu olan PENDING_PAYMENT satırlarına bakar.
   */
  expiresAt: Date | null;
};

/**
 * Siparişi PENDING_PAYMENT durumunda açar.
 *
 * Tutar buraya **hesaplanmış olarak** gelir (bkz. `priceCart`); bu fonksiyon
 * fiyat hesaplamaz, yalnızca gelen tutarı dondurur.
 */
export async function createOrder(data: CreateOrderData) {
  /*
   * Toplam ve KDV dökümü, müşteriye gösterilen teklifle **aynı fonksiyondan**
   * (`composeTotals`) çıkar. İki ayrı toplama işlemi olsaydı, kupon ya da
   * bahşiş eklenirken biri güncellenip diğeri unutulabilir ve ekranda yazan
   * tutarla tahsil edilen tutar sessizce ayrışabilirdi.
   */
  const totals = composeTotals({
    lines: data.lines,
    subtotalCents: data.subtotalCents,
    serviceFeeCents: data.serviceFeeCents,
    deliveryFeeCents: data.deliveryFeeCents,
    discountCents: data.discountCents,
    lineDiscountCents: data.lineDiscountCents,
    tipCents: data.tipCents,
  });
  const vatBreakdown: VatBucket[] = totals.vatBreakdown;
  const totalCents = totals.totalCents;

  const campaigns = (data.campaigns ?? []).filter((campaign) => campaign.amountCents > 0);
  const discountLines: DiscountLine[] = campaigns.map((campaign) => ({
    code: campaign.code,
    title: campaign.titleDe,
    titleTr: campaign.titleTr,
    amountCents: campaign.amountCents,
  }));

  const order = await prisma.$transaction(async (tx) => {
    const orderNo = await nextOrderNo(tx);

    const order = await tx.order.create({
      data: {
        orderNo,
        status: "PENDING_PAYMENT",
        customerId: data.customerId,
        fulfillment: data.fulfillment,
        lang: data.lang,
        customerName: data.customerName,
        phone: data.phone,
        email: data.email,
        street: data.street,
        houseNo: data.houseNo,
        floor: data.floor,
        bellName: data.bellName,
        zip: data.zip,
        city: data.city,
        note: data.note,
        requestedAt: data.requestedAt,
        etaMinutes: data.etaMinutes,
        subtotalCents: totals.subtotalCents,
        serviceFeeCents: totals.serviceFeeCents,
        deliveryFeeCents: totals.deliveryFeeCents,
        discountCents: totals.discountCents,
        couponCode: totals.discountCents > 0 ? data.couponCode : "",
        discountLines: discountLines as unknown as Prisma.InputJsonValue,
        tipCents: totals.tipCents,
        totalCents,
        vatBreakdown: vatBreakdown as unknown as Prisma.InputJsonValue,
        paymentMethod: data.paymentMethod,
        paymentStatus: "PENDING",
        expiresAt: data.expiresAt,
        lines: {
          create: data.lines.map((line) => ({
            productId: line.input.productId,
            /* Tek satır türü kaldı; `BUILDER` yalnızca eski kayıtlarda geçer. */
            kind: "PRODUCT",
            label: line.label,
            detail: line.detail,
            unitCents: line.unitCents,
            qty: line.qty,
            lineCents: line.lineCents,
            vatRate: line.vatRate,
            options: line.input as unknown as Prisma.InputJsonValue,
          })),
        },
        events: {
          create: { to: "PENDING_PAYMENT", actor: "customer" },
        },
      },
      include: { lines: true },
    });

    /*
     * Kampanya kullanımları **aynı işlemin içinde** yazılır.
     *
     * Kullanım sayılamıyorsa (kampanya bu arada tükendi, kapatıldı) işlem
     * baştan düşer ve sipariş hiç oluşmaz. Alternatifi, indirimi uygulanmış
     * ama kullanımı sayılmamış bir sipariş bırakmaktı: 50 kullanımlık bir
     * kampanyanın 60 kez indirim yapması demek.
     */
    for (const campaign of campaigns) {
      const redeemed = await redeemCoupon(tx, {
        couponId: campaign.id,
        orderId: order.id,
        amountCents: campaign.amountCents,
      });
      if (!redeemed) throw new CouponUnavailableError(campaign.code);
    }

    return order;
  });

  // Kullanım sayaçları değişti; önbellekteki otomatik kampanya listesi
  // tükenmiş bir kampanyayı gereğinden uzun açık göstermesin.
  if (campaigns.length > 0) await invalidate(CACHE_KEYS.campaigns);

  return order;
}

/**
 * Sipariş yazılırken bir kampanyanın elden kaçtığını bildirir.
 *
 * Teklif hesaplandığında geçerliydi; sipariş yazılana kadar geçen saniyelerde
 * son kullanım hakkı başkasına gitti. Bu bir sunucu arızası değil, yarışın
 * kaybeden tarafı. `code` boşsa kaçan kampanya otomatiktir (müşterinin
 * kaldıracağı bir kod yok, yalnızca yeni tutarı görmesi gerekir).
 */
export class CouponUnavailableError extends Error {
  constructor(readonly code: string) {
    super(`Kampanya kullanılamadı: ${code || "(otomatik)"}`);
    this.name = "CouponUnavailableError";
  }

  get automatic(): boolean {
    return this.code === "";
  }
}

/* ------------------------------------------------------------------ okuma */

const orderInclude = {
  lines: true,
  events: { orderBy: { at: "asc" } },
  payments: { include: { refunds: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithDetails = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export async function getOrderByNo(orderNo: string): Promise<OrderWithDetails | null> {
  return prisma.order.findUnique({ where: { orderNo }, include: orderInclude });
}

export async function getOrderById(id: string): Promise<OrderWithDetails | null> {
  return prisma.order.findUnique({ where: { id }, include: orderInclude });
}

/* --------------------------------------------------------------- geçişler */

/** Duruma karşılık gelen zaman damgası — panelde süre takibi için. */
function timestampFor(to: OrderStatus): Prisma.OrderUpdateInput {
  const now = new Date();
  switch (to) {
    case "ACCEPTED":
      return { acceptedAt: now };
    case "READY":
      return { readyAt: now };
    case "DELIVERED":
    case "PICKED_UP":
      return { deliveredAt: now };
    case "CANCELLED":
    case "REJECTED":
      return { cancelledAt: now };
    default:
      return {};
  }
}

/**
 * Sipariş durumunu değiştirir ve geçmişe yazar.
 *
 * Geçerli olmayan geçiş `InvalidTransitionError` fırlatır — panelde iki kez
 * tıklanan bir buton siparişi tutarsız bir duruma sokamaz.
 */
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  actor: string,
  options: { reason?: string; meta?: Prisma.InputJsonValue } = {}
): Promise<OrderWithDetails> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, fulfillment: true },
    });
    if (!order) throw new Error("Sipariş bulunamadı.");

    if (!canTransition(order.status, to, order.fulfillment)) {
      throw new InvalidTransitionError(order.status, to);
    }

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: to,
        ...timestampFor(to),
        ...(options.reason ? { cancelReason: options.reason } : {}),
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId,
        from: order.status,
        to,
        actor,
        ...(options.meta ? { meta: options.meta } : {}),
      },
    });

    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
  });
}

/**
 * Ödemeyi kaydeder ve siparişi PAID'e taşır.
 *
 * **İdempotent olmak zorundadır**: Stripe aynı olayı 72 saat boyunca yeniden
 * gönderebilir. Sipariş zaten PENDING_PAYMENT değilse hiçbir şey yapılmaz ve
 * mevcut kayıt döner; ikinci kez ödeme satırı yazılmaz, ikinci kez bildirim
 * gönderilmez (çağıran taraf `alreadyPaid` bayrağına bakar).
 */
export async function markOrderPaid(input: {
  orderNo: string;
  provider: string;
  providerRef: string;
  amountCents: number;
  method: string | null;
  email?: string;
  raw?: Prisma.InputJsonValue;
  /**
   * Olay geçmişine yazılacak kaynak: "stripe" (webhook) ya da "stripe:sync"
   * (müşteri ödeme sayfasından döndüğünde yapılan mutabakat).
   *
   * Önceden ikisi de `provider` değeriyle, yani "stripe" olarak yazılıyordu ve
   * ayrım yalnızca `console.info` satırındaydı — yani günlükler döndükten
   * sonra kayboluyordu. Webhook'un çalışmadığı bir dönemde siparişlerin
   * mutabakatla kapandığını fark etmenin tek yolu bu alan.
   */
  actor?: string;
}): Promise<{ order: OrderWithDetails; alreadyPaid: boolean }> {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { orderNo: input.orderNo },
      select: { id: true, status: true, email: true, etaMinutes: true, requestedAt: true },
    });
    if (!order) throw new Error(`Sipariş bulunamadı: ${input.orderNo}`);

    if (order.status !== "PENDING_PAYMENT") return { id: order.id, alreadyPaid: true };

    await tx.payment.upsert({
      where: {
        provider_providerRef: { provider: input.provider, providerRef: input.providerRef },
      },
      create: {
        orderId: order.id,
        provider: input.provider,
        providerRef: input.providerRef,
        amountCents: input.amountCents,
        status: "PAID",
        method: input.method,
        paidAt: new Date(),
        ...(input.raw ? { raw: input.raw } : {}),
      },
      update: { status: "PAID", method: input.method, paidAt: new Date() },
    });

    /*
     * Teslim saati burada — ödeme onaylandığı an — dondurulur.
     *
     * Sipariş oluşturulurken değil, çünkü müşteri Stripe sayfasında 20 dakika
     * oyalanabilir; o durumda sipariş yazıldığı ana göre hesaplanmış bir saat
     * doğduğu anda yanlış olurdu. Mutfağın saati ödemeyi gördüğünde başlar.
     *
     * `etaMinutes` boşsa (bölge süresi tanımsız) söz de verilmez: yanlış saat
     * söylemek, saat söylememekten kötüdür.
     */
    const promisedAt = promiseFor(order);

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        paymentStatus: "PAID",
        paidAt: new Date(),
        ...(promisedAt ? { promisedAt } : {}),
        // Müşteri formda e-posta vermediyse Stripe'ın topladığı adres yazılır.
        ...(order.email === "" && input.email ? { email: input.email } : {}),
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        from: "PENDING_PAYMENT",
        to: "PAID",
        actor: input.actor ?? input.provider,
        meta: { providerRef: input.providerRef, method: input.method },
      },
    });

    return { id: order.id, alreadyPaid: false };
  });

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: result.id },
    include: orderInclude,
  });
  return { order, alreadyPaid: result.alreadyPaid };
}

/**
 * Siparişe verilecek teslim sözü.
 *
 * İleri saatli siparişte (Vorbestellung) söz **müşterinin seçtiği saattir**:
 * saat 15:00'te akşam 20:00'ye sipariş veren müşteriye "15:40'ta oradayız"
 * demek anlamsız. Hemen teslimatta ise söz, ödemenin onaylandığı ana tahmini
 * süre eklenerek kurulur — mutfağın saati parayı gördüğünde başlar.
 *
 * `etaMinutes` boşsa (bölge süresi tanımsız) söz de verilmez: yanlış saat
 * söylemek, saat söylememekten kötüdür.
 */
function promiseFor(order: { etaMinutes: number | null; requestedAt: Date | null }): Date | null {
  if (order.requestedAt) return order.requestedAt;
  if (!order.etaMinutes || order.etaMinutes <= 0) return null;
  return new Date(Date.now() + order.etaMinutes * 60_000);
}

/**
 * Kapıda ödenecek siparişi mutfağa düşürür.
 *
 * NEDEN AYRI BİR YOL
 *
 * Nakit ve kapıda kart ödemesinde tahsilat teslim anında oluyor; beklenecek
 * bir webhook, açılacak bir Stripe oturumu ve dolayısıyla `Payment` satırı
 * yok. Ama siparişin geri kalanı birebir aynı: mutfak görmeli, müşteri takip
 * edebilmeli, e-postalar gitmeli.
 *
 * Bu yüzden sipariş **durumu** PAID'e taşınır (akış olarak "alındı, kuyrukta"),
 * ama **ödeme durumu** PENDING'te bırakılır: para henüz alınmadı ve muhasebe
 * tarafında alınmış görünmemeli. İkisinin ayrı alanlar olması tam olarak bunun
 * içindi.
 *
 * İdempotency `markOrderPaid` ile aynı kuralda: sipariş zaten PENDING_PAYMENT
 * değilse hiçbir şey yazılmaz ve `alreadyPlaced` ile dönülür. Çift tıklanan
 * bir düğme mutfağa iki fiş basmaz.
 */
export async function placeOnSiteOrder(input: {
  orderNo: string;
  method: PaymentMethod;
  actor: string;
}): Promise<{ order: OrderWithDetails; alreadyPlaced: boolean }> {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { orderNo: input.orderNo },
      select: { id: true, status: true, etaMinutes: true, requestedAt: true },
    });
    if (!order) throw new Error(`Sipariş bulunamadı: ${input.orderNo}`);

    if (order.status !== "PENDING_PAYMENT") return { id: order.id, alreadyPlaced: true };

    const promisedAt = promiseFor(order);

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        paymentMethod: input.method,
        // Para kapıda alınacak: ödeme durumu beklemede kalır.
        paymentStatus: "PENDING",
        paidAt: new Date(),
        ...(promisedAt ? { promisedAt } : {}),
        // Ödeme penceresi yok; bakım görevi bu siparişi süresi dolmuş sayamaz.
        expiresAt: null,
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        from: "PENDING_PAYMENT",
        to: "PAID",
        actor: input.actor,
        meta: { paymentMethod: input.method, settlement: "on_site" },
      },
    });

    return { id: order.id, alreadyPlaced: false };
  });

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: result.id },
    include: orderInclude,
  });
  return { order, alreadyPlaced: result.alreadyPlaced };
}

/**
 * Söz verilen teslim saatini öteler — panelden bilinçli gecikme bildirimi.
 *
 * Tek yazma yolu budur: `promisedAt` başka hiçbir yerde güncellenmez. Mutfak
 * geciktiğini biliyorsa müşteri bunu takip sayfasında görmeli; sessizce geçen
 * bir saat, kayan bir saatten daha çok şikâyet üretir.
 *
 * Geçmişi bozmamak için hareket `OrderEvent` olarak da yazılır (durum
 * değişmediği için `from`/`to` aynı kalır — bu bir durum geçişi değil, bir
 * bildirimdir).
 */
export async function delayOrderPromise(
  orderId: string,
  minutes: number,
  actor: string
): Promise<OrderWithDetails | null> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, promisedAt: true },
    });
    if (!order) throw new Error("Sipariş bulunamadı.");

    /*
     * Söz verilmemiş bir saat ötelenemez — ödeme henüz onaylanmamış demektir.
     * Bu bir sunucu arızası değil, eskimiş bir panel görünümünde iki kez
     * tıklanmış bir düğme; fırlatmak yerine `null` döner ve çağıran taraf
     * 409 ile karşılar.
     */
    if (!order.promisedAt) return null;

    const next = new Date(order.promisedAt.getTime() + minutes * 60_000);

    await tx.order.update({ where: { id: orderId }, data: { promisedAt: next } });
    await tx.orderEvent.create({
      data: {
        orderId,
        from: order.status,
        to: order.status,
        actor,
        meta: { delayMinutes: minutes, promisedAt: next.toISOString() },
      },
    });

    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
  });
}

/**
 * Ödenmeden bekleyen siparişleri süresi dolmuş olarak işaretler.
 *
 * Müşteri Stripe sayfasını kapatıp geri dönmezse sipariş sonsuza kadar
 * "ödeme bekleniyor"da kalmasın; panelde çöp birikmesin.
 */
export async function expireStaleOrders(now: Date = new Date()): Promise<number> {
  const stale = await prisma.order.findMany({
    where: { status: "PENDING_PAYMENT", expiresAt: { lt: now } },
    select: { id: true },
  });

  for (const { id } of stale) {
    await transitionOrder(id, "EXPIRED", "system");
  }
  return stale.length;
}
