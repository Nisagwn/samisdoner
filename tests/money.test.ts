import { describe, expect, it } from "vitest";
import { formatCents, formatEuro, toCents, toEuro } from "@/lib/money";
import { buildVatBreakdown, type PricedLine } from "@/lib/admin/store";

/**
 * Para hesabı.
 *
 * Buradaki her testin karşılığı gerçek bir hata sınıfıdır: bir cent'lik sapma
 * ödeme sağlayıcısında toplamın tutmamasına, KDV dökümünün toplamı tutmaması
 * ise faturanın vergi denetiminde reddedilmesine yol açar.
 */

describe("toCents", () => {
  it("Euro'yu cent'e çevirir", () => {
    expect(toCents(7)).toBe(700);
    expect(toCents(7.5)).toBe(750);
    expect(toCents(0.01)).toBe(1);
  });

  it("kayan nokta hatasını yutar", () => {
    // 8.15 * 100 = 814.9999999999999 — Math.round olmadan 814 çıkardı.
    expect(toCents(8.15)).toBe(815);
    expect(toCents(12.3)).toBe(1230);
    expect(toCents(0.29)).toBe(29);
  });

  it("üç ondalıklı bir fiyat aşağı yuvarlanabilir — kabul edilen sınır", () => {
    // 1.005 ikili sistemde tam gösterilemez (1.00499999999999989…), bu yüzden
    // 100 çıkar, 101 değil. Bu bir hata değil, çift duyarlıklı sayının doğası:
    // düzeltmek ondalık aritmetiğe geçmeyi gerektirir.
    //
    // Neden sorun değil: katalogdaki her fiyat **iki ondalıklıdır** ve
    // toplama/çarpma işlemleri Euro'da değil, dönüşümden SONRA cent üzerinde
    // yapılır. Yani bu sınır, sistemin fiilen kullandığı yolda hiç oluşmaz.
    // Test, davranışın bilinerek kabul edildiğini kayda geçirmek için var —
    // biri "1,005 € girdim, 1,00 € oldu" derse cevabı burada yazıyor.
    expect(toCents(1.005)).toBe(100);
  });

  it("geçersiz girdiyi 0 sayar; NaN yaymaz", () => {
    expect(toCents(Number.NaN)).toBe(0);
    expect(toCents(Number.POSITIVE_INFINITY)).toBe(0);
    expect(toCents("7" as unknown as number)).toBe(0);
  });
});

describe("formatCents", () => {
  it("Almanya biçiminde iki basamak yazar", () => {
    expect(formatCents(750)).toBe("7,50 €");
    expect(formatCents(700)).toBe("7,00 €");
    expect(formatCents(5)).toBe("0,05 €");
    expect(formatCents(0)).toBe("0,00 €");
  });

  it("negatif tutarda işareti öne alır", () => {
    // İade satırlarında görülür; "0,-5 €" gibi bir çıktı kabul edilemez.
    expect(formatCents(-250)).toBe("-2,50 €");
  });

  it("bozuk girdide 0 gösterir", () => {
    expect(formatCents(Number.NaN)).toBe("0,00 €");
  });
});

describe("toEuro / formatEuro", () => {
  it("gidiş dönüş değeri korur", () => {
    expect(toEuro(toCents(12.34))).toBe(12.34);
    expect(formatEuro(12.3)).toBe("12,30 €");
  });
});

/* ----------------------------------------------------------- KDV dökümü */

function line(lineCents: number, vatRate: number, unavailable = false): PricedLine {
  return {
    key: `k${lineCents}-${vatRate}`,
    input: { kind: "product", productId: "p", qty: 1 },
    label: "Test",
    detail: "",
    unitCents: lineCents,
    lineCents,
    qty: 1,
    vatRate,
    unavailable,
  };
}

describe("buildVatBreakdown", () => {
  it("tek oranlı sepette brüt = satır toplamı + yan edim", () => {
    const buckets = buildVatBreakdown([line(1000, 7)], 200);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].rate).toBe(7);
    expect(buckets[0].grossCents).toBe(1200);
    // 1200 brüt, %7 → net 1121, KDV 79 (1200 / 1.07 = 1121.49…)
    expect(buckets[0].netCents + buckets[0].vatCents).toBe(1200);
  });

  it("karışık %7/%19 sepette brüt toplamı genel toplama eşittir", () => {
    // Yuvarlama artığının kaybolmadığını gösteren asıl test: dökümün brüt
    // toplamı, müşteriden tahsil edilen tutarla BİREBİR aynı olmak zorunda.
    const lines = [line(777, 7), line(333, 19), line(111, 7)];
    const extra = 250;
    const total = 777 + 333 + 111 + extra;

    const buckets = buildVatBreakdown(lines, extra);
    const gross = buckets.reduce((sum, b) => sum + b.grossCents, 0);

    expect(gross).toBe(total);
    for (const bucket of buckets) {
      expect(bucket.netCents + bucket.vatCents).toBe(bucket.grossCents);
    }
  });

  it("bölünemeyen yan edimde bile toplam tutar", () => {
    // 1 cent üç orana bölünemez; artık en son paya eklenmeli, yok olmamalı.
    const buckets = buildVatBreakdown([line(100, 7), line(100, 19)], 1);
    expect(buckets.reduce((s, b) => s + b.grossCents, 0)).toBe(201);
  });

  it("satın alınamayan satırı hesaba katmaz", () => {
    const buckets = buildVatBreakdown([line(1000, 7), line(9999, 19, true)], 0);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].grossCents).toBe(1000);
  });

  it("boş sepette boş döküm verir", () => {
    expect(buildVatBreakdown([], 0)).toEqual([]);
    expect(buildVatBreakdown([line(500, 7, true)], 0)).toEqual([]);
  });

  it("oranları küçükten büyüğe sıralar", () => {
    const buckets = buildVatBreakdown([line(100, 19), line(100, 7)], 0);
    expect(buckets.map((b) => b.rate)).toEqual([7, 19]);
  });
});
