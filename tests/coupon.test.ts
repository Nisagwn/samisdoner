import { describe, expect, it } from "vitest";
import {
  discountFor,
  evaluateCoupon,
  normalizeCouponCode,
  type CouponRule,
} from "@/lib/orders/coupon";

/**
 * Kupon doğrulaması.
 *
 * İki soru sınanıyor: **kabul edilir mi** ve **kaç cent indirir**. İkincisi
 * doğrudan paraya dokunduğu için kelepçeler ayrı ayrı yazıldı — ara toplamı
 * aşan bir indirim, negatif toplamlı bir sipariş demektir ve o sipariş ödeme
 * sağlayıcısına hiç ulaşamaz.
 */

const NOW = new Date("2026-09-15T18:00:00.000Z");

function rule(overrides: Partial<CouponRule> = {}): CouponRule {
  return {
    code: "DOENER10",
    kind: "PERCENT",
    value: 10,
    minOrderCents: 0,
    maxDiscountCents: 0,
    fulfillment: null,
    startsAt: null,
    expiresAt: null,
    maxRedemptions: 0,
    redeemedCount: 0,
    active: true,
    ...overrides,
  };
}

const evaluate = (r: CouponRule | null, subtotalCents = 2000, fulfillment: "DELIVERY" | "PICKUP" = "DELIVERY") =>
  evaluateCoupon(r, { subtotalCents, fulfillment, now: NOW });

describe("normalizeCouponCode", () => {
  it("harf durumunu ve boşlukları siler", () => {
    expect(normalizeCouponCode(" doener10 ")).toBe("DOENER10");
    expect(normalizeCouponCode("SOMMER 26")).toBe("SOMMER26");
  });

  it("aşırı uzun girdiyi kırpar", () => {
    expect(normalizeCouponCode("A".repeat(80))).toHaveLength(40);
  });
});

describe("evaluateCoupon — ret sebepleri", () => {
  it("bilinmeyen kod", () => {
    const result = evaluate(null);
    expect(result).toEqual({ ok: false, reason: { code: "coupon_unknown" } });
  });

  it("kapatılmış kupon", () => {
    const result = evaluate(rule({ active: false }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("coupon_inactive");
  });

  it("henüz başlamamış kampanya", () => {
    const result = evaluate(rule({ startsAt: new Date("2026-10-01T00:00:00.000Z") }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("coupon_not_started");
  });

  it("süresi dolmuş kupon", () => {
    const result = evaluate(rule({ expiresAt: new Date("2026-09-01T00:00:00.000Z") }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("coupon_expired");
  });

  it("son kullanma anı dahil değildir — tam o anda kupon geçersizdir", () => {
    const result = evaluate(rule({ expiresAt: NOW }));
    expect(result.ok).toBe(false);
  });

  it("kullanım hakkı tükenmiş kupon", () => {
    const result = evaluate(rule({ maxRedemptions: 50, redeemedCount: 50 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe("coupon_exhausted");
  });

  it("yanlış teslim biçimi", () => {
    const result = evaluate(rule({ fulfillment: "PICKUP" }), 2000, "DELIVERY");
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason.code === "coupon_wrong_fulfillment") {
      expect(result.reason.fulfillment).toBe("PICKUP");
    } else {
      throw new Error("beklenen ret sebebi çıkmadı");
    }
  });

  it("asgari tutarın altındaki sepet — eksik tutar hesaplanabilsin diye eşik taşınır", () => {
    const result = evaluate(rule({ minOrderCents: 2500 }), 2000);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason.code === "coupon_below_minimum") {
      expect(result.reason.minOrderCents).toBe(2500);
      expect(result.reason.subtotalCents).toBe(2000);
    } else {
      throw new Error("beklenen ret sebebi çıkmadı");
    }
  });

  it("eşiğe tam oturan sepet kabul edilir", () => {
    const result = evaluate(rule({ minOrderCents: 2000 }), 2000);
    expect(result.ok).toBe(true);
  });

  it("sınırsız kuponun sayacı ret sebebi olmaz", () => {
    const result = evaluate(rule({ maxRedemptions: 0, redeemedCount: 999 }));
    expect(result.ok).toBe(true);
  });
});

describe("evaluateCoupon — indirim tutarı", () => {
  it("yüzde kuponu ara toplamdan hesaplanır", () => {
    const result = evaluate(rule({ kind: "PERCENT", value: 10 }), 2000);
    expect(result).toEqual({ ok: true, code: "DOENER10", discountCents: 200 });
  });

  it("sabit tutarlı kupon aynen düşer", () => {
    const result = evaluate(rule({ kind: "FIXED", value: 500 }), 2000);
    expect(result.ok && result.discountCents).toBe(500);
  });
});

describe("discountFor — kelepçeler", () => {
  it("yüzde kuponunda tavan uygulanır", () => {
    expect(discountFor({ kind: "PERCENT", value: 50, maxDiscountCents: 500 }, 4000)).toBe(500);
    expect(discountFor({ kind: "PERCENT", value: 50, maxDiscountCents: 0 }, 4000)).toBe(2000);
  });

  it("indirim ara toplamı asla geçmez", () => {
    expect(discountFor({ kind: "FIXED", value: 5000, maxDiscountCents: 0 }, 1200)).toBe(1200);
    expect(discountFor({ kind: "PERCENT", value: 100, maxDiscountCents: 0 }, 1200)).toBe(1200);
  });

  it("%100'ün üstündeki ve negatif değerler kelepçelenir", () => {
    expect(discountFor({ kind: "PERCENT", value: 400, maxDiscountCents: 0 }, 1000)).toBe(1000);
    expect(discountFor({ kind: "PERCENT", value: -20, maxDiscountCents: 0 }, 1000)).toBe(0);
    expect(discountFor({ kind: "FIXED", value: -500, maxDiscountCents: 0 }, 1000)).toBe(0);
  });

  it("boş sepette indirim sıfırdır", () => {
    expect(discountFor({ kind: "FIXED", value: 500, maxDiscountCents: 0 }, 0)).toBe(0);
  });

  it("kuruşlu yüzde en yakın cent'e yuvarlanır", () => {
    // 1999 × %10 = 199,9 → 200
    expect(discountFor({ kind: "PERCENT", value: 10, maxDiscountCents: 0 }, 1999)).toBe(200);
  });
});
