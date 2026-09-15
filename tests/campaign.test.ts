import { describe, expect, it } from "vitest";
import { applyCampaigns, readDiscountLines, type CampaignLine } from "@/lib/orders/campaign";
import type { CouponRule } from "@/lib/orders/coupon";
import type { PricedLine } from "@/lib/admin/store";
import { composeTotals } from "@/lib/orders/totals";

/**
 * Kampanyaların sepette birleşmesi.
 *
 * Sınanan üç soru: **hangi kampanya geçer**, **kaç cent indirir** ve
 * **indirim hangi satıra düşer**. Sonuncusu KDV'nin kendisi — %19'luk
 * içeceğin indirimi yanlış satıra düşerse fatura yanlış yazılır.
 */

const NOW = new Date("2026-09-15T18:00:00.000Z");

function rule(overrides: Partial<CouponRule> = {}): CouponRule {
  return {
    id: "c1",
    code: "",
    kind: "PRODUCT_PRICE",
    title: "Monatsangebot",
    titleTr: "Ayın ürünü",
    value: 650,
    items: [{ productId: "durum", qty: 1 }],
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

const DURUM: CampaignLine = { productId: "durum", unitBaseCents: 800, qty: 1 };
const DURUM_GR: CampaignLine = { productId: "durum", variantSize: "gr.", unitBaseCents: 1000, qty: 1 };
const POMMES: CampaignLine = { productId: "pommes", unitBaseCents: 350, qty: 1 };
const AYRAN: CampaignLine = { productId: "ayran", unitBaseCents: 250, qty: 1 };

const subtotal = (lines: CampaignLine[]) =>
  lines.reduce((sum, line) => sum + line.unitBaseCents * line.qty, 0);

function run(
  lines: CampaignLine[],
  automatic: CouponRule[],
  coded: { rule: CouponRule | null; code: string } = { rule: null, code: "" },
  fulfillment: "DELIVERY" | "PICKUP" = "DELIVERY"
) {
  return applyCampaigns({
    automatic,
    coded: coded.rule,
    enteredCode: coded.code,
    lines,
    subtotalCents: subtotal(lines),
    fulfillment,
    now: NOW,
  });
}

describe("ürüne özel fiyat (ayın ürünü)", () => {
  it("her adet kampanya fiyatına iner", () => {
    const result = run([{ ...DURUM, qty: 3 }], [rule()]);
    expect(result.discountCents).toBe(3 * 150);
    expect(result.lineDiscountCents).toEqual([450]);
    expect(result.applied).toHaveLength(1);
  });

  it("boy seçilmemişse bütün boylar, seçilmişse yalnızca o boy iner", () => {
    expect(run([DURUM, DURUM_GR], [rule()]).lineDiscountCents).toEqual([150, 350]);
    expect(
      run([DURUM, DURUM_GR], [rule({ items: [{ productId: "durum", variantSize: "gr.", qty: 1 }] })])
        .lineDiscountCents
    ).toEqual([0, 350]);
  });

  it("kampanya fiyatı normal fiyattan pahalıysa indirim yok, fiyat artmaz", () => {
    const result = run([DURUM], [rule({ value: 900 })]);
    expect(result.discountCents).toBe(0);
    expect(result.applied).toHaveLength(0);
  });

  it("aynı ürüne iki kampanya: müşteri için ucuz olan geçer, ikisi birden değil", () => {
    const result = run([DURUM], [rule({ id: "a", value: 700 }), rule({ id: "b", value: 600 })]);
    expect(result.discountCents).toBe(200);
    expect(result.applied.map((entry) => entry.rule.id)).toEqual(["b"]);
  });

  it("geçerli olmayan otomatik kampanya sessizce atlanır", () => {
    const result = run([DURUM], [rule({ expiresAt: new Date("2026-09-01T00:00:00Z") })]);
    expect(result.discountCents).toBe(0);
    expect(result.codeRejection).toBeNull();
  });
});

describe("menü fiyatı (ürün birleşimi)", () => {
  const menu = rule({
    id: "menu",
    kind: "BUNDLE_PRICE",
    value: 1000,
    items: [
      { productId: "durum", qty: 1 },
      { productId: "pommes", qty: 1 },
      { productId: "ayran", qty: 1 },
    ],
  });

  it("set tamamsa set fiyatı ödenir; kazanç kalemlere fiyat oranında dağılır", () => {
    const result = run([DURUM, POMMES, AYRAN], [menu]);
    // 800 + 350 + 250 = 1400 → 1000
    expect(result.discountCents).toBe(400);
    expect(result.lineDiscountCents.reduce((a, b) => a + b, 0)).toBe(400);
    expect(result.lineDiscountCents).toEqual([229, 100, 71]);
  });

  it("eksik kalem varsa set kurulmaz", () => {
    expect(run([DURUM, POMMES], [menu]).discountCents).toBe(0);
  });

  it("iki tam set iki kez, artan adet normal fiyattan", () => {
    const result = run([{ ...DURUM, qty: 3 }, { ...POMMES, qty: 2 }, { ...AYRAN, qty: 2 }], [menu]);
    expect(result.discountCents).toBe(800);
  });

  it("aynı üründen iki adet isteyen set", () => {
    const twoAyran = rule({
      kind: "BUNDLE_PRICE",
      value: 900,
      items: [
        { productId: "durum", qty: 1 },
        { productId: "ayran", qty: 2 },
      ],
    });
    expect(run([DURUM, AYRAN], [twoAyran]).discountCents).toBe(0);
    expect(run([DURUM, { ...AYRAN, qty: 2 }], [twoAyran]).discountCents).toBe(400);
  });

  it("set önce kurulur; setteki Dürüm ayın ürünü indirimini ikinci kez almaz", () => {
    const result = run([{ ...DURUM, qty: 2 }, POMMES, AYRAN], [rule(), menu]);
    // set: 400, setin dışında kalan ikinci Dürüm: 150
    expect(result.discountCents).toBe(550);
  });

  it("menü fiyatı ayrı ayrı almaktan pahalıysa set kurulmaz", () => {
    expect(run([DURUM, POMMES, AYRAN], [{ ...menu, value: 1500 }]).discountCents).toBe(0);
  });
});

describe("sepet indirimi ve kod", () => {
  it("yüzde indirimi ürün indirimlerinden sonra kalan tutara uygulanır", () => {
    const percent = rule({ id: "p", kind: "PERCENT", value: 10, items: [] });
    const result = run([DURUM, POMMES], [rule(), percent]);
    // 1150 − 150 = 1000 → %10 = 100
    expect(result.cartDiscountCents).toBe(100);
    expect(result.discountCents).toBe(250);
  });

  it("bilinmeyen kod reddedilir ama otomatik kampanyalar geçmeye devam eder", () => {
    const result = run([DURUM], [rule()], { rule: null, code: "YOK" });
    expect(result.codeRejection).toEqual({ code: "coupon_unknown" });
    expect(result.discountCents).toBe(150);
    expect(result.code).toBe("");
  });

  it("ürüne bağlı kod, ürün sepette yoksa gerekçesiyle reddedilir", () => {
    const coded = rule({ code: "DURUM", items: [{ productId: "durum", qty: 1 }] });
    const result = run([POMMES], [], { rule: coded, code: "DURUM" });
    expect(result.codeRejection).toEqual({ code: "coupon_no_items" });
  });

  it("geçerli kod kabul edilir ve kodu döner", () => {
    const coded = rule({ code: "DONER10", kind: "PERCENT", value: 10, items: [] });
    const result = run([DURUM], [], { rule: coded, code: "DONER10" });
    expect(result.code).toBe("DONER10");
    expect(result.discountCents).toBe(80);
  });

  it("yanlış teslim biçimindeki kod reddedilir", () => {
    const coded = rule({ code: "ABHOL", kind: "FIXED", value: 200, items: [], fulfillment: "PICKUP" });
    const result = run([DURUM], [], { rule: coded, code: "ABHOL" }, "DELIVERY");
    expect(result.codeRejection?.code).toBe("coupon_wrong_fulfillment");
  });
});

describe("composeTotals — satır indirimi ve KDV", () => {
  const line = (lineCents: number, vatRate: number): PricedLine => ({
    key: `k${lineCents}-${vatRate}`,
    input: { kind: "product", productId: "x", qty: 1 },
    label: "x",
    detail: "",
    unitCents: lineCents,
    lineCents,
    qty: 1,
    vatRate,
    unavailable: false,
  });

  it("ürün indirimi yalnızca kendi oranının matrahından düşer", () => {
    const lines = [line(1000, 7), line(250, 19)];
    const totals = composeTotals({
      lines,
      subtotalCents: 1250,
      serviceFeeCents: 0,
      deliveryFeeCents: 0,
      lineDiscountCents: [0, 100],
    });
    expect(totals.discountCents).toBe(100);
    expect(totals.totalCents).toBe(1150);
    expect(totals.vatBreakdown.find((bucket) => bucket.rate === 7)?.grossCents).toBe(1000);
    expect(totals.vatBreakdown.find((bucket) => bucket.rate === 19)?.grossCents).toBe(150);
  });

  it("değişmez korunur: brüt toplam = toplam − bahşiş", () => {
    const lines = [line(1000, 7), line(250, 19)];
    const totals = composeTotals({
      lines,
      subtotalCents: 1250,
      serviceFeeCents: 149,
      deliveryFeeCents: 250,
      discountCents: 111,
      lineDiscountCents: [333, 99],
      tipCents: 200,
    });
    const gross = totals.vatBreakdown.reduce((sum, bucket) => sum + bucket.grossCents, 0);
    expect(gross).toBe(totals.totalCents - totals.tipCents);
    expect(totals.discountCents).toBe(543);
  });

  it("satırı aşan indirim kelepçelenir", () => {
    const totals = composeTotals({
      lines: [line(500, 7)],
      subtotalCents: 500,
      serviceFeeCents: 0,
      deliveryFeeCents: 0,
      lineDiscountCents: [9999],
    });
    expect(totals.discountCents).toBe(500);
    expect(totals.totalCents).toBe(0);
  });
});

describe("readDiscountLines", () => {
  it("bozuk ve boş kayıtları atlar", () => {
    expect(readDiscountLines(null)).toEqual([]);
    expect(
      readDiscountLines([{ code: "X", title: "A", titleTr: "B", amountCents: 100 }, { amountCents: 0 }, "x"])
    ).toEqual([{ code: "X", title: "A", titleTr: "B", amountCents: 100 }]);
  });
});
