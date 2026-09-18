import { describe, expect, it } from "vitest";
import {
  filterMenuSections,
  matchesMenuItem,
  normalizeNeedle,
  type SearchableItem,
} from "@/lib/menu/search";

/**
 * Kartadaki arama.
 *
 * Buradaki testlerin çoğu tek bir hatayı kovalıyor: var olan bir ürünün
 * "bulunamadı" görünmesi. Umlaut'u klavyeden çıkaramayan müşteri, ürünü yok
 * sanıp siteden çıkar.
 */

const doener: SearchableItem = {
  no: "07",
  name: "Hähnchendöner",
  nameTr: "Tavuk döner",
  desc: "Mit Salat und Soße",
  descTr: "Salata ve sosla",
  optionGroups: [
    {
      choices: [
        { name: "Extra Käse", nameTr: "Ekstra peynir" },
        { name: "Scharfe Soße", nameTr: "Acı sos" },
      ],
    },
  ],
};

describe("arama metni", () => {
  it("boş arama her ürüne uyar", () => {
    expect(matchesMenuItem(doener, "")).toBe(true);
    expect(matchesMenuItem(doener, "   ")).toBe(true);
  });

  it("boşlukları sadeleştirir", () => {
    expect(normalizeNeedle("  extra   käse ")).toBe("extra käse");
  });
});

describe("umlaut katlama", () => {
  it("umlaut'suz yazımı bulur (kase → Käse)", () => {
    expect(matchesMenuItem(doener, "kase")).toBe(true);
  });

  it("ae açılımını bulur (kaese → Käse)", () => {
    expect(matchesMenuItem(doener, "kaese")).toBe(true);
  });

  it("umlaut'lu yazımı da bulur", () => {
    expect(matchesMenuItem(doener, "Käse")).toBe(true);
  });

  it("ö/ü için de geçerli (doner → Döner)", () => {
    expect(matchesMenuItem(doener, "doner")).toBe(true);
    expect(matchesMenuItem(doener, "doener")).toBe(true);
  });
});

describe("eşleşen alanlar", () => {
  it("menü numarasıyla bulunur", () => {
    expect(matchesMenuItem(doener, "07")).toBe(true);
  });

  it("kelime ortasında da eşleşir", () => {
    // "döner" araması "Hähnchendöner"i de bulmalı.
    expect(matchesMenuItem(doener, "döner")).toBe(true);
  });

  it("Türkçe ad üzerinden bulunur", () => {
    expect(matchesMenuItem(doener, "tavuk")).toBe(true);
  });

  it("içerik açıklamasından bulunur", () => {
    expect(matchesMenuItem(doener, "salat")).toBe(true);
  });

  it("seçenek adından bulunur — müşteri için ikisi aynı şey", () => {
    expect(matchesMenuItem(doener, "scharfe")).toBe(true);
    expect(matchesMenuItem(doener, "acı sos")).toBe(true);
  });

  it("alakasız metni eşleştirmez", () => {
    expect(matchesMenuItem(doener, "pizza")).toBe(false);
  });
});

describe("büyük/küçük harf", () => {
  it("yazım biçimi eşleşmeyi değiştirmez", () => {
    expect(matchesMenuItem(doener, "HÄHNCHEN")).toBe(true);
    expect(matchesMenuItem(doener, "hähnchen")).toBe(true);
  });

  it("Türkçe noktasız ı de katlanır", () => {
    const item: SearchableItem = { name: "Ayran", nameTr: "Ayran ılık" };
    expect(matchesMenuItem(item, "ilik")).toBe(true);
  });
});

describe("birden çok kelime", () => {
  it("kelimeler yan yana geçmek zorunda değil", () => {
    // Ad "Hähnchendöner", içerik "Mit Salat und Soße".
    expect(matchesMenuItem(doener, "soße hähnchen")).toBe(true);
    expect(matchesMenuItem(doener, "doener salat")).toBe(true);
  });

  it("kelimelerden biri yoksa eşleşmez", () => {
    expect(matchesMenuItem(doener, "salat pizza")).toBe(false);
  });
});

describe("noktalama", () => {
  it("kesme işareti yazılmasa da bulur", () => {
    const item: SearchableItem = { name: "Sami's Salat" };
    expect(matchesMenuItem(item, "samis")).toBe(true);
    expect(matchesMenuItem(item, "sami´s")).toBe(true);
  });

  it("tire ile boşluk aynı sayılır", () => {
    const item: SearchableItem = { name: "Coca-Cola" };
    expect(matchesMenuItem(item, "coca cola")).toBe(true);
  });

  it("yalnızca noktalamadan oluşan arama listeyi boşaltmaz", () => {
    expect(matchesMenuItem(doener, "-")).toBe(true);
  });
});

describe("kategori listesi", () => {
  const sections = [
    {
      id: "getraenke",
      title: "Getränke",
      titleTr: "İçecekler",
      items: [{ name: "Coca Cola" }, { name: "Ayran" }] as SearchableItem[],
    },
    { id: "snacks", title: "Snack's", items: [{ name: "Hamburger" }] as SearchableItem[] },
    { id: "drehspiess", title: "Drehspieß", titleTr: "Döner", items: [doener] },
  ];

  it("boş aramada aynı diziyi döndürür", () => {
    expect(filterMenuSections(sections, "  ")).toBe(sections);
  });

  it("kategori adıyla aranınca kategorinin tamamı gelir", () => {
    const result = filterMenuSections(sections, "getranke");
    expect(result.map((s) => s.id)).toEqual(["getraenke"]);
    expect(result[0].items).toHaveLength(2);
  });

  it("Türkçe kategori adıyla da bulunur", () => {
    expect(filterMenuSections(sections, "içecek").map((s) => s.id)).toEqual(["getraenke"]);
    expect(filterMenuSections(sections, "icecek").map((s) => s.id)).toEqual(["getraenke"]);
  });

  it("kesme işaretli kategori adını bulur (snacks → Snack's)", () => {
    expect(filterMenuSections(sections, "snacks").map((s) => s.id)).toEqual(["snacks"]);
  });

  it("ürünü kalmayan kategori düşer", () => {
    const result = filterMenuSections(sections, "ayran");
    expect(result.map((s) => s.id)).toEqual(["getraenke"]);
    expect(result[0].items.map((i) => i.name)).toEqual(["Ayran"]);
  });
});
