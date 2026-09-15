import { describe, expect, it } from "vitest";
import {
  defaultSelection,
  describeSelection,
  isSingleChoice,
  missingRequiredGroups,
  normalizeNote,
  normalizeSelection,
  optionsKeyPart,
  selectionSurchargeCents,
  type OptionGroup,
} from "@/lib/menu/options";

/**
 * Ürün seçeneklerinin kuralları.
 *
 * Buradaki her testin karşılığı gerçek bir para ya da mutfak hatasıdır:
 * eksik seçimle sipariş geçmesi, ek ücretin toplanmaması, aynı yapılandırmanın
 * sepette iki satır açması.
 */

const meat: OptionGroup = {
  id: "g-meat",
  name: "Fleisch",
  nameTr: "Et türü",
  minSelect: 1,
  maxSelect: 1,
  choices: [
    { id: "c-kalb", name: "Kalbfleisch", nameTr: "Dana", priceCents: 0, isDefault: false },
    { id: "c-huhn", name: "Hähnchen", nameTr: "Tavuk", priceCents: 0, isDefault: false },
    { id: "c-lamm", name: "Lamm", nameTr: "Kuzu", priceCents: 150, isDefault: false },
  ],
};

const extras: OptionGroup = {
  id: "g-extra",
  name: "Extras",
  nameTr: "Ekstralar",
  minSelect: 0,
  maxSelect: 2,
  choices: [
    { id: "c-kaese", name: "Extra Käse", nameTr: "Ekstra peynir", priceCents: 100, isDefault: false },
    { id: "c-soss", name: "Extra Soße", nameTr: "Ekstra sos", priceCents: 50, isDefault: false },
    { id: "c-salat", name: "Extra Salat", nameTr: "Ekstra salata", priceCents: 0, isDefault: false },
  ],
};

const groups = [meat, extras];

describe("grup türü", () => {
  it("üst sınırı 1 olan grup tek seçimliktir", () => {
    expect(isSingleChoice(meat)).toBe(true);
    expect(isSingleChoice(extras)).toBe(false);
  });
});

describe("varsayılan seçim", () => {
  it("zorunlu tek seçimli grupta ilk seçeneği işaretler", () => {
    // Müşteriyi boş bir zorunlu grupla karşılamamak için; fiyat ilk andan doğru.
    expect(defaultSelection([meat])).toEqual(["c-kalb"]);
  });

  it("isteğe bağlı grubu boş bırakır — ücretli ekstra kendiliğinden eklenmez", () => {
    expect(defaultSelection([extras])).toEqual([]);
  });

  it("işaretli varsayılan varsa onu kullanır", () => {
    const withDefault: OptionGroup = {
      ...meat,
      choices: meat.choices.map((c) => (c.id === "c-huhn" ? { ...c, isDefault: true } : c)),
    };
    expect(defaultSelection([withDefault])).toEqual(["c-huhn"]);
  });
});

describe("seçim süzme", () => {
  it("tanınmayan kimlikleri düşürür", () => {
    expect(normalizeSelection(groups, ["c-kalb", "uydurma"])).toEqual(["c-kalb"]);
  });

  it("üst sınırı aşan seçimi grup sırasına göre kırpar", () => {
    const result = normalizeSelection(groups, ["c-kaese", "c-soss", "c-salat"]);
    expect(result).toEqual(["c-kaese", "c-soss"]);
  });

  it("sırayı kanonikleştirir: seçim sırası satır anahtarını değiştirmez", () => {
    const a = normalizeSelection(groups, ["c-soss", "c-kaese", "c-kalb"]);
    const b = normalizeSelection(groups, ["c-kalb", "c-kaese", "c-soss"]);
    expect(a).toEqual(b);
    expect(optionsKeyPart(a)).toBe(optionsKeyPart(b));
  });
});

describe("ek ücret", () => {
  it("seçili seçeneklerin ek ücretlerini toplar", () => {
    expect(selectionSurchargeCents(groups, ["c-lamm", "c-kaese"])).toBe(250);
  });

  it("ücretsiz seçenekler toplamı değiştirmez", () => {
    expect(selectionSurchargeCents(groups, ["c-kalb", "c-salat"])).toBe(0);
  });

  it("seçilmemiş seçeneği hesaba katmaz", () => {
    expect(selectionSurchargeCents(groups, [])).toBe(0);
  });
});

describe("zorunlu grup kontrolü", () => {
  it("et türü seçilmediyse eksik bildirir", () => {
    expect(missingRequiredGroups(groups, ["c-kaese"]).map((g) => g.id)).toEqual(["g-meat"]);
  });

  it("seçildiyse eksik kalmaz", () => {
    expect(missingRequiredGroups(groups, ["c-huhn"])).toEqual([]);
  });

  it("isteğe bağlı grubun boş kalması eksik sayılmaz", () => {
    expect(missingRequiredGroups([extras], [])).toEqual([]);
  });

  it("alt sınırı 2 olan grupta tek seçim yetmez", () => {
    const twoSauces: OptionGroup = { ...extras, minSelect: 2 };
    expect(missingRequiredGroups([twoSauces], ["c-kaese"]).map((g) => g.id)).toEqual(["g-extra"]);
    expect(missingRequiredGroups([twoSauces], ["c-kaese", "c-soss"])).toEqual([]);
  });
});

describe("seçim özeti", () => {
  it("dile göre ad verir ve grup sırasını korur", () => {
    expect(describeSelection(groups, ["c-kaese", "c-huhn"], "de")).toBe("Hähnchen, Extra Käse");
    expect(describeSelection(groups, ["c-kaese", "c-huhn"], "tr")).toBe("Tavuk, Ekstra peynir");
  });

  it("Türkçe karşılığı yoksa Almanca ada düşer", () => {
    const noTr: OptionGroup = {
      ...meat,
      choices: [{ id: "c-x", name: "Pide", nameTr: "", priceCents: 0, isDefault: false }],
    };
    expect(describeSelection([noTr], ["c-x"], "tr")).toBe("Pide");
  });
});

describe("not sadeleştirme", () => {
  it("baştaki/sondaki boşluğu ve tekrar eden boşlukları atar", () => {
    expect(normalizeNote("  ohne   Zwiebeln  ")).toBe("ohne Zwiebeln");
  });

  it("aynı notun iki yazımı aynı satır anahtarını üretir", () => {
    expect(normalizeNote("ohne Zwiebeln ")).toBe(normalizeNote(" ohne  Zwiebeln"));
  });

  it("üst sınırı aşan notu kırpar", () => {
    expect(normalizeNote("a".repeat(300)).length).toBe(140);
  });

  it("tanımsız not boş dizeye düşer", () => {
    expect(normalizeNote(undefined)).toBe("");
  });
});
