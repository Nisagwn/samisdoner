import type { Fulfillment, OrderStatus } from "@prisma/client";

/**
 * Kimin, ne zaman değerlendirme yazabileceği.
 *
 * Bu dosyada veritabanı yok, `Date.now()` yok, çeviri yok — yalnızca kural.
 * Sebebi test edilebilirlik değil, **tek yerde durması**: aynı kuralın hem
 * "Bewerten" düğmesini gösteren arayüzde hem de yazmayı kabul eden uçta
 * geçerli olması gerekir ve iki ayrı kopya er geç ayrışır. Arayüz kuralı
 * gösterir, uç onu uygular; ikisi de buradan okur.
 *
 * Kuralın kendisi ticari bir tercih değil, hukuki bir zorunluluk:
 * UWG § 5b Abs. 3 uyarınca tüketici değerlendirmesi yayımlayan işletme bu
 * yorumların gerçekten üründen yararlanmış kişilerden geldiğini temin etmek
 * ve bunu nasıl temin ettiğini açıklamak zorundadır. "Herkes yazabilir"
 * seçeneği bu yüzden hiç masada değildi.
 *
 * Üç eşik var ve üçünün de sebebi ayrı:
 *
 *  1. **Sipariş kapanmış olmalı.** Henüz gelmemiş bir yemek değerlendirilemez.
 *     İptal edilen sipariş de değerlendirilemez — orada değerlendirilecek bir
 *     yemek hiç olmadı; şikâyetin yeri yorum değil, iade.
 *  2. **Üzerinden biraz zaman geçmeli.** Kurye kapıdayken telefonundan yıldız
 *     veren müşteri henüz yemeği yemedi. Lieferando bunu iki saate koyuyor;
 *     biz teslim anından itibaren kısa bir bekleme uyguluyoruz — teslim
 *     kaydını biz tuttuğumuz için sipariş anından değil, teslim anından
 *     sayabiliyoruz.
 *  3. **Pencere kapanmalı.** İki hafta sonra yazılan yorum o akşamı değil,
 *     hatırlanan bir izlenimi anlatır. Ayrıca açık kalan bir pencere,
 *     işletmeyle sonradan bozuşan birinin eski siparişini koz olarak
 *     kullanmasına izin verir.
 */

/** Değerlendirmenin açılabileceği tek iki durum. */
const REVIEWABLE_STATUSES: OrderStatus[] = ["DELIVERED", "PICKED_UP"];

/** Teslimden sonra beklenen süre. Yemek yenmeden puan istenmez. */
export const REVIEW_DELAY_MINUTES = 45;

/** Pencerenin genişliği. Lieferando da iki hafta veriyor. */
export const REVIEW_WINDOW_DAYS = 14;

export const MIN_RATING = 1;
export const MAX_RATING = 5;

/** Değerlendirme kararı için gereken sipariş bilgisi — tamamı bu kadar. */
export type ReviewableOrder = {
  status: OrderStatus;
  fulfillment: Fulfillment;
  /** Teslim/teslim alma anı. Durum kapanmışsa dolu olması beklenir. */
  deliveredAt: Date | null;
  /** Yedek zaman kaynağı: kayıt eski olup `deliveredAt` boşsa kullanılır. */
  createdAt: Date;
};

export type ReviewEligibility =
  | { ok: true }
  | { ok: false; reason: "not_completed" | "too_early" | "window_closed" | "already_reviewed" };

/**
 * Teslim anı.
 *
 * `deliveredAt` göçten önce kapanmış siparişlerde boş olabilir; o durumda
 * sipariş tarihine düşülür. Boş bırakıp "değerlendirilemez" demek, eski
 * siparişleri sebepsiz yere dışarıda bırakırdı.
 */
function completedAt(order: ReviewableOrder): Date {
  return order.deliveredAt ?? order.createdAt;
}

/**
 * Bu sipariş şu an değerlendirilebilir mi.
 *
 * `alreadyReviewed` çağıran tarafın bildiği bir olgudur (tek sorgu ile gelir),
 * kuralın kendisi değil — bu yüzden parametre.
 */
export function reviewEligibility(
  order: ReviewableOrder,
  now: Date,
  alreadyReviewed: boolean
): ReviewEligibility {
  if (!REVIEWABLE_STATUSES.includes(order.status)) return { ok: false, reason: "not_completed" };
  if (alreadyReviewed) return { ok: false, reason: "already_reviewed" };

  const since = now.getTime() - completedAt(order).getTime();
  if (since < REVIEW_DELAY_MINUTES * 60_000) return { ok: false, reason: "too_early" };
  if (since > REVIEW_WINDOW_DAYS * 24 * 60 * 60_000) return { ok: false, reason: "window_closed" };

  return { ok: true };
}

/**
 * Değerlendirmenin açılacağı an — "yarın akşam 19:40'tan sonra" demek için.
 *
 * Arayüz bunu gösterir; "henüz değerlendiremezsiniz" tek başına bir cevap
 * değil, bir duvardır.
 */
export function reviewOpensAt(order: ReviewableOrder): Date {
  return new Date(completedAt(order).getTime() + REVIEW_DELAY_MINUTES * 60_000);
}

export function reviewClosesAt(order: ReviewableOrder): Date {
  return new Date(completedAt(order).getTime() + REVIEW_WINDOW_DAYS * 24 * 60 * 60_000);
}

/**
 * Teslimat puanı bu siparişte sorulmalı mı.
 *
 * Gel-al siparişte teslimat yoktur. Sorulsaydı müşteri bir şeye puan vermek
 * zorunda kalır, o puan da teslimat ortalamasına girerdi — ölçülen şeyin
 * olmadığı bir ölçüm.
 */
export function asksDeliveryRating(fulfillment: Fulfillment): boolean {
  return fulfillment === "DELIVERY";
}

/** Puan 1–5 aralığında tam sayı mı. */
export function isValidRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_RATING &&
    value <= MAX_RATING
  );
}

/**
 * Yayımlanan ad.
 *
 * Tam ad yayımlanmaz: "Mehmet Yılmaz" bir yorumun altında, o kişiyi tanıyan
 * herkes için o akşam ne yediğini söyleyen bir kayıttır. Soyadın baş harfi
 * DSGVO Art. 5 Abs. 1 lit. c'nin (veri minimizasyonu) istediği asgarîyi
 * verirken yorumu da kimliksiz bırakmaz. Ad hiç yoksa nötr bir karşılık
 * kullanılır — e-posta adresi **hiçbir koşulda** görünmez.
 */
export function displayName(fullName: string, de: boolean): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return de ? "Gast" : "Misafir";
  if (parts.length === 1) return parts[0].slice(0, 24);
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(" ").slice(0, 24)} ${last[0].toUpperCase()}.`;
}

/**
 * Ortalama puan.
 *
 * Tek ondalık basamağa yuvarlanır ("4.9") — iki basamak bir kesinlik iddiası
 * taşır ki yüz yorumluk bir örneklemde bunun karşılığı yok. Hiç yorum yoksa
 * `null` döner: sıfır puanlı bir restoran gibi görünmektense hiç puan
 * göstermemek doğrudur.
 */
export function averageRating(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}
