import type { ProductPatch } from "./store";
import { DIET_TAGS, MAX_SPICY_LEVEL, VAT_RATES, type DietTag, type Variant } from "./types";
import { isImagePath } from "./imagePath";
import type { OptionGroup } from "@/lib/menu/options";
import type { DeliveryZoneInput } from "@/lib/orders/zones";
import { toCents } from "@/lib/money";

/**
 * İstek gövdesi doğrulaması.
 *
 * Admin de olsa gövde doğrudan diske yazılmaz: alanlar tek tek tiplenip
 * sınırlanır, bilinmeyen alanlar düşürülür.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_TEXT = 400;

function asString(value: unknown, field: string, max = MAX_TEXT, required = true): Result<string> {
  if (typeof value !== "string") {
    return required ? { ok: false, error: `${field} metin olmalı.` } : { ok: true, value: "" };
  }
  const trimmed = value.trim();
  if (required && trimmed.length === 0) return { ok: false, error: `${field} boş olamaz.` };
  if (trimmed.length > max) return { ok: false, error: `${field} en fazla ${max} karakter olabilir.` };
  return { ok: true, value: trimmed };
}

function asPrice(value: unknown, field: string): Result<number> {
  const num = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  if (typeof num !== "number" || !Number.isFinite(num)) {
    return { ok: false, error: `${field} geçerli bir sayı olmalı.` };
  }
  if (num < 0) return { ok: false, error: `${field} negatif olamaz.` };
  if (num > 10000) return { ok: false, error: `${field} çok yüksek.` };
  return { ok: true, value: Math.round(num * 100) / 100 };
}

function asVariants(value: unknown): Result<Variant[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: "Varyasyonlar liste olmalı." };
  if (value.length > 12) return { ok: false, error: "En fazla 12 varyasyon eklenebilir." };

  const variants: Variant[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: "Varyasyon biçimi geçersiz." };
    }
    const entry = raw as Record<string, unknown>;
    const size = asString(entry.size, "Varyasyon adı", 40, false);
    if (!size.ok) return size;
    const price = asPrice(entry.price, "Varyasyon fiyatı");
    if (!price.ok) return price;
    variants.push({ size: size.value, price: price.value });
  }
  return { ok: true, value: variants };
}

/* ------------------------------------------------------- seçenek grupları */

/** Bir üründe makul olan üst sınırlar; üstü kullanılamayacak bir pencere üretir. */
const MAX_GROUPS = 8;
const MAX_CHOICES = 24;

/**
 * Seçenek grupları.
 *
 * İki kural burada uygulanır ve ikisi de veri bütünlüğüyle ilgili:
 *
 *  - `minSelect` asla `maxSelect`'ten büyük olamaz. Olsaydı müşteri o grubu
 *    hiçbir zaman tamamlayamaz ve ürün **hiç sipariş edilemezdi** — hata
 *    panelde değil, müşteri sepete eklemeye çalışırken ortaya çıkardı.
 *  - Zorunlu bir grupta yeterli seçenek yoksa (min 2, elde 1 seçenek) aynı
 *    çıkmaz doğar; bu yüzden seçenek sayısı da kontrol edilir.
 *
 * Tek seçimli grupta birden çok varsayılan işaretlenemez: pencere açıldığında
 * hangisinin geçerli olacağı belirsiz kalırdı.
 */
function asOptionGroups(value: unknown): Result<OptionGroup[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: "Seçenek grupları liste olmalı." };
  if (value.length > MAX_GROUPS) {
    return { ok: false, error: `En fazla ${MAX_GROUPS} seçenek grubu eklenebilir.` };
  }

  const groups: OptionGroup[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: "Seçenek grubu biçimi geçersiz." };
    }
    const entry = raw as Record<string, unknown>;

    const name = asString(entry.name, "Seçenek grubu adı", 80);
    if (!name.ok) return name;
    const nameTr = asString(entry.nameTr, "Türkçe grup adı", 80, false);
    if (!nameTr.ok) return nameTr;

    const choicesRaw = entry.choices;
    if (!Array.isArray(choicesRaw)) {
      return { ok: false, error: `„${name.value}“ grubunda seçenek listesi yok.` };
    }
    if (choicesRaw.length === 0) {
      return { ok: false, error: `„${name.value}“ grubuna en az bir seçenek eklemelisiniz.` };
    }
    if (choicesRaw.length > MAX_CHOICES) {
      return {
        ok: false,
        error: `„${name.value}“ grubunda en fazla ${MAX_CHOICES} seçenek olabilir.`,
      };
    }

    const choices: OptionGroup["choices"] = [];
    for (const rawChoice of choicesRaw) {
      if (typeof rawChoice !== "object" || rawChoice === null) {
        return { ok: false, error: "Seçenek biçimi geçersiz." };
      }
      const c = rawChoice as Record<string, unknown>;

      const choiceName = asString(c.name, "Seçenek adı", 80);
      if (!choiceName.ok) return choiceName;
      const choiceNameTr = asString(c.nameTr, "Türkçe seçenek adı", 80, false);
      if (!choiceNameTr.ok) return choiceNameTr;
      const price = asCents(c.price === "" || c.price === undefined ? 0 : c.price, "Ek ücret");
      if (!price.ok) return price;

      choices.push({
        // Kimlik sunucuda üretilir (bkz. store/optionGroupCreateData); panelden
        // gelen bir kimliğe güvenmek, başka bir ürünün seçeneğine bağlanmayı
        // mümkün kılardı.
        id: "",
        name: choiceName.value,
        nameTr: choiceNameTr.value,
        priceCents: price.value,
        isDefault: Boolean(c.isDefault),
      });
    }

    const minSelect = asCount(entry.minSelect, "En az seçim", 0, choices.length);
    if (!minSelect.ok) return minSelect;
    const maxSelect = asCount(entry.maxSelect, "En fazla seçim", 1, choices.length);
    if (!maxSelect.ok) return maxSelect;

    if (minSelect.value > maxSelect.value) {
      return {
        ok: false,
        error: `„${name.value}“ grubunda en az seçim, en fazla seçimden büyük olamaz.`,
      };
    }

    const defaults = choices.filter((c) => c.isDefault).length;
    if (defaults > maxSelect.value) {
      return {
        ok: false,
        error: `„${name.value}“ grubunda en fazla ${maxSelect.value} seçenek varsayılan olabilir.`,
      };
    }

    groups.push({
      id: "",
      name: name.value,
      nameTr: nameTr.value,
      minSelect: minSelect.value,
      maxSelect: maxSelect.value,
      choices,
    });
  }

  return { ok: true, value: groups };
}

function asCount(value: unknown, field: string, min: number, max: number): Result<number> {
  const num = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof num !== "number" || !Number.isFinite(num)) {
    return { ok: false, error: `${field} sayı olmalı.` };
  }
  const rounded = Math.round(num);
  if (rounded < min || rounded > max) {
    return { ok: false, error: `${field} ${min} ile ${max} arasında olmalı.` };
  }
  return { ok: true, value: rounded };
}

/* --------------------------------------------------------------- rozetler */

function asDiet(value: unknown): Result<DietTag> {
  if (value === undefined || value === null || value === "") return { ok: true, value: "NONE" };
  const match = DIET_TAGS.find((tag) => tag === value);
  if (!match) return { ok: false, error: "Beslenme rozeti geçersiz." };
  return { ok: true, value: match };
}

function asSpicyLevel(value: unknown): Result<number> {
  return asCount(value === "" || value === undefined ? 0 : value, "Acılık", 0, MAX_SPICY_LEVEL);
}

/** Görsel: yalnızca hazır görseller (/assets/...) ya da panelden yüklenenler (/uploads/...). */
function asImage(value: unknown): Result<string | null> {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "Görsel yolu metin olmalı." };
  const trimmed = value.trim();
  if (!isImagePath(trimmed)) {
    return { ok: false, error: "Görsel yolu geçersiz. Listeden seçin ya da yeni görsel yükleyin." };
  }
  return { ok: true, value: trimmed };
}

function asSortOrder(value: unknown): Result<number> {
  const num = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof num !== "number" || !Number.isFinite(num)) {
    return { ok: false, error: "Sıra numarası sayı olmalı." };
  }
  if (num < 0 || num > 1_000_000) return { ok: false, error: "Sıra numarası aralık dışı." };
  return { ok: true, value: Math.round(num) };
}

/* ------------------------------------------------------ yasal bilgi alanları */

/**
 * KDV oranı.
 *
 * Serbest sayı kabul edilmez: oran fişte ve KDV dökümünde görünüyor, yanlış
 * bir değer vergi beyanına kadar gider. Steueränderungsgesetz 2025 sonrası
 * geçerli iki oran var — yemek %7, içecek %19 (`VAT_RATES`).
 */
function asVatRate(value: unknown): Result<number> {
  const num = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof num !== "number" || !Number.isFinite(num)) {
    return { ok: false, error: "KDV oranı sayı olmalı." };
  }
  const match = VAT_RATES.find((rate) => rate === num);
  if (match === undefined) {
    return { ok: false, error: `KDV oranı yalnızca ${VAT_RATES.join(" veya ")} olabilir.` };
  }
  return { ok: true, value: match };
}

export function parseProductBody(
  body: unknown,
  categoryIds: string[],
  partial: boolean
): Result<ProductPatch> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Geçersiz istek gövdesi." };
  }
  const input = body as Record<string, unknown>;
  const out: ProductPatch = {};

  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);
  const need = (key: string) => !partial || has(key);

  if (need("name")) {
    const r = asString(input.name, "Ürün adı", 120);
    if (!r.ok) return r;
    out.name = r.value;
  }

  if (need("nameTr")) {
    const r = asString(input.nameTr, "Türkçe ad", 120, false);
    if (!r.ok) return r;
    out.nameTr = r.value;
  }

  if (need("no")) {
    const r = asString(input.no, "Menü numarası", 8, false);
    if (!r.ok) return r;
    out.no = r.value;
  }

  if (need("description")) {
    const r = asString(input.description, "Açıklama", MAX_TEXT, false);
    if (!r.ok) return r;
    out.description = r.value;
  }

  if (need("descriptionTr")) {
    const r = asString(input.descriptionTr, "Türkçe açıklama", MAX_TEXT, false);
    if (!r.ok) return r;
    out.descriptionTr = r.value;
  }

  if (need("categoryId")) {
    const r = asString(input.categoryId, "Kategori", 80);
    if (!r.ok) return r;
    if (!categoryIds.includes(r.value)) {
      return { ok: false, error: "Seçilen kategori bulunamadı." };
    }
    out.categoryId = r.value;
  }

  if (need("price")) {
    const r = asPrice(input.price, "Fiyat");
    if (!r.ok) return r;
    out.price = r.value;
  }

  if (need("discountPrice")) {
    const raw = input.discountPrice;
    if (raw === null || raw === undefined || raw === "") {
      out.discountPrice = null;
    } else {
      const r = asPrice(raw, "İndirimli fiyat");
      if (!r.ok) return r;
      out.discountPrice = r.value;
    }
  }

  if (need("image")) {
    const r = asImage(input.image);
    if (!r.ok) return r;
    out.image = r.value;
  }

  if (need("variants")) {
    const r = asVariants(input.variants);
    if (!r.ok) return r;
    out.variants = r.value;
  }

  // Seçenek grupları yalnızca gönderildiğinde değişir; gönderilmeyen bir PATCH
  // mevcut grupları olduğu gibi bırakır (bkz. store/updateProduct).
  if (has("optionGroups") || !partial) {
    const r = asOptionGroups(input.optionGroups);
    if (!r.ok) return r;
    out.optionGroups = r.value;
  }

  /* --- rozetler: hepsi işletmecinin beyanı, varsayılanları kapalı --- */
  if (has("isPopular")) out.isPopular = Boolean(input.isPopular);
  else if (!partial) out.isPopular = false;

  if (has("isNew")) out.isNew = Boolean(input.isNew);
  else if (!partial) out.isNew = false;

  if (has("diet") || !partial) {
    const r = asDiet(input.diet);
    if (!r.ok) return r;
    out.diet = r.value;
  }

  if (has("spicyLevel") || !partial) {
    const r = asSpicyLevel(input.spicyLevel);
    if (!r.ok) return r;
    out.spicyLevel = r.value;
  }

  if (has("active")) out.active = Boolean(input.active);
  else if (!partial) out.active = true;

  if (has("inStock")) out.inStock = Boolean(input.inStock);
  else if (!partial) out.inStock = true;

  if (has("showOnHome")) out.showOnHome = Boolean(input.showOnHome);
  else if (!partial) out.showOnHome = true;

  // Vitrin bayrağı: yeni ürün varsayılan olarak öne çıkarılmaz, işletmeci
  // bilinçli olarak seçer.
  if (has("featured")) out.featured = Boolean(input.featured);
  else if (!partial) out.featured = false;

  /*
   * Yasal bilgi alanları.
   *
   * Ürün başına alerjen/katkı maddesi girişi kaldırıldı: menüde artık ürün
   * başına kod değil, kartanın ve sipariş sayfasının altında tek bir alerjen
   * uyarısı duruyor. Bu uçta kalan yasal alanlar KDV oranı ve cayma hakkı
   * istisnasıdır; ikisi de para ve sözleşmeyi doğrudan etkiler.
   */
  /*
   * Oran gönderilmediyse yeni üründe yemek oranına düşülür.
   *
   * `asVatRate(undefined)` çağrılıp hata verilmez: bu uca panelden başka
   * yerden de (betik, içe aktarma) ürün açılabilmeli ve o çağrının her
   * seferinde oranı hatırlaması gerekmemeli. Yanlış olan sessiz varsayılan
   * değil, **yanlış** sessiz varsayılandır — bu yüzden panel formunda oran
   * görünür bir alan ve içecek eklerken 19 seçilmesi gerektiği orada yazıyor.
   */
  if (has("vatRate")) {
    const r = asVatRate(input.vatRate);
    if (!r.ok) return r;
    out.vatRate = r.value;
  } else if (!partial) {
    out.vatRate = 7;
  }

  /*
   * § 312g Abs. 2 Nr. 1 BGB — cayma hakkı istisnası yalnızca çabuk bozulan
   * malda. Hazırlanan yemek bozulur, kapalı şişe içecek bozulmaz; bu yüzden
   * varsayılan `true` ama içeceklerde işaret kaldırılmalı.
   */
  if (has("isPerishable")) {
    out.isPerishable = Boolean(input.isPerishable);
  } else if (!partial) {
    out.isPerishable = true;
  }

  // Sıra yalnızca gönderildiğinde değişir; yeni üründe depo sonuna eklenir.
  if (has("sortOrder")) {
    const r = asSortOrder(input.sortOrder);
    if (!r.ok) return r;
    out.sortOrder = r.value;
  }

  // İndirimli fiyat taban fiyattan yüksek olamaz.
  const price = out.price;
  const discount = out.discountPrice;
  if (typeof price === "number" && typeof discount === "number" && discount >= price) {
    return { ok: false, error: "İndirimli fiyat, normal fiyattan düşük olmalı." };
  }

  return { ok: true, value: out };
}

/* ------------------------------------------------------- teslimat bölgesi */

/** Almanya posta kodu: beş rakam. */
function asPostalCode(value: unknown): Result<string> {
  if (typeof value !== "string") return { ok: false, error: "Posta kodu metin olmalı." };
  const trimmed = value.trim();
  if (!/^\d{5}$/.test(trimmed)) {
    return { ok: false, error: "Posta kodu beş rakamdan oluşmalı (ör. 94343)." };
  }
  return { ok: true, value: trimmed };
}

/** Euro girdisini cent'e çevirir; tutarlar veritabanında tam sayı tutulur. */
function asCents(value: unknown, field: string): Result<number> {
  const price = asPrice(value, field);
  if (!price.ok) return price;
  return { ok: true, value: toCents(price.value) };
}

function asMinutes(value: unknown): Result<number> {
  const num = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof num !== "number" || !Number.isFinite(num)) {
    return { ok: false, error: "Teslimat süresi sayı olmalı." };
  }
  if (num < 5 || num > 240) {
    return { ok: false, error: "Teslimat süresi 5 ile 240 dakika arasında olmalı." };
  }
  return { ok: true, value: Math.round(num) };
}

/**
 * Teslimat bölgesi gövdesi.
 *
 * `partial` PATCH içindir: yalnızca gönderilen alanlar doğrulanır, gönderilmeyen
 * alanlar mevcut kaydında kalır. POST'ta posta kodu zorunlu, para alanlarının
 * boş bırakılanı 0 sayılır (ücretsiz teslimat / eşiksiz).
 */
export function parseDeliveryZoneBody(
  body: unknown,
  partial: boolean
): Result<Partial<DeliveryZoneInput>> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Geçersiz istek gövdesi." };
  }
  const input = body as Record<string, unknown>;
  const out: Partial<DeliveryZoneInput> = {};

  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);
  const blank = (key: string) => input[key] === "" || input[key] === null || input[key] === undefined;

  if (has("postalCode") || !partial) {
    const r = asPostalCode(input.postalCode);
    if (!r.ok) return r;
    out.postalCode = r.value;
  }

  if (has("city") || !partial) {
    const r = asString(input.city, "Şehir", 80, false);
    if (!r.ok) return r;
    out.city = r.value;
  }

  const amounts = [
    ["minOrder", "minOrderCents", "Minimum sepet tutarı"],
    ["fee", "feeCents", "Teslimat ücreti"],
    ["freeOver", "freeOverCents", "Ücretsiz teslimat eşiği"],
  ] as const;

  for (const [key, field, label] of amounts) {
    if (!has(key) && partial) continue;
    if (blank(key)) {
      out[field] = 0;
      continue;
    }
    const r = asCents(input[key], label);
    if (!r.ok) return r;
    out[field] = r.value;
  }

  if (has("etaMinutes") || !partial) {
    const r = asMinutes(blank("etaMinutes") ? 45 : input.etaMinutes);
    if (!r.ok) return r;
    out.etaMinutes = r.value;
  }

  if (has("active")) out.active = Boolean(input.active);
  else if (!partial) out.active = true;

  return { ok: true, value: out };
}

/* --------------------------------------------------------------- kategori */

/**
 * Kategori güncelleme gövdesi — kısmi.
 *
 * Yalnızca gönderilen alanlar döner: sıralama düğmesi `sortOrder`, düzenleme
 * formu metin alanlarını yollar. Boş bir yama çağıran tarafta hata sayılır;
 * burada değil, çünkü "hiçbir alan göndermedin" bir doğrulama hatası değil,
 * bir istek hatasıdır.
 *
 * `name` gönderildiyse boş olamaz — kategorinin adı menüde başlık olarak
 * çıkıyor. `nameTr`, `note` ve `noteTr` boş bırakılabilir: boş `nameTr`,
 * "Türkçesi de aynı" demektir (menü `name`'e düşer), boş not "not yok".
 */
export function parseCategoryPatch(
  body: unknown
): Result<{ name?: string; nameTr?: string; note?: string; noteTr?: string; sortOrder?: number }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Geçersiz istek gövdesi." };
  }
  const input = body as Record<string, unknown>;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);
  const out: {
    name?: string;
    nameTr?: string;
    note?: string;
    noteTr?: string;
    sortOrder?: number;
  } = {};

  if (has("name")) {
    const r = asString(input.name, "Kategori adı", 80);
    if (!r.ok) return r;
    out.name = r.value;
  }

  if (has("nameTr")) {
    const r = asString(input.nameTr, "Türkçe kategori adı", 80, false);
    if (!r.ok) return r;
    out.nameTr = r.value;
  }

  if (has("note")) {
    const r = asString(input.note, "Kategori notu", 200, false);
    if (!r.ok) return r;
    out.note = r.value;
  }

  if (has("noteTr")) {
    const r = asString(input.noteTr, "Türkçe kategori notu", 200, false);
    if (!r.ok) return r;
    out.noteTr = r.value;
  }

  if (has("sortOrder")) {
    const r = asSortOrder(input.sortOrder);
    if (!r.ok) return r;
    out.sortOrder = r.value;
  }

  return { ok: true, value: out };
}
