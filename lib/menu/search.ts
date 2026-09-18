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
 *
 * Birden çok kelime **ayrı ayrı** aranır ve hepsi bulunmalıdır: müşteri
 * "teller pommes" yazdığında adı "Drehspieß Teller", içeriği "Pommes, Salat"
 * olan ürünü bekler — iki kelimenin yan yana geçmesini değil.
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

/** Aramanın baktığı en küçük kategori şekli. */
export type SearchableSection<I extends SearchableItem> = {
  title: string;
  titleTr?: string;
  items: I[];
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
    // Kesme işareti yazımdan yazıma değişir ("Snack's", "Sami´s"); müşteri
    // çoğunlukla hiç yazmaz. Tamamen atılır ki "snacks" → "Snack's" bulsun.
    .replace(/['’‘´`]/g, "")
    // Tire ve noktalama kelime ayırıcıdır: "Coca-Cola" ile "coca cola" aynı.
    .replace(/[-–/.,;:()!?+&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Arama kutusundaki metnin aranabilir hâli; boşsa "" döner. */
export function normalizeNeedle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Ürünün (ve varsa kategorisinin) aranabilir metinlerini tek dizeye toplar. */
function haystackOf(item: SearchableItem, context: readonly (string | undefined)[]): string {
  const parts: (string | undefined)[] = [
    item.no, item.name, item.nameTr, item.desc, item.descTr, ...context,
  ];
  for (const group of item.optionGroups ?? []) {
    for (const choice of group.choices) {
      parts.push(choice.name, choice.nameTr);
    }
  }
  return parts.filter(Boolean).join(" ");
}

/** Metin, aranan her kelimeyi (iki katlamadan biriyle) içeriyor mu. */
function containsEveryWord(text: string, needle: string): boolean {
  const hayStrip = fold(text, STRIP);
  const hayExpand = fold(text, EXPAND);
  const words = fold(needle, STRIP).split(" ").filter(Boolean);
  const wordsExpand = fold(needle, EXPAND).split(" ").filter(Boolean);
  // Yalnızca noktalamadan oluşan arama ("-") hiçbir kelime bırakmaz; süzgeç
  // yokmuş gibi davranılır.
  if (words.length === 0) return true;
  return words.every(
    (word, i) => hayStrip.includes(word) || hayExpand.includes(wordsExpand[i] ?? word)
  );
}

/**
 * Ürün aranan metni içeriyor mu.
 *
 * Boş arama her ürüne uyar: süzgeç yokken liste daralmamalı.
 *
 * `context` ürünün dışındaki ama müşterinin onunla aradığı metinlerdir —
 * pratikte kategori adı: "Getränke" ya da "pizza" yazan müşteri o kategorinin
 * tamamını bekler, oysa "Coca Cola" satırında "Getränke" kelimesi geçmez.
 */
export function matchesMenuItem(
  item: SearchableItem,
  rawNeedle: string,
  context: readonly (string | undefined)[] = []
): boolean {
  const needle = normalizeNeedle(rawNeedle);
  if (!needle) return true;
  return containsEveryWord(haystackOf(item, context), needle);
}

/**
 * Aramanın kategori listesine uygulanmış hâli.
 *
 * Süzgeç kategoriyi değil ürünü eler; hiç ürünü kalmayan kategori listeden
 * tamamen düşer, böylece boş başlıklar arasında gezinmek gerekmez. Kategori
 * adı her ürünün aranabilir metnine eklenir (bkz. `matchesMenuItem`).
 *
 * Boş aramada **aynı dizi** döner; çağıran taraf referans eşitliğine
 * güvenerek gereksiz yeniden çizimden kaçınabilir.
 */
export function filterMenuSections<I extends SearchableItem, S extends SearchableSection<I>>(
  sections: S[],
  rawNeedle: string
): S[] {
  const needle = normalizeNeedle(rawNeedle);
  if (!needle) return sections;
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        matchesMenuItem(item, needle, [section.title, section.titleTr])
      ),
    }))
    .filter((section) => section.items.length > 0);
}
