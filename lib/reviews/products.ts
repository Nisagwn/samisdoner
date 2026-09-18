import { averageRating } from "./eligibility";

/**
 * Sipariş değerlendirmelerinin ürünlere dağıtılması.
 *
 * ÖNEMLİ — BURADAKİ PUAN ÜRÜNÜN DEĞİL, SİPARİŞİN PUANIDIR.
 *
 * Değerlendirme sipariş başınadır (bkz. `Review.orderId`): müşteri "dürüme 4,
 * ayrana 5" demez, akşamın tamamına tek bir puan verir. Burada o puan,
 * siparişte geçen ürünlerin her birine yazılır. Sonuç "bu yemeği içeren
 * siparişlerin puanı" diye okunmalı — ekranda da böyle yazıyor. Ürüne tek tek
 * puan vermek şemayı da değerlendirme akışını da değiştirir; o karar
 * verilene kadar dürüst olan yaklaşım budur.
 *
 * Veritabanısız ve saf: kural burada, veri toplama `repository.ts` içinde.
 * Ayrım sayesinde "aynı ürün aynı siparişte iki satırda" gibi ince kurallar
 * veritabanı olmadan sınanabiliyor.
 */

/** Ürün özetinde gösterilen, değerlendirmenin yayına açık alanları. */
export type ProductReviewItem = {
  id: string;
  authorName: string;
  foodRating: number;
  deliveryRating: number | null;
  comment: string;
  reply: string;
  createdAt: string;
};

export type ProductReviewSummary = {
  /** Yemek puanlarının ortalaması; hiç değerlendirme yoksa null. */
  average: number | null;
  /** Ortalamaya giren değerlendirme sayısı (yorumsuzlar dâhil). */
  count: number;
  /** Yorumu olanlar, yeniden eskiye. */
  items: ProductReviewItem[];
};

export const EMPTY_PRODUCT_SUMMARY: ProductReviewSummary = {
  average: null,
  count: 0,
  items: [],
};

/** Ürün penceresinde gösterilen en fazla yorum sayısı. */
export const PRODUCT_REVIEW_LIMIT = 6;

/** Değerlendirmenin hangi siparişe ait olduğu, dağıtımı yapabilmek için. */
export type ReviewWithOrder = ProductReviewItem & { orderId: string };

/** Siparişin bir satırı; yalnızca ürüne bağlı olanlar işe yarar. */
export type OrderProductLine = { orderId: string; productId: string | null };

/**
 * Ürün kimliği → özet.
 *
 * Girdi sırası korunur: `reviews` yeniden eskiye geldiyse her ürünün yorum
 * listesi de yeniden eskiye çıkar.
 */
export function groupReviewsByProduct(
  reviews: ReviewWithOrder[],
  lines: OrderProductLine[]
): Record<string, ProductReviewSummary> {
  /*
   * Aynı siparişte aynı ürün iki satırda olabilir (farklı boy, farklı
   * seçimler). Küme kullanılıyor: liste olsaydı tek siparişin puanı o ürünün
   * ortalamasına iki kez girer ve üç dürüm söyleyen bir müşteri, üç müşteri
   * gibi sayılırdı.
   */
  const productsByOrder = new Map<string, Set<string>>();
  for (const line of lines) {
    if (!line.productId) continue;
    const set = productsByOrder.get(line.orderId) ?? new Set<string>();
    set.add(line.productId);
    productsByOrder.set(line.orderId, set);
  }

  const ratings = new Map<string, number[]>();
  const comments = new Map<string, ProductReviewItem[]>();

  for (const review of reviews) {
    const products = productsByOrder.get(review.orderId);
    if (!products) continue;

    for (const productId of products) {
      const values = ratings.get(productId) ?? [];
      values.push(review.foodRating);
      ratings.set(productId, values);

      // Yorumsuz değerlendirme ortalamaya girer, listede görünmez — sitenin
      // geri kalanındaki kuralın aynısı (bkz. `getReviewSummary`).
      if (review.comment.length === 0) continue;
      const list = comments.get(productId) ?? [];
      if (list.length < PRODUCT_REVIEW_LIMIT) {
        const { orderId, ...item } = review;
        void orderId;
        list.push(item);
      }
      comments.set(productId, list);
    }
  }

  const index: Record<string, ProductReviewSummary> = {};
  for (const [productId, values] of ratings) {
    index[productId] = {
      average: averageRating(values),
      count: values.length,
      items: comments.get(productId) ?? [],
    };
  }
  return index;
}
