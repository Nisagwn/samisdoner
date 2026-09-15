import { describe, expect, it } from "vitest";
import { thresholdProgress } from "@/lib/menu/progress";

/**
 * Sepet eşiklerinin ilerleme hesabı.
 *
 * Tek bir şeyi koruyor: çubuğun doluluğu ile yanındaki yazının aynı şeyi
 * söylemesi. "Çubuk dolu ama hâlâ 2 € eksik" diyen bir sepet, ekrandaki her
 * sayıya olan güveni bitirir.
 */

describe("eşik yokken", () => {
  it("çubuk hiç çizilmez ve engel sayılmaz", () => {
    const result = thresholdProgress(1200, 0);
    expect(result.active).toBe(false);
    expect(result.reached).toBe(true);
    expect(result.remainingCents).toBe(0);
  });
});

describe("eşiğin altında", () => {
  it("kalan tutarı verir", () => {
    expect(thresholdProgress(1200, 1500).remainingCents).toBe(300);
  });

  it("yüzdeyi aşağı yuvarlar — çubuk yazıdan iyimser olmasın", () => {
    // 1499/1500 = %99,93; yukarı yuvarlansaydı çubuk dolu görünürken yazı
    // hâlâ 1 cent isterdi.
    expect(thresholdProgress(1499, 1500).percent).toBe(99);
  });

  it("ulaşılmadı olarak işaretler", () => {
    expect(thresholdProgress(1200, 1500).reached).toBe(false);
  });

  it("boş sepette yüzde sıfırdır", () => {
    expect(thresholdProgress(0, 1500).percent).toBe(0);
  });
});

describe("eşikte ve üstünde", () => {
  it("tam eşikte ulaşılmış sayılır", () => {
    const result = thresholdProgress(1500, 1500);
    expect(result.reached).toBe(true);
    expect(result.percent).toBe(100);
    expect(result.remainingCents).toBe(0);
  });

  it("eşiğin üstünde yüzde 100'ü aşmaz", () => {
    expect(thresholdProgress(9000, 1500).percent).toBe(100);
  });
});

describe("bozuk girdi", () => {
  it("negatif ara toplamı sıfır sayar", () => {
    expect(thresholdProgress(-500, 1500).remainingCents).toBe(1500);
  });

  it("sayı olmayan değerde çökmez", () => {
    expect(thresholdProgress(Number.NaN, 1500).percent).toBe(0);
    expect(thresholdProgress(1200, Number.NaN).active).toBe(false);
  });
});
