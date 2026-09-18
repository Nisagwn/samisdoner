import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CACHE_KEYS, cached, invalidate } from "@/lib/cache";
import {
  REVIEW_WINDOW_DAYS,
  asksDeliveryRating,
  averageRating,
  displayName,
  reviewEligibility,
  reviewOpensAt,
} from "./eligibility";
import {
  EMPTY_PRODUCT_SUMMARY,
  groupReviewsByProduct,
  type ProductReviewSummary,
} from "./products";
import type { ReviewSubmitInput } from "./schema";

/**
 * Değerlendirmelerin veri katmanı.
 *
 * Uygunluk kararı burada verilmez, `eligibility.ts` verir; burada yalnızca o
 * kararın ihtiyaç duyduğu veri toplanır ve sonucu yazılır. Ayrım, kuralın
 * veritabanısız kalmasını ve test edilebilmesini sağlıyor.
 */

/* ────────────────────────────────────────── müşteri tarafı: bekleyenler */

/**
 * Değerlendirilen siparişin bir satırı.
 *
 * Müşteri "hangi siparişi" değil "hangi yemeği" hatırlar: sipariş numarası
 * tek başına hiçbir şey anlatmaz. Satırlar tek tek verilir ki ekran onları
 * ürüne götüren bağlantılar hâline getirebilsin.
 *
 * `productId` boş olabilir: katalogdan silinmiş ya da ürüne bağlı olmayan
 * (teslimat ücreti gibi) satırlarda bağlantı kurulamaz — o satır düz metin
 * kalır. Sipariş satırı ürünün anlık görüntüsüdür, ürünün kendisi değil.
 */
export type ReviewedItem = {
  productId: string | null;
  label: string;
  qty: number;
};

export type PendingReview = {
  orderNo: string;
  /** Sipariş tarihi, müşterinin hangi akşamdan bahsettiğini bilmesi için. */
  placedAt: string;
  /** Kısa özet: "2× Döner Teller, 1× Ayran". */
  summary: string;
  /** Aynı özetin satırlara ayrılmış hâli; ürüne bağlantı kurmak için. */
  items: ReviewedItem[];
  totalCents: number;
  /** Teslimat puanı sorulacak mı — gel-alda sorulmaz. */
  asksDelivery: boolean;
  /** Pencere bu tarihte kapanır; müşteriye "… tarihine kadar" denir. */
  closesAt: string;
};

/**
 * Henüz değerlendirilmemiş, değerlendirilebilir siparişler.
 *
 * Yalnızca pencerede olanlar döner: kapanmış bir pencereyi listede tutup
 * tıklandığında reddetmek, kullanıcıya sebepsiz bir hayal kırıklığı yaşatır.
 */
export async function listPendingReviews(
  customerId: string,
  now: Date = new Date()
): Promise<PendingReview[]> {
  const since = new Date(now.getTime() - REVIEW_WINDOW_DAYS * 24 * 60 * 60_000);

  const orders = await prisma.order.findMany({
    where: {
      customerId,
      status: { in: ["DELIVERED", "PICKED_UP"] },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      orderNo: true,
      status: true,
      fulfillment: true,
      createdAt: true,
      deliveredAt: true,
      totalCents: true,
      lines: {
        select: { label: true, qty: true, productId: true },
        orderBy: { id: "asc" },
        take: CUSTOMER_ITEM_LIMIT,
      },
    },
  });
  if (orders.length === 0) return [];

  // Tek sorguda hangi siparişlerin zaten değerlendirildiğini öğren: sipariş
  // başına ayrı sorgu, yirmi siparişte yirmi gidiş-dönüş demekti.
  const reviewed = new Set(
    (
      await prisma.review.findMany({
        where: { orderId: { in: orders.map((order) => order.id) } },
        select: { orderId: true },
      })
    ).map((row) => row.orderId)
  );

  return orders.flatMap((order) => {
    const eligible = reviewEligibility(order, now, reviewed.has(order.id));
    if (!eligible.ok) return [];

    return [
      {
        orderNo: order.orderNo,
        placedAt: order.createdAt.toISOString(),
        summary: order.lines.map((line) => `${line.qty}× ${line.label}`).join(", "),
        items: order.lines.map((line) => ({
          productId: line.productId,
          label: line.label,
          qty: line.qty,
        })),
        totalCents: order.totalCents,
        asksDelivery: asksDeliveryRating(order.fulfillment),
        closesAt: new Date(
          (order.deliveredAt ?? order.createdAt).getTime() +
            REVIEW_WINDOW_DAYS * 24 * 60 * 60_000
        ).toISOString(),
      },
    ];
  });
}

/* ───────────────────────────────────────────── müşteri tarafı: yazma */

export type SubmitResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "not_completed" | "too_early" | "window_closed" | "already_reviewed";
      /** "too_early" için: ne zaman açılacağı. */
      opensAt?: string;
    };

/**
 * Değerlendirmeyi yazar.
 *
 * Sipariş **oturumdaki müşterinin kimliğiyle birlikte** aranır. Yalnızca
 * sipariş numarasıyla aramak, numarayı tahmin eden birinin başkasının siparişi
 * adına yorum yazmasına izin verirdi — numaralar gün içinde sıralı ve tahmin
 * edilebilir (bkz. lib/orders/token.ts'deki aynı gerekçe).
 */
export async function submitReview(
  customerId: string,
  customerName: string,
  input: ReviewSubmitInput,
  now: Date = new Date()
): Promise<SubmitResult> {
  const order = await prisma.order.findFirst({
    where: { orderNo: input.orderNo, customerId },
    select: {
      id: true,
      orderNo: true,
      status: true,
      fulfillment: true,
      createdAt: true,
      deliveredAt: true,
      lang: true,
    },
  });
  if (!order) return { ok: false, reason: "not_found" };

  const existing = await prisma.review.findUnique({
    where: { orderId: order.id },
    select: { id: true },
  });

  const eligible = reviewEligibility(order, now, existing !== null);
  if (!eligible.ok) {
    return {
      ok: false,
      reason: eligible.reason,
      ...(eligible.reason === "too_early"
        ? { opensAt: reviewOpensAt(order).toISOString() }
        : {}),
    };
  }

  const de = order.lang !== "tr";

  try {
    await prisma.review.create({
      data: {
        orderId: order.id,
        orderNo: order.orderNo,
        customerId,
        foodRating: input.foodRating,
        /*
         * Teslimat puanı siparişin biçimine göre belirlenir, istemcinin
         * gönderdiğine göre değil: gel-al siparişte gönderilmiş bir puan
         * olmayan bir teslimatı ölçer ve ortalamayı kirletir.
         */
        deliveryRating: asksDeliveryRating(order.fulfillment)
          ? (input.deliveryRating ?? null)
          : null,
        comment: input.comment,
        // Ad yazma anında dondurulur: müşteri adını sonradan değiştirse ya da
        // hesabı anonimleştirilse bile yayımlanmış yorumun altındaki ad
        // değişmemeli.
        authorName: displayName(customerName, de),
        lang: order.lang,
      },
    });
    // Yeni yorum ortalamayı değiştirir; site bayat bir sayı göstermesin.
    await invalidateReviews();
    return { ok: true };
  } catch (error) {
    // Aynı siparişe iki sekmeden aynı anda gönderilen iki form: UNIQUE kısıt
    // ikincisini reddeder ve bu bir sunucu hatası değil.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, reason: "already_reviewed" };
    }
    throw error;
  }
}

/**
 * Müşterinin kendi yazdıkları — hesabında görebilmeli.
 *
 * Yazılan her değerlendirmenin yanında **hangi yemeğe** verildiği de döner:
 * listede yalnızca sipariş numarası olsaydı müşteri kendi yorumunu okuyup
 * neye yazdığını hatırlayamazdı. Satırlar ikinci bir sorguda, hepsi birden
 * alınır — değerlendirme başına ayrı sorgu otuz gidiş-dönüş demekti.
 */
export async function listOwnReviews(customerId: string) {
  const reviews = await prisma.review.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      orderId: true,
      orderNo: true,
      foodRating: true,
      deliveryRating: true,
      comment: true,
      reply: true,
      repliedAt: true,
      published: true,
      createdAt: true,
    },
  });
  return attachItems(reviews, CUSTOMER_ITEM_LIMIT);
}

/**
 * Siparişlerin değerlendirmede gösterilecek satırları, sipariş kimliğine göre.
 *
 * Satır türüne bakılmaz: `OrderLine` yalnızca ürünleri tutar, teslimat ücreti
 * ve bahşiş siparişin kendi alanlarında durur (bkz. `Order.deliveryFeeCents`).
 *
 * `perOrder` müşteri ekranında dört, panelde daha yüksek: müşteriye kendi
 * siparişini hatırlatmaya birkaç satır yeter ve uzun bir liste asıl işi
 * (yıldız vermek) aşağı iter; panelde ise soru "müşteri neyi puanladı" ve
 * eksik bir liste o soruyu yarım bırakır.
 */
async function reviewedItemsByOrder(
  orderIds: string[],
  perOrder: number
): Promise<Map<string, ReviewedItem[]>> {
  const lines = await prisma.orderLine.findMany({
    where: { orderId: { in: orderIds } },
    orderBy: { id: "asc" },
    select: { orderId: true, productId: true, label: true, qty: true },
  });

  const map = new Map<string, ReviewedItem[]>();
  for (const line of lines) {
    const list = map.get(line.orderId) ?? [];
    if (list.length < perOrder) {
      list.push({ productId: line.productId, label: line.label, qty: line.qty });
    }
    map.set(line.orderId, list);
  }
  return map;
}

/** Değerlendirme satırlarına siparişin ürünlerini ekler. */
async function attachItems<T extends { orderId: string }>(
  rows: T[],
  perOrder: number
): Promise<(T & { items: ReviewedItem[] })[]> {
  if (rows.length === 0) return [];
  const map = await reviewedItemsByOrder(
    rows.map((row) => row.orderId),
    perOrder
  );
  return rows.map((row) => ({ ...row, items: map.get(row.orderId) ?? [] }));
}

/** Müşteri ekranında bir siparişten gösterilen en fazla ürün satırı. */
const CUSTOMER_ITEM_LIMIT = 4;
/** Panelde gösterilen en fazla ürün satırı; siparişlerin neredeyse tamamı sığar. */
const ADMIN_ITEM_LIMIT = 20;

/* ─────────────────────────────────────────────────────── site tarafı */

export type PublicReview = {
  id: string;
  authorName: string;
  foodRating: number;
  deliveryRating: number | null;
  comment: string;
  reply: string;
  createdAt: string;
};

export type ReviewSummary = {
  /** Yemek puanlarının ortalaması; hiç yorum yoksa null. */
  average: number | null;
  /** Teslimat puanlarının ortalaması; yalnızca dolu olanlardan. */
  deliveryAverage: number | null;
  count: number;
  /** 5→1 yıldız dağılımı; `distribution[5]` beş yıldız sayısı. */
  distribution: Record<number, number>;
  items: PublicReview[];
};

/**
 * Sitede gösterilecek değerlendirmeler ve özet.
 *
 * Yalnızca yayındakiler sayılır: gizlenmiş bir yorumun ortalamaya girmesi,
 * "gizledik ama puanı duruyor" gibi savunulamaz bir ara durum olurdu.
 *
 * Yorumsuz ama puanlı değerlendirmeler **ortalamaya girer, listede
 * görünmez**: gösterilecek bir cümlesi yoktur, ama verdiği puan gerçek bir
 * müşterinin gerçek puanıdır ve saymamak ortalamayı çarpıtır.
 */
/** Önbellek ömrü. Yeni bir yorumun sitede görünmesi için beş dakika yeter. */
const SUMMARY_TTL_SECONDS = 300;

/**
 * Önbellekli özet — sitenin okuduğu tek yol.
 *
 * Yorum yazıldığında ya da panelden gizlendiğinde anahtar düşürülür
 * (`invalidateReviews`), dolayısıyla beş dakika bir üst sınırdır, gecikmenin
 * kendisi değil.
 */
export async function getPublicReviews(limit = 8): Promise<ReviewSummary> {
  return cached(`${CACHE_KEYS.reviews}:${limit}`, SUMMARY_TTL_SECONDS, () =>
    getReviewSummary(limit)
  );
}

/**
 * Önbelleği düşürür.
 *
 * Liste uzunluğu anahtarın parçası olduğu için birkaç varyant oluşabilir;
 * hepsi tek tek düşürülür. Kullanılan uzunluklar sabit ve az — dinamik bir
 * desen silme (Redis `SCAN`) buradaki üç anahtar için fazla ağır olurdu.
 */
export async function invalidateReviews(): Promise<void> {
  await invalidate(
    ...[4, 6, 8, 12, 24].map((limit) => `${CACHE_KEYS.reviews}:${limit}`),
    PRODUCT_INDEX_KEY
  );
}

export async function getReviewSummary(limit = 8): Promise<ReviewSummary> {
  const rows = await prisma.review.findMany({
    where: { published: true },
    orderBy: { createdAt: "desc" },
    // Özet için tamamı gerekir; site ölçeğinde (yılda birkaç yüz yorum) bu
    // sorgu ucuz ve önbelleğe de alınıyor (bkz. çağıran taraf).
    select: {
      id: true,
      authorName: true,
      foodRating: true,
      deliveryRating: true,
      comment: true,
      reply: true,
      createdAt: true,
    },
  });

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) distribution[row.foodRating] += 1;

  const deliveryValues = rows
    .map((row) => row.deliveryRating)
    .filter((value): value is number => value !== null);

  return {
    average: averageRating(rows.map((row) => row.foodRating)),
    deliveryAverage: averageRating(deliveryValues),
    count: rows.length,
    distribution,
    items: rows
      .filter((row) => row.comment.length > 0)
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        authorName: row.authorName,
        foodRating: row.foodRating,
        deliveryRating: row.deliveryRating,
        comment: row.comment,
        reply: row.reply,
        createdAt: row.createdAt.toISOString(),
      })),
  };
}

/* ─────────────────────────────────────────── ürün başına değerlendirme */

/** Dizinin önbellek anahtarı; `invalidateReviews` bunu da düşürür. */
const PRODUCT_INDEX_KEY = `${CACHE_KEYS.reviews}:by-product`;

/**
 * Ürün kimliği → özet.
 *
 * Ürün başına ayrı sorgu yerine **tek seferde tüm dizin** kurulur: menüde
 * altmışa yakın ürün var, penceresi açılan her ürün için iki sorgu atmak aynı
 * iki sorguyu altmış kez tekrarlamak demekti. Site ölçeğinde (yılda birkaç yüz
 * yorum) tüm yorumları okumak zaten ucuz ve sonuç önbellekte.
 *
 * Puanın ürüne değil siparişe ait olduğu ve dağıtımın nasıl yapıldığı
 * `lib/reviews/products.ts` içinde yazılı.
 */
export async function getProductReviewIndex(): Promise<Record<string, ProductReviewSummary>> {
  return cached(PRODUCT_INDEX_KEY, SUMMARY_TTL_SECONDS, buildProductReviewIndex);
}

/** Tek ürünün özeti; hiç değerlendirme yoksa boş özet (null değil). */
export async function getProductReviews(productId: string): Promise<ProductReviewSummary> {
  if (!productId) return EMPTY_PRODUCT_SUMMARY;
  const index = await getProductReviewIndex();
  return index[productId] ?? EMPTY_PRODUCT_SUMMARY;
}

async function buildProductReviewIndex(): Promise<Record<string, ProductReviewSummary>> {
  const reviews = await prisma.review.findMany({
    where: { published: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      orderId: true,
      authorName: true,
      foodRating: true,
      deliveryRating: true,
      comment: true,
      reply: true,
      createdAt: true,
    },
  });
  if (reviews.length === 0) return {};

  const lines = await prisma.orderLine.findMany({
    where: { orderId: { in: reviews.map((review) => review.orderId) }, productId: { not: null } },
    select: { orderId: true, productId: true },
  });

  return groupReviewsByProduct(
    reviews.map((review) => ({ ...review, createdAt: review.createdAt.toISOString() })),
    lines
  );
}

/* ────────────────────────────────────────────────────── panel tarafı */

/**
 * Panelin okuduğu alanlar.
 *
 * Tek yerde duruyor çünkü listeyle iki yazma ucu (cevap, görünürlük) **aynı
 * şekli** döndürmek zorunda: istemci gelen kaydı listedekinin yerine koyuyor,
 * eksik bir alan o satırı ekranda sessizce fakirleştirirdi.
 */
const adminSelection = {
  id: true,
  /// Ürünleri çekmek için; panele gösterilmez.
  orderId: true,
  orderNo: true,
  authorName: true,
  foodRating: true,
  deliveryRating: true,
  comment: true,
  reply: true,
  repliedAt: true,
  repliedBy: true,
  published: true,
  hiddenReason: true,
  lang: true,
  createdAt: true,
} as const;

/**
 * Panel listesi.
 *
 * Her satırda siparişin **ürünleri** de gelir: "üç yıldız" tek başına
 * cevaplanabilir bir bilgi değil, "neye üç yıldız" cevaplanabilir. Sipariş
 * numarasına bakıp ayrı bir ekrandan siparişi bulmak, gün içinde onlarca
 * yorumu gözden geçiren biri için yapılmayacak kadar uzun bir yol.
 */
export async function listReviewsForAdmin(take = 100) {
  return attachItems(
    await prisma.review.findMany({
      orderBy: { createdAt: "desc" },
      take,
      select: adminSelection,
    }),
    ADMIN_ITEM_LIMIT
  );
}

export type AdminReview = Awaited<ReturnType<typeof listReviewsForAdmin>>[number];

/**
 * İşletmenin cevabını yazar ya da siler.
 *
 * Boş metin cevabı kaldırır: yanlış yazılmış bir cevabı geri almanın başka
 * yolu olmamalı diye ayrı bir uç açmanın anlamı yok.
 */
export async function replyToReview(
  id: string,
  reply: string,
  actor: string
): Promise<AdminReview | null> {
  const exists = await prisma.review.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;

  const updated = await prisma.review.update({
    where: { id },
    data: reply
      ? { reply, repliedAt: new Date(), repliedBy: actor }
      : { reply: "", repliedAt: null, repliedBy: "" },
    select: adminSelection,
  });

  // Cevap sitede yorumun altında görünür: önbellek düşmezse beş dakika
  // boyunca cevapsız görünmeye devam eder.
  await invalidateReviews();
  return withAdminItems(updated);
}

/**
 * Yorumu gizler ya da yayına alır.
 *
 * Silme yok — bilinçli. Silinebilir olsaydı "yalnızca iyi yorumlar duruyor"
 * şüphesi haklı olurdu ve UWG § 5b Abs. 3'ün istediği teminat da anlamını
 * yitirirdi. Gizlenen yorum ortalamadan da düşer ve gizlenme sebebi kayda
 * yazılır: karar sonradan savunulabilir olmalı.
 */
export async function setReviewVisibility(
  id: string,
  published: boolean,
  hiddenReason: string
): Promise<AdminReview | null> {
  const exists = await prisma.review.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;

  const updated = await prisma.review.update({
    where: { id },
    data: { published, hiddenReason: published ? "" : hiddenReason },
    select: adminSelection,
  });

  // Görünürlük değişimi hem listeyi hem de ortalamayı etkiler.
  await invalidateReviews();
  return withAdminItems(updated);
}

/** Tek kaydı panelin beklediği şekle getirir (liste ile aynı olsun diye). */
async function withAdminItems<T extends { orderId: string }>(
  row: T
): Promise<T & { items: ReviewedItem[] }> {
  const [withItems] = await attachItems([row], ADMIN_ITEM_LIMIT);
  return withItems;
}
