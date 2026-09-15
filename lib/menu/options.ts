/**
 * Ürün seçenek grupları — saf kurallar.
 *
 * Menüdeki bir döner "tek bir şey" değildir: et türü seçilir (zorunlu, tek
 * seçim), sos seçilir (çoklu), ekstra peynir eklenir (ek ücretli). Bu dosya o
 * seçimlerin **kuralını** tutar; veritabanı, React ve fiyat biçimlendirmesi
 * hakkında hiçbir şey bilmez.
 *
 * Neden ayrı modül: aynı kural üç yerde birden geçerli olmak zorunda —
 * modalde (müşteri neyi seçebilir), sepette (satırın tarifi) ve sunucuda
 * (tahsil edilen tutar). Üç ayrı kopya, üçünün sessizce ayrışması demekti;
 * bu yüzden kural tek yerde ve test edilebilir.
 *
 * Para burada da **cent (Int)**. Ek ücret taban fiyata eklenir, çarpılmaz:
 * "iki adet ekstra peynirli döner" = (taban + peynir) × 2.
 */

export type OptionChoice = {
  id: string;
  /** Almanca ad — müşteri tarafının varsayılanı. */
  name: string;
  /** Türkçe ad; boşsa `name` kullanılır. */
  nameTr: string;
  /** Taban fiyata eklenen ek ücret (cent). 0 = dahil. */
  priceCents: number;
  /** Modal açıldığında önden işaretli gelir. */
  isDefault: boolean;
};

export type OptionGroup = {
  id: string;
  name: string;
  nameTr: string;
  /**
   * En az kaç seçenek işaretlenmeli. 0 = grup tamamen isteğe bağlı.
   *
   * Zorunluluk bir gösterim tercihi değil: "et türü" seçilmeden mutfağa giden
   * bir sipariş satırı hazırlanamaz. Bu yüzden kural sunucuda da uygulanır.
   */
  minSelect: number;
  /** En fazla kaç seçenek işaretlenebilir. 1 ise tek seçim (radyo). */
  maxSelect: number;
  choices: OptionChoice[];
};

/**
 * Grup tek seçimlik mi.
 *
 * Ayrı bir "mode" sütunu yok: üst sınır zaten bu bilgiyi taşıyor ve iki alanın
 * birbiriyle çelişebilmesi (mode=single ama maxSelect=3) mümkün olmuyor.
 */
export function isSingleChoice(group: OptionGroup): boolean {
  return group.maxSelect <= 1;
}

export function isRequiredGroup(group: OptionGroup): boolean {
  return group.minSelect > 0;
}

/** Seçeneğin müşteriye gösterilecek adı. */
export function choiceLabel(choice: OptionChoice, lang: "tr" | "de"): string {
  return lang === "tr" ? choice.nameTr || choice.name : choice.name;
}

/** Grubun müşteriye gösterilecek başlığı. */
export function groupLabel(group: OptionGroup, lang: "tr" | "de"): string {
  return lang === "tr" ? group.nameTr || group.name : group.name;
}

/**
 * Modal ilk açıldığında işaretli gelecek seçenekler.
 *
 * Zorunlu tek seçimli grupta işaretli bir seçenek yoksa ilk seçenek seçilir:
 * müşteriyi "önce şunu seç" duvarına toslatmadan açmak, hem hızlı hem de
 * fiyatı ilk andan doğru gösterir. İsteğe bağlı grup boş başlar — ekstra
 * peyniri müşteri istemeden işaretlemek, sessizce para eklemek olurdu.
 */
export function defaultSelection(groups: OptionGroup[]): string[] {
  const out: string[] = [];
  for (const group of groups) {
    const marked = group.choices.filter((c) => c.isDefault).slice(0, Math.max(group.maxSelect, 0));
    if (marked.length > 0) {
      out.push(...marked.map((c) => c.id));
      continue;
    }
    if (isRequiredGroup(group) && isSingleChoice(group) && group.choices.length > 0) {
      out.push(group.choices[0].id);
    }
  }
  return out;
}

/**
 * Seçim listesini kurallara göre süzer ve **kanonik sıraya** sokar.
 *
 * Kanonik sıra şart: sepette aynı yapılandırma aynı satır olmalı. Müşteri
 * sosu peynirden önce işaretlediyse de sonra işaretlediyse de satır anahtarı
 * aynı çıkmalı, yoksa sepette iki özdeş satır belirir.
 *
 * Tanınmayan kimlikler sessizce düşer (silinmiş seçenek, kurcalanmış gövde),
 * üst sınırı aşan seçimler grup sırasına göre kırpılır.
 */
export function normalizeSelection(groups: OptionGroup[], ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  const out: string[] = [];
  for (const group of groups) {
    const limit = Math.max(group.maxSelect, 0);
    let taken = 0;
    for (const choice of group.choices) {
      if (taken >= limit) break;
      if (!wanted.has(choice.id)) continue;
      out.push(choice.id);
      taken += 1;
    }
  }
  return out;
}

/** Seçili seçeneklerin toplam ek ücreti (cent). */
export function selectionSurchargeCents(
  groups: OptionGroup[],
  ids: readonly string[]
): number {
  const wanted = new Set(ids);
  let sum = 0;
  for (const group of groups) {
    for (const choice of group.choices) {
      if (wanted.has(choice.id)) sum += choice.priceCents;
    }
  }
  return sum;
}

/**
 * Alt sınırı karşılanmamış zorunlu gruplar.
 *
 * Boş liste "sipariş edilebilir" demektir. Arayüz bunu düğmeyi kilitlemek,
 * sunucu ise satırı fiyatlanamaz saymak için kullanır — aynı fonksiyon, tek
 * kural.
 */
export function missingRequiredGroups(
  groups: OptionGroup[],
  ids: readonly string[]
): OptionGroup[] {
  const wanted = new Set(ids);
  return groups.filter((group) => {
    if (!isRequiredGroup(group)) return false;
    const chosen = group.choices.filter((c) => wanted.has(c.id)).length;
    return chosen < group.minSelect;
  });
}

/** Seçimin sepette/mutfakta okunacak özeti: "Kalbsfleisch, Scharf". */
export function describeSelection(
  groups: OptionGroup[],
  ids: readonly string[],
  lang: "tr" | "de"
): string {
  const wanted = new Set(ids);
  const parts: string[] = [];
  for (const group of groups) {
    for (const choice of group.choices) {
      if (wanted.has(choice.id)) parts.push(choiceLabel(choice, lang));
    }
  }
  return parts.join(", ");
}

/**
 * Satır anahtarının seçenek parçası.
 *
 * Sıralanır: anahtar seçim **sırasından** bağımsız olmalı. `normalizeSelection`
 * zaten kanonik sıra üretir ama sepette eski bir kayıt da olabilir; burada
 * ikinci kez sıralamak, iki yoldan gelen aynı seçimin aynı satıra düşmesini
 * garanti eder.
 */
export function optionsKeyPart(ids: readonly string[]): string {
  return [...ids].sort().join(",");
}

/**
 * Müşteri notunun anahtar parçası.
 *
 * Not satırın parçasıdır: "soğansız döner" ile normal döner aynı satırda
 * toplanamaz, mutfak ikisini ayrı hazırlar. Boşluklar sadeleştirilir ki
 * "soğansız " ile "soğansız" iki ayrı satır olmasın.
 */
export function normalizeNote(note: string | undefined, max = 140): string {
  if (!note) return "";
  return note.replace(/\s+/g, " ").trim().slice(0, max);
}
