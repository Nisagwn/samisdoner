import { Prisma, type Fulfillment, type OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildVatBreakdown, type PricedLine, type VatBucket } from "@/lib/admin/store";
import { InvalidTransitionError, canTransition } from "./status";

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
  /** Ödenmeyen sipariş bu andan sonra EXPIRED sayılır. */
  expiresAt: Date;
};

/**
 * Siparişi PENDING_PAYMENT durumunda açar.
 *
 * Tutar buraya **hesaplanmış olarak** gelir (bkz. `priceCart`); bu fonksiyon
 * fiyat hesaplamaz, yalnızca gelen tutarı dondurur.
 */
export async function createOrder(data: CreateOrderData) {
  const extraCents = data.serviceFeeCents + data.deliveryFeeCents;
  const vatBreakdown: VatBucket[] = buildVatBreakdown(data.lines, extraCents);
  const totalCents = data.subtotalCents + extraCents;

  return prisma.$transaction(async (tx) => {
    const orderNo = await nextOrderNo(tx);

    return tx.order.create({
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
        subtotalCents: data.subtotalCents,
        serviceFeeCents: data.serviceFeeCents,
        deliveryFeeCents: data.deliveryFeeCents,
        totalCents,
        vatBreakdown: vatBreakdown as unknown as Prisma.InputJsonValue,
        paymentMethod: "ONLINE",
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
  });
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
      select: { id: true, status: true, email: true, etaMinutes: true },
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
    const promisedAt =
      order.etaMinutes && order.etaMinutes > 0
        ? new Date(Date.now() + order.etaMinutes * 60_000)
        : null;

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        paymentStatus: "PAID",
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
