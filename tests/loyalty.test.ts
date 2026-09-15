import { describe, expect, it } from "vitest";
import { STAMPS_PER_REWARD, stampMath } from "@/lib/account/loyalty";
import { normalizePhone } from "@/lib/account/claim";

/**
 * Damga kartı ve misafir siparişi bağlama.
 *
 * İkisi de aynı sınıf hataya açık: sessizce yanlış olmak. Fazladan verilen bir
 * ödül ya da yanlış hesaba bağlanan bir sipariş, kimse şikâyet edene kadar
 * fark edilmez — ve şikâyet geldiğinde de geri alınamaz.
 */

describe("damga kartı aritmetiği", () => {
  it("hiç sipariş yoksa kart boştur", () => {
    expect(stampMath(0, 0)).toEqual({ stamps: 0, rewardsToIssue: 0, throughAfter: 0 });
  });

  it("eşiğin altında ödül açmaz", () => {
    const result = stampMath(STAMPS_PER_REWARD - 1, 0);
    expect(result.rewardsToIssue).toBe(0);
    expect(result.stamps).toBe(STAMPS_PER_REWARD - 1);
  });

  it("eşiğe tam ulaşınca bir ödül açar ve kartı sıfırlar", () => {
    expect(stampMath(STAMPS_PER_REWARD, 0)).toEqual({
      stamps: 0,
      rewardsToIssue: 1,
      throughAfter: STAMPS_PER_REWARD,
    });
  });

  it("aynı siparişler ikinci kez ödüle dönüşmez", () => {
    // Ödül verildikten sonra tekrar bakıldığında yeni ödül çıkmamalı:
    // `consumed` tam da bunu engelliyor.
    const after = stampMath(STAMPS_PER_REWARD, STAMPS_PER_REWARD);
    expect(after).toEqual({
      stamps: 0,
      rewardsToIssue: 0,
      throughAfter: STAMPS_PER_REWARD,
    });
  });

  it("biriken birden fazla ödülü tek seferde açar", () => {
    // Hesabına aylardır bakmayan müşteri: 25 teslimat, iki ödül, beş damga.
    const result = stampMath(25, 0, 10);
    expect(result).toEqual({ stamps: 5, rewardsToIssue: 2, throughAfter: 20 });
  });

  it("kısmen harcanmış kartta kalan damgayı doğru sayar", () => {
    // 10 ödüle çevrilmiş, toplam 13 teslimat → üç damga.
    expect(stampMath(13, 10, 10)).toEqual({
      stamps: 3,
      rewardsToIssue: 0,
      throughAfter: 10,
    });
  });

  it("veri düzeltmesi sonrası eksi damga göstermez", () => {
    // `consumed` teslimat sayısından büyük olabilir (iptal edilip düzeltilmiş
    // bir sipariş). Eksi damga göstermektense sıfırda durmak doğru.
    expect(stampMath(3, 10, 10)).toEqual({
      stamps: 0,
      rewardsToIssue: 0,
      throughAfter: 10,
    });
  });

  it("eşik değiştiğinde yeni eşiğe göre hesaplar", () => {
    // Kampanya eşiği düşerse, verilmiş ödüller yerinde kalır (throughAfter
    // `consumed`'dan hesaplanıyor) ama yeni sayım yeni eşikle yapılır.
    expect(stampMath(12, 0, 5)).toEqual({ stamps: 2, rewardsToIssue: 2, throughAfter: 10 });
  });
});

describe("telefon normalizasyonu", () => {
  it("aynı numaranın farklı yazımlarını eşitler", () => {
    // Müşteri o gün "0170 1234567" yazmış olabilir, bugün "+49 170 1234567".
    // Biçim farkı yüzünden kendi siparişini alamamak, kuralın koruduğu şeyle
    // ilgisi olmayan bir engel olurdu.
    const expected = "1701234567";
    for (const input of [
      "0170 1234567",
      "+49 170 1234567",
      "0049 170 1234567",
      "0170-123 45 67",
      "(0170) 1234567",
    ]) {
      expect(normalizePhone(input)).toBe(expected);
    }
  });

  it("farklı numaraları eşitlemez", () => {
    expect(normalizePhone("0170 1234567")).not.toBe(normalizePhone("0170 7654321"));
  });

  it("kısa ya da boş girdide kısa bir değer üretir", () => {
    // Çağıran taraf uzunluğa bakıp reddediyor; burada yapılan iş yalnızca
    // rakamları ayıklamak.
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("---")).toBe("");
    expect(normalizePhone("0123").length).toBeLessThan(6);
  });

  it("ülke kodu olmayan kısa numarayı bozmaz", () => {
    // "49" ile başlayan ama ülke kodu olmayan kısa bir numara kırpılmamalı.
    expect(normalizePhone("4912345")).toBe("4912345");
  });
});
