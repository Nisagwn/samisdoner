import { describe, expect, it } from "vitest";
import { grundpreisLabel, parseLiters, pricePerLiterCents } from "@/lib/legal/grundpreis";
import { impressumData, datenschutzData, agbData, widerrufData } from "@/lib/legal/content";

/* ═══════════════════════════════════════════ PAngV § 4 — temel fiyat */

describe("parseLiters", () => {
  it("menüdeki içecek boylarını litre olarak okur", () => {
    expect(parseLiters("0,25")).toBeCloseTo(0.25);
    expect(parseLiters("0,33")).toBeCloseTo(0.33);
    expect(parseLiters("0,50")).toBeCloseTo(0.5);
  });

  it("birimli yazımları destekler", () => {
    expect(parseLiters("0,5 l")).toBeCloseTo(0.5);
    expect(parseLiters("0.5L")).toBeCloseTo(0.5);
    expect(parseLiters("330 ml")).toBeCloseTo(0.33);
    expect(parseLiters("33 cl")).toBeCloseTo(0.33);
  });

  it("pizza çapını hacim SANMAZ", () => {
    // Bu testin sebebi somut: menüde "28 CM" ve "32 CM" boyları var. Bunları
    // litre okuyan bir ayrıştırıcı, pizzanın yanına "0,32 €/l" yazardı.
    expect(parseLiters("28 CM")).toBeNull();
    expect(parseLiters("32 CM")).toBeNull();
  });

  it("hacim olmayan etiketleri reddeder", () => {
    expect(parseLiters("Rolle")).toBeNull();
    expect(parseLiters("gr.")).toBeNull();
    expect(parseLiters("")).toBeNull();
    expect(parseLiters("   ")).toBeNull();
  });

  it("birimsiz tam sayıyı litre saymaz", () => {
    // "12" adet mi litre mi belli değil; tahmin etmektense hiç göstermemek.
    expect(parseLiters("12")).toBeNull();
    expect(parseLiters("1")).toBeNull();
  });

  it("akıl dışı hacmi reddeder", () => {
    expect(parseLiters("50 l")).toBeNull();
    expect(parseLiters("0")).toBeNull();
    expect(parseLiters("-1,5")).toBeNull();
  });
});

describe("pricePerLiterCents", () => {
  it("litre fiyatını en yakına yuvarlar", () => {
    // 2,50 € / 0,33 l = 7,5757… €/l → 758 cent
    expect(pricePerLiterCents(250, 0.33)).toBe(758);
    expect(pricePerLiterCents(150, 0.5)).toBe(300);
  });

  it("geçersiz girdide null döner", () => {
    expect(pricePerLiterCents(0, 0.5)).toBeNull();
    expect(pricePerLiterCents(250, 0)).toBeNull();
    expect(pricePerLiterCents(Number.NaN, 0.5)).toBeNull();
  });
});

describe("grundpreisLabel", () => {
  it("hacimli boyda litre fiyatını biçimlendirir", () => {
    expect(grundpreisLabel("0,33", 250)).toBe("7,58 €/l");
    expect(grundpreisLabel("0,50", 300)).toBe("6,00 €/l");
  });

  it("hacim olmayan boyda hiçbir şey göstermez", () => {
    expect(grundpreisLabel("28 CM", 1200)).toBeNull();
    expect(grundpreisLabel("Rolle", 800)).toBeNull();
  });
});

/* ══════════════════════════════════════════════ yasal belge içeriği */

describe("yasal belgeler", () => {
  const documents = [impressumData(), datenschutzData(), agbData(), widerrufData()];

  it("hepsinde başlık, tarih ve en az bir bölüm var", () => {
    for (const doc of documents) {
      expect(doc.title.de.length).toBeGreaterThan(0);
      expect(doc.title.tr.length).toBeGreaterThan(0);
      expect(doc.updated).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
      expect(doc.sections.length).toBeGreaterThan(0);
    }
  });

  it("her bölümün her bloğu iki dilde de doludur", () => {
    for (const doc of documents) {
      for (const section of doc.sections) {
        expect(section.heading.de.length).toBeGreaterThan(0);
        expect(section.heading.tr.length).toBeGreaterThan(0);
        for (const block of section.blocks) {
          if (block.kind === "p" || block.kind === "note") {
            expect(block.de.length).toBeGreaterThan(0);
            expect(block.tr.length).toBeGreaterThan(0);
          }
          if (block.kind === "ul") {
            expect(block.items.length).toBeGreaterThan(0);
            for (const item of block.items) {
              expect(item.de.length).toBeGreaterThan(0);
              expect(item.tr.length).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });

  it("Impressum zorunlu maddeleri sayar", () => {
    const text = JSON.stringify(impressumData());
    expect(text).toContain("§ 5 DDG");
    expect(text).toContain("§ 27a UStG");
    expect(text).toContain("VSBG");
  });

  it("Impressum kapatılmış OS-Plattform'a bağlantı VERMEZ", () => {
    // AB'nin çevrimiçi uyuşmazlık platformu kapatıldı; çalışmayan bir bağlantı
    // Impressum'da tutmak kendisi uyarı sebebidir.
    const text = JSON.stringify(impressumData());
    expect(text).not.toContain("ec.europa.eu/consumers/odr");
  });

  it("Datenschutz DSGVO dayanaklarını ve denetim makamını içerir", () => {
    const text = JSON.stringify(datenschutzData());
    expect(text).toContain("Art. 6 Abs. 1 lit. b");
    expect(text).toContain("BayLDA");
    expect(text).toContain("Stripe");
  });

  it("AGB Button-Lösung'a uygun sözleşme kuruluşunu anlatır", () => {
    const text = JSON.stringify(agbData());
    expect(text).toContain("Zahlungspflichtig bestellen");
    expect(text).toContain("§ 312g Abs. 2 Nr. 2 BGB");
  });

  it("Widerrufsbelehrung örnek formu içerir", () => {
    const text = JSON.stringify(widerrufData());
    expect(text).toContain("Muster-Widerrufsformular");
    expect(text).toContain("vierzehn Tagen");
  });
});
