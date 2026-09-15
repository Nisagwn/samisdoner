/**
 * Kartadaki arama — saf eşleştirme.
 *
 * Neden ayrı modül ve neden bu kadar uğraş: Almanca menüde arayan bir müşteri
 * "Käse" yazmaz, "kase" ya da "kaese" yazar. Umlaut'u klavyeden çıkarmak
 * telefonlarda ekstra bir dokunuş; eşleşmeyi harfi harfine yapmak, var olan
 * ürünü "bulunamadı" diye göstermek demek.
 *
 * Bu yüzden iki katlama birlikte uygulanır:
 *  - **soyma**: ä→a, ö→o, ü→u, ß→ss  ("kase" → "Käse" bulur)
 *  - **açma**:  ä→ae, ö→oe, ü→ue     ("kaese" → "Käse" bulur)
 *
 * Türkçe harfler de aynı mantıkla soyulur (ı/İ/ş/ğ/ç), çünkü site iki dilli ve
 * Türkçe adlar menüde birebir duruyor.
 *
 * Eşleşme **içerir** mantığıyla çalışır, kelime başı değil: "döner" araması
 * "Hähnchendöner"i de bulmalı.
 */

/** Aramanın baktığı en küçük ürün şekli. */
export type SearchableItem = {
  /** Menü numarası ("07"); rakamla arayan müşteri için. */
  no?: string;
  name: string;
  nameTr?: string;
  desc?: string;
  descTr?: string;
  /**
   * Seçenek adları da aranır: "Extra Käse" bir ürünün içerik satırında değil,
   * seçenek grubunda duruyor olabilir ve müşteri açısından ikisi aynı şey.
   */
  optionGroups?: { choices: { name: string; nameTr: string }[] }[];
};

const STRIP: Record<string, string> = {
  ä: "a", ö: "o", ü: "u", ß: "ss",
  ı: "i", İ: "i", ş: "s", ğ: "g", ç: "c",
};

const EXPAND: Record<string, string> = {
  ä: "ae", ö: "oe", ü: "ue", ß: "ss",
  ı: "i", İ: "i", ş: "s", ğ: "g", ç: "c",
};

function fold(input: string, map: Record<string, string>): string {
  return input
    .toLocaleLowerCase("de-DE")
    .replace(/[äöüßıİşğç]/g, (c) => map[c] ?? c)
    // Aksanlı harfin geri kalanı (é, à …) ayrıştırılıp işareti atılır.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Arama kutusundaki metnin aranabilir hâli; boşsa "" döner. */
export function normalizeNeedle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Ürünün aranabilir metinlerini tek dizeye toplar. */
function haystackOf(item: SearchableItem): string {
  const parts: string[] = [item.no ?? "", item.name, item.nameTr ?? "", item.desc ?? "", item.descTr ?? ""];
  for (const group of item.optionGroups ?? []) {
    for (const choice of group.choices) {
      parts.push(choice.name, choice.nameTr);
    }
  }
  return parts.filter(Boolean).join(" ");
}

/**
 * Ürün aranan metni içeriyor mu.
 *
 * Boş arama her ürüne uyar: süzgeç yokken liste daralmamalı.
 */
export function matchesMenuItem(item: SearchableItem, rawNeedle: string): boolean {
  const needle = normalizeNeedle(rawNeedle);
  if (!needle) return true;

  const text = haystackOf(item);
  return (
    fold(text, STRIP).includes(fold(needle, STRIP)) ||
    fold(text, EXPAND).includes(fold(needle, EXPAND))
  );
}
