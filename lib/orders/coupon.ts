import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Gutscheincode — indirim kuponu.
 *
 * Bu dosyanın üst yarısı **saf mantıktır**: kupon kuralı + sepet bilgisi
 * girer, indirim tutarı ya da ret sebebi çıkar. Veritabanına dokunmaz,
 * testte doğrudan çalıştırılır. Alt yarısı kuralı okuyan ve kullanımı
 * yazan ince veri katmanıdır.
 *
 * KURAL, BAKİYE DEĞİL
 *
 * Kupon bir kasa değildir: üzerinde para taşımaz. Her sipariş indirimini
 * kuraldan **yeniden hesaplar** ve sonucu siparişe kopyalar
 * (`Order.discountCents`). Kupon yarın silinse bile dün verilen siparişin
 * indirimi değişmez — sipariş satırındaki fiyat kopyası kuralının aynısı.
 *
 * İNDİRİM NEYE UYGULANIR
 *
 * Yalnızca **ara toplama** (yemeğin bedeline). Kurye ücreti ve servis bedeli
 * indirimin dışındadır: ikisi de işletmenin cebinden çıkan gerçek maliyetler
 * ve "%20 indirim" diyen bir kampanyanın kuryeyi de ucuzlatması beklenen bir
 * şey değil. İndirim ara toplamı geçemez; sipariş toplamı hiçbir zaman
 * negatife düşmez.
 */

export type CouponKind = "PERCENT" | "FIXED";

/** Kuponun kuralları — veritabanı satırının saf mantığı ilgilendiren kısmı. */
export type CouponRule = {
  code: string;
  kind: CouponKind;
  /** PERCENT'te yüzde (1–100), FIXED'de cent. */
  value: number;
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
  | { code: "coupon_below_minimum"; minOrderCents: number; subtotalCents: number };

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
 * Kuponun bu sepette ne kadar indirim yaptığı.
 *
 * Sıra bilinçli: önce kuponun kendisiyle ilgili engeller (yok, kapalı,
 * başlamamış, dolmuş, tükenmiş), sonra sepetle ilgili olanlar (teslim biçimi,
 * eşik). Böylece müşterinin gördüğü ilk hata düzeltebileceği en yakın hatadır.
 */
export function evaluateCoupon(
  rule: CouponRule | null,
  input: { subtotalCents: number; fulfillment: "DELIVERY" | "PICKUP"; now?: Date }
): CouponEvaluation {
  if (!rule) return { ok: false, reason: { code: "coupon_unknown" } };
  if (!rule.active) return { ok: false, reason: { code: "coupon_inactive" } };

  const now = input.now ?? new Date();

  if (rule.startsAt && now < rule.startsAt) {
    return {
      ok: false,
      reason: { code: "coupon_not_started", startsAt: rule.startsAt.toISOString() },
    };
  }
  if (rule.expiresAt && now >= rule.expiresAt) {
    return {
      ok: false,
      reason: { code: "coupon_expired", expiresAt: rule.expiresAt.toISOString() },
    };
  }
  if (rule.maxRedemptions > 0 && rule.redeemedCount >= rule.maxRedemptions) {
    return { ok: false, reason: { code: "coupon_exhausted" } };
  }
  if (rule.fulfillment && rule.fulfillment !== input.fulfillment) {
    return {
      ok: false,
      reason: { code: "coupon_wrong_fulfillment", fulfillment: rule.fulfillment },
    };
  }

  const subtotalCents = Math.max(0, Math.round(input.subtotalCents));
  if (subtotalCents < rule.minOrderCents) {
    return {
      ok: false,
      reason: {
        code: "coupon_below_minimum",
        minOrderCents: rule.minOrderCents,
        subtotalCents,
      },
    };
  }

  return { ok: true, code: rule.code, discountCents: discountFor(rule, subtotalCents) };
}

/**
 * Kuralın ara toplama uyguladığı indirim.
 *
 * Her iki uçta da kelepçelenir: negatif olamaz ve ara toplamı geçemez.
 * Geçebilseydi "toplam −3,20 €" gibi bir sipariş doğar, ödeme sağlayıcısı da
 * onu reddederdi.
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
  } else {
    discount = Math.max(0, Math.round(rule.value));
  }

  return Math.min(discount, base);
}

/* ═════════════════════════════════════════════════════════════ veri katmanı */

/**
 * Kodun kuralını okur; yoksa null.
 *
 * Önbelleklenmez, bilinçli olarak: satır `redeemedCount` ile birlikte okunuyor
 * ve o sayı her siparişte değişiyor — bayat bir sayaç, tükenmiş bir kampanyayı
 * beş dakika daha açık gösterir. Kuponlar zaten her sepet yenilemesinde değil,
 * yalnızca müşteri kod girdiğinde okunuyor.
 */
export async function findCouponRule(code: string): Promise<CouponRule | null> {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;

  const row = await prisma.coupon.findUnique({ where: { code: normalized } });
  if (!row) return null;

  return {
    code: row.code,
    kind: row.kind,
    value: row.value,
    minOrderCents: row.minOrderCents,
    maxDiscountCents: row.maxDiscountCents,
    fulfillment: row.fulfillment,
    startsAt: row.startsAt,
    expiresAt: row.expiresAt,
    maxRedemptions: row.maxRedemptions,
    redeemedCount: row.redeemedCount,
    active: row.active,
  };
}

/**
 * Kuponun bu siparişte kullanıldığını yazar.
 *
 * Sayaç **koşullu** artırılır: sınır dolmuşsa UPDATE hiçbir satıra dokunmaz ve
 * fonksiyon `false` döner. Aynı kuponla eşzamanlı gelen iki sipariş arasındaki
 * yarış böylece veritabanı seviyesinde çözülür; uygulama katmanında "önce oku,
 * sonra yaz" yapan bir kontrol bu yarışı kaybeder ve 50 kullanımlık kampanya
 * 52 kez kullanılabilirdi.
 *
 * Sipariş işleminin **içinde** çağrılır: kupon yazılamazsa sipariş de yazılmaz,
 * dolayısıyla indirimi uygulanmış ama kullanımı sayılmamış bir sipariş oluşamaz.
 */
export async function redeemCoupon(
  tx: Prisma.TransactionClient,
  input: { code: string; orderId: string; amountCents: number }
): Promise<boolean> {
  const code = normalizeCouponCode(input.code);
  if (!code || input.amountCents <= 0) return false;

  const coupon = await tx.coupon.findUnique({
    where: { code },
    select: { id: true, maxRedemptions: true },
  });
  if (!coupon) return false;

  const updated = await tx.coupon.updateMany({
    where: {
      id: coupon.id,
      active: true,
      // Sınırsız kuponda koşul her zaman doğrudur; sınırlıda sayaç tavana
      // dayandığı anda UPDATE hiçbir satır bulamaz.
      ...(coupon.maxRedemptions > 0
        ? { redeemedCount: { lt: coupon.maxRedemptions } }
        : {}),
    },
    data: { redeemedCount: { increment: 1 } },
  });
  if (updated.count === 0) return false;

  await tx.couponRedemption.create({
    data: { couponId: coupon.id, orderId: input.orderId, amountCents: input.amountCents },
  });
  return true;
}
