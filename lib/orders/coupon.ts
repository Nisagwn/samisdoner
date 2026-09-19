/**
 * Kampanya kuralı — tek bir kuralın geçerliliği ve sepet indirimi.
 *
 * **Saf mantık**: kural + sepet bilgisi girer, indirim tutarı ya da ret sebebi
 * çıkar. Veritabanına dokunmaz ve dokunmamalı — kodu normalleştiren ve ret
 * sebebini cümleye çeviren parçalar ödeme ekranında, yani **istemcide** de
 * çalışıyor. Buraya bir `prisma` içe aktarımı girdiği gün veritabanı istemcisi
 * tarayıcı paketine sızar.
 *
 * Dosyanın adı tarihsel: başlangıçta yalnızca indirim kuponu vardı. Birden çok
 * kampanyanın aynı sepette nasıl birleştiği (ayın ürünü, menü fiyatı, kod)
 * `lib/orders/campaign.ts` içinde; burası tek kuralın kendisi. Kuralı okuyan
 * ve kullanımı yazan veri katmanı ayrı dosyada: `lib/orders/coupons.ts`.
 *
 * KURAL, BAKİYE DEĞİL
 *
 * Kampanya bir kasa değildir: üzerinde para taşımaz. Her sipariş indirimini
 * kuraldan **yeniden hesaplar** ve sonucu siparişe kopyalar
 * (`Order.discountCents`). Kampanya yarın silinse bile dün verilen siparişin
 * indirimi değişmez — sipariş satırındaki fiyat kopyası kuralının aynısı.
 *
 * İNDİRİM NEYE UYGULANIR
 *
 * Yalnızca **yemeğin bedeline**. Kurye ücreti ve servis bedeli indirimin
 * dışındadır: ikisi de işletmenin cebinden çıkan gerçek maliyetler ve "%20
 * indirim" diyen bir kampanyanın kuryeyi de ucuzlatması beklenen bir şey
 * değil. İndirim ara toplamı geçemez; sipariş toplamı hiçbir zaman negatife
 * düşmez.
 */

export type CouponKind = "PERCENT" | "FIXED" | "PRODUCT_PRICE" | "BUNDLE_PRICE";

/**
 * Ürüne bağlı kampanyanın bir kalemi.
 *
 * `variantSize` boşsa ürünün bütün boyları sayılır ("her boy Dürüm 6,50 €");
 * doluysa yalnızca o boy ("gr. Dürüm"). `qty` menü fiyatında setteki adettir
 * ("2× Ayran"); ürüne özel fiyatta okunmaz.
 */
export type CampaignItem = {
  productId: string;
  variantSize?: string;
  qty: number;
};

/** Kampanyanın kuralları — veritabanı satırının saf mantığı ilgilendiren kısmı. */
export type CouponRule = {
  /** Veritabanı kimliği; kullanım kaydı buna yazılır. Testlerde boş kalabilir. */
  id?: string;
  /** Otomatik kampanyada boş dize. */
  code: string;
  kind: CouponKind;
  /** Müşteriye görünen ad (Almanca / Türkçe); ikisi de boş olabilir. */
  title?: string;
  titleTr?: string;
  /**
   * PERCENT'te yüzde (1–100), FIXED'de indirilen cent, PRODUCT_PRICE'ta adet
   * fiyatı (cent), BUNDLE_PRICE'ta set fiyatı (cent).
   */
  value: number;
  /** Ürüne bağlı türlerde kampanyanın ürünleri; sepet indiriminde boş. */
  items?: CampaignItem[];
  minOrderCents: number;
  /** Yüzde kuponunda indirimin tavanı (cent); 0 = tavan yok. */
  maxDiscountCents: number;
  /** Yalnızca bu teslim biçiminde geçerli; null = ikisinde de. */
  fulfillment: "DELIVERY" | "PICKUP" | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  /** Toplam kullanım sınırı; 0 = sınırsız. */
  maxRedemptions: number;
  redeemedCount: number;
  active: boolean;
};

/** Ürüne bağlı mı (ayın ürünü, menü fiyatı), yoksa sepetin tamamına mı. */
export function isItemCampaign(kind: CouponKind): boolean {
  return kind === "PRODUCT_PRICE" || kind === "BUNDLE_PRICE";
}

/**
 * Ret sebepleri.
 *
 * Her sebep müşteriye **ne yapması gerektiğini** söyleyebilecek kadar veri
 * taşır: "geçersiz kod" demek yerine "bu kupon 20 €'dan itibaren geçerli"
 * demek, sepete bir ürün daha eklemeyi mümkün kılar.
 */
export type CouponRejection =
  | { code: "coupon_unknown" }
  | { code: "coupon_inactive" }
  | { code: "coupon_not_started"; startsAt: string }
  | { code: "coupon_expired"; expiresAt: string }
  | { code: "coupon_exhausted" }
  | { code: "coupon_wrong_fulfillment"; fulfillment: "DELIVERY" | "PICKUP" }
  | { code: "coupon_below_minimum"; minOrderCents: number; subtotalCents: number }
  /** Kod geçerli ama ürüne bağlı ve o ürünler sepette yok. */
  | { code: "coupon_no_items" }
  /**
   * Çok sayıda yanlış kod denendi; kod bu istekte hiç sorgulanmadı.
   *
   * Diğerlerinden farkı: bu ret kuponun kendisi hakkında **hiçbir şey
   * söylemez**. Sebebi de bu — bkz. `app/api/menu/quote/route.ts`.
   */
  | { code: "coupon_too_many_attempts"; retryAfterSeconds: number };

export type CouponEvaluation =
  | { ok: true; code: string; discountCents: number }
  | { ok: false; reason: CouponRejection };

/**
 * Kodu saklama/arama biçimine indirger.
 *
 * Büyük harf ve boşluksuz: müşteri kodu e-postadan kopyalarken başına/sonuna
 * boşluk alır, telefon klavyesi ilk harfi büyütür. Kodun kendisinde harf
 * durumu hiçbir zaman anlam taşımaz.
 */
export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "").slice(0, 40);
}

/**
 * Kural bu sepette geçerli mi — tutardan bağımsız engeller.
 *
 * Sıra bilinçli: önce kuralın kendisiyle ilgili engeller (kapalı, başlamamış,
 * dolmuş, tükenmiş), sonra sepetle ilgili olanlar (teslim biçimi, eşik).
 * Böylece müşterinin gördüğü ilk hata düzeltebileceği en yakın hatadır.
 */
export function couponEligibility(
  rule: CouponRule,
  input: { subtotalCents: number; fulfillment: "DELIVERY" | "PICKUP"; now?: Date }
): CouponRejection | null {
  if (!rule.active) return { code: "coupon_inactive" };

  const now = input.now ?? new Date();

  if (rule.startsAt && now < rule.startsAt) {
    return { code: "coupon_not_started", startsAt: rule.startsAt.toISOString() };
  }
  if (rule.expiresAt && now >= rule.expiresAt) {
    return { code: "coupon_expired", expiresAt: rule.expiresAt.toISOString() };
  }
  if (rule.maxRedemptions > 0 && rule.redeemedCount >= rule.maxRedemptions) {
    return { code: "coupon_exhausted" };
  }
  if (rule.fulfillment && rule.fulfillment !== input.fulfillment) {
    return { code: "coupon_wrong_fulfillment", fulfillment: rule.fulfillment };
  }

  const subtotalCents = Math.max(0, Math.round(input.subtotalCents));
  if (subtotalCents < rule.minOrderCents) {
    return {
      code: "coupon_below_minimum",
      minOrderCents: rule.minOrderCents,
      subtotalCents,
    };
  }
  return null;
}

/**
 * Sepet indiriminin (yüzde / sabit) bu sepette ne kadar indirdiği.
 *
 * Ürüne bağlı kampanyaların tutarı sepetteki satırlara bakmadan bulunamaz;
 * onlar ve birden çok kampanyanın birleşimi `applyCampaigns` içinde.
 */
export function evaluateCoupon(
  rule: CouponRule | null,
  input: { subtotalCents: number; fulfillment: "DELIVERY" | "PICKUP"; now?: Date }
): CouponEvaluation {
  if (!rule) return { ok: false, reason: { code: "coupon_unknown" } };

  const rejection = couponEligibility(rule, input);
  if (rejection) return { ok: false, reason: rejection };

  return { ok: true, code: rule.code, discountCents: discountFor(rule, input.subtotalCents) };
}

/**
 * Sepet indiriminin verilen tutara uyguladığı indirim.
 *
 * Her iki uçta da kelepçelenir: negatif olamaz ve tutarı geçemez.
 * Geçebilseydi "toplam −3,20 €" gibi bir sipariş doğar, ödeme sağlayıcısı da
 * onu reddederdi. Ürüne bağlı türler burada 0 döner — tutarları satırlardan
 * hesaplanır.
 */
export function discountFor(
  rule: Pick<CouponRule, "kind" | "value" | "maxDiscountCents">,
  subtotalCents: number
): number {
  const base = Math.max(0, Math.round(subtotalCents));
  if (base === 0) return 0;

  let discount: number;
  if (rule.kind === "PERCENT") {
    const percent = Math.min(100, Math.max(0, Math.round(rule.value)));
    discount = Math.round((base * percent) / 100);
    if (rule.maxDiscountCents > 0) discount = Math.min(discount, rule.maxDiscountCents);
  } else if (rule.kind === "FIXED") {
    discount = Math.max(0, Math.round(rule.value));
  } else {
    return 0;
  }

  return Math.min(discount, base);
}
