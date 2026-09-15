import { describe, expect, it } from "vitest";
import type { PricedLine } from "@/lib/admin/store";
import { composeTotals } from "@/lib/orders/totals";
import { clampTip, maxTipFor, parseTipInput, tipForPercent } from "@/lib/orders/tip";

/**
 * Sipariş toplamı ve KDV dökümü — kupon ve bahşiş girdikten sonra.
 *
 * Buradaki asıl sınav tek bir cümle: **faturaya yazılan KDV dökümünün brüt
 * toplamı, tahsil edilen tutardan bahşiş çıkarıldığında kalan tutara eşit
 * olmalı.** Bu eşitlik bozulursa, siparişin faturası ile kartından çekilen
 * para birbirini tutmuyor demektir; kupon ya da bahşiş eklerken en kolay
 * kırılacak yer de burasıdır.
 *
 * Bahşişin dökümün dışında kalması bilinçlidir (Abschn. 10.1 Abs. 5 UStAE);
 * aşağıdaki testler bunu davranış olarak sabitliyor, yoksa bir gün "toplam
 * tutmuyor" diye bahşiş matraha eklenir.
 */

function line(overrides: Partial<PricedLine> = {}): PricedLine {
  return {
    key: "product:x|",
    input: { kind: "product", productId: "x", qty: 1 },
    label: "Döner",
    detail: "",
    unitCents: 700,
    lineCents: 700,
    qty: 1,
    vatRate: 7,
    unavailable: false,
    ...overrides,
  };
}

/** %7 yemek + %19 içecek: dökümün iki kovalı hâli. */
const mixedLines: PricedLine[] = [
  line({ key: "a", label: "Döner", unitCents: 700, lineCents: 1400, qty: 2, vatRate: 7 }),
  line({ key: "b", label: "Cola", unitCents: 300, lineCents: 300, qty: 1, vatRate: 19 }),
];

const MIXED_SUBTOTAL = 1700;

/** Dökümün brüt toplamı — değişmezi sınamanın kısa yolu. */
const grossSum = (buckets: { grossCents: number }[]) =>
  buckets.reduce((sum, bucket) => sum + bucket.grossCents, 0);

describe("composeTotals — temel toplam", () => {
  it("ara toplam, ücretler ve bahşişi toplar, indirimi düşer", () => {
    const totals = composeTotals({
      lines: mixedLines,
      subtotalCents: MIXED_SUBTOTAL,
      serviceFeeCents: 100,
      deliveryFeeCents: 250,
      discountCents: 300,
      tipCents: 200,
    });

    expect(totals.totalCents).toBe(1700 + 100 + 250 - 300 + 200);
  });

  it("kupon ve bahşiş yokken eski davranışı korur", () => {
    const totals = composeTotals({
      lines: mixedLines,
      subtotalCents: MIXED_SUBTOTAL,
      serviceFeeCents: 100,
      deliveryFeeCents: 250,
    });

    expect(totals.totalCents).toBe(2050);
    expect(totals.discountCents).toBe(0);
    expect(totals.tipCents).toBe(0);
    expect(grossSum(totals.vatBreakdown)).toBe(2050);
  });
});

describe("composeTotals — KDV değişmezi", () => {
  /*
   * Değişmez tek bir senaryoda değil, kupon/bahşiş/ücret kombinasyonlarının
   * tamamında sınanır: kuruş artığının nereye gittiği ancak böyle yakalanır.
   */
  const cases = [
    { discountCents: 0, tipCents: 0 },
    { discountCents: 0, tipCents: 199 },
    { discountCents: 333, tipCents: 0 },
    { discountCents: 333, tipCents: 167 },
    { discountCents: 1, tipCents: 1 },
    { discountCents: MIXED_SUBTOTAL, tipCents: 500 },
  ];

  for (const { discountCents, tipCents } of cases) {
    it(`indirim ${discountCents} / bahşiş ${tipCents}: brüt toplam = toplam − bahşiş`, () => {
      const totals = composeTotals({
        lines: mixedLines,
        subtotalCents: MIXED_SUBTOTAL,
        serviceFeeCents: 149,
        deliveryFeeCents: 299,
        discountCents,
        tipCents,
      });

      expect(grossSum(totals.vatBreakdown)).toBe(totals.totalCents - totals.tipCents);
    });
  }

  it("her kovada net + KDV, brütü verir", () => {
    const totals = composeTotals({
      lines: mixedLines,
      subtotalCents: MIXED_SUBTOTAL,
      serviceFeeCents: 149,
      deliveryFeeCents: 299,
      discountCents: 500,
      tipCents: 300,
    });

    for (const bucket of totals.vatBreakdown) {
      expect(bucket.netCents + bucket.vatCents).toBe(bucket.grossCents);
    }
  });

  it("indirim iki KDV oranına da dağılır, tek orana yıkılmaz", () => {
    const withoutDiscount = composeTotals({
      lines: mixedLines,
      subtotalCents: MIXED_SUBTOTAL,
      serviceFeeCents: 0,
      deliveryFeeCents: 0,
    });
    const withDiscount = composeTotals({
      lines: mixedLines,
      subtotalCents: MIXED_SUBTOTAL,
      serviceFeeCents: 0,
      deliveryFeeCents: 0,
      discountCents: 850,
    });

    for (const rate of [7, 19]) {
      const before = withoutDiscount.vatBreakdown.find((b) => b.rate === rate)!;
      const after = withDiscount.vatBreakdown.find((b) => b.rate === rate)!;
      // Her iki kovanın da matrahı düşmeli; biri sabit kalırsa dağıtım bozuk.
      expect(after.grossCents).toBeLessThan(before.grossCents);
      expect(after.vatCents).toBeLessThan(before.vatCents);
    }
  });

  it("bahşiş KDV dökümünü hiç değiştirmez", () => {
    const base = { lines: mixedLines, subtotalCents: MIXED_SUBTOTAL, serviceFeeCents: 100, deliveryFeeCents: 250 };
    const withoutTip = composeTotals(base);
    const withTip = composeTotals({ ...base, tipCents: 1000 });

    expect(withTip.vatBreakdown).toEqual(withoutTip.vatBreakdown);
    expect(withTip.totalCents).toBe(withoutTip.totalCents + 1000);
  });
});

describe("composeTotals — kelepçeler", () => {
  it("ara toplamı aşan indirim ara toplamda durur; toplam negatife düşmez", () => {
    const totals = composeTotals({
      lines: mixedLines,
      subtotalCents: MIXED_SUBTOTAL,
      serviceFeeCents: 0,
      deliveryFeeCents: 0,
      discountCents: 99_999,
    });

    expect(totals.discountCents).toBe(MIXED_SUBTOTAL);
    expect(totals.totalCents).toBe(0);
    expect(grossSum(totals.vatBreakdown)).toBe(0);
  });

  it("negatif indirim ve negatif bahşiş sıfıra düşer", () => {
    const totals = composeTotals({
      lines: mixedLines,
      subtotalCents: MIXED_SUBTOTAL,
      serviceFeeCents: 0,
      deliveryFeeCents: 0,
      discountCents: -500,
      tipCents: -500,
    });

    expect(totals.discountCents).toBe(0);
    expect(totals.tipCents).toBe(0);
    expect(totals.totalCents).toBe(MIXED_SUBTOTAL);
  });

  it("menüden kalkmış satır ne toplama ne döküme girer", () => {
    const lines = [...mixedLines, line({ key: "c", lineCents: 900, unavailable: true, vatRate: 19 })];
    const totals = composeTotals({
      lines,
      subtotalCents: MIXED_SUBTOTAL,
      serviceFeeCents: 0,
      deliveryFeeCents: 0,
    });

    expect(grossSum(totals.vatBreakdown)).toBe(MIXED_SUBTOTAL);
  });
});

describe("bahşiş", () => {
  it("yüzde, ara toplam üzerinden hesaplanır — ücretler dahil değil", () => {
    expect(tipForPercent(2000, 10)).toBe(200);
    expect(tipForPercent(1750, 5)).toBe(88); // 87,5 → yukarı yuvarlanır
    expect(tipForPercent(2000, 0)).toBe(0);
    expect(tipForPercent(0, 10)).toBe(0);
  });

  it("üst sınır sepet kadar, ama en az 5 € ve en fazla 50 €", () => {
    expect(maxTipFor(800)).toBe(800);
    expect(maxTipFor(200)).toBe(500);
    expect(maxTipFor(100_000)).toBe(5_000);
  });

  it("sınırı aşan bahşiş kırpılır, geçersiz girdi sıfıra düşer", () => {
    expect(clampTip(100_000, 2000)).toBe(2000);
    expect(clampTip(-5, 2000)).toBe(0);
    expect(clampTip(Number.NaN, 2000)).toBe(0);
    expect(clampTip("3", 2000)).toBe(0);
    expect(clampTip(250, 2000)).toBe(250);
  });

  it("serbest alandaki Euro metnini cent'e çevirir", () => {
    expect(parseTipInput("2,50", 5000)).toBe(250);
    expect(parseTipInput("2.5", 5000)).toBe(250);
    expect(parseTipInput("3", 5000)).toBe(300);
    expect(parseTipInput("", 5000)).toBe(0);
    expect(parseTipInput("abc", 5000)).toBe(0);
    // Virgülü kaçmış girdi sessizce tahsil edilmez, sınırda durur.
    expect(parseTipInput("500", 2000)).toBe(2000);
  });
});
