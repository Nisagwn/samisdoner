import type { ProductPatch } from "./store";
import {
  ADDITIVES,
  ALLERGENS,
  VAT_RATES,
  type Additive,
  type Allergen,
  type Variant,
} from "./types";
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

/** Görsel: yalnızca proje içi yol (/assets/...) kabul edilir. */
function asImage(value: unknown): Result<string | null> {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "Görsel yolu metin olmalı." };
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    return { ok: false, error: "Görsel yolu / ile başlayan proje içi bir yol olmalı (ör. /assets/menu-klasik.webp)." };
  }
  if (trimmed.includes("..")) return { ok: false, error: "Görsel yolu geçersiz." };
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
 * Sabit bir listeden seçilmiş kod kümesi.
 *
 * Bilinmeyen kod **sessizce düşürülmez, hata verir**. Alerjen alanında sessiz
 * düşürmenin bedeli, işletmecinin "glüteni işaretledim" sanıp menüde hiçbir
 * şey görmemesidir; bu alanda görünmeyen bir hata doğrudan sağlık riski.
 *
 * Tekrarlar temizlenir, sıra girişten bağımsız olarak sabit listenin sırasına
 * göre normalize edilir: aynı ürün iki kez kaydedildiğinde veri değişmesin.
 */
function asCodes<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): Result<T[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: `${field} liste olmalı.` };
  if (value.length > allowed.length) {
    return { ok: false, error: `${field} listesinde tekrar eden kayıt var.` };
  }

  const picked = new Set<T>();
  for (const item of value) {
    if (typeof item !== "string" || !allowed.includes(item as T)) {
      return { ok: false, error: `${field} listesinde tanınmayan değer var.` };
    }
    picked.add(item as T);
  }
  return { ok: true, value: allowed.filter((code) => picked.has(code)) };
}

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
   * Bu blok yoktu: `allergens`, `additives`, `vatRate`, `allergenInfoConfirmed`
   * ve `isPerishable` gövdede gelse bile sessizce düşüyordu. Depo katmanı
   * onları yazmaya hazırdı, panelde alan yoktu ve yazan da yoktu — sonuç,
   * panelden açılan her ürünün menüde "bilgi girilmedi" olarak çıkmasıydı.
   */
  if (need("vatRate")) {
    const r = asVatRate(input.vatRate);
    if (!r.ok) return r;
    out.vatRate = r.value;
  }

  if (need("allergens")) {
    const r = asCodes<Allergen>(input.allergens, ALLERGENS, "Alerjen");
    if (!r.ok) return r;
    out.allergens = r.value;
  }

  if (need("additives")) {
    const r = asCodes<Additive>(input.additives, ADDITIVES, "Katkı maddesi");
    if (!r.ok) return r;
    out.additives = r.value;
  }

  /*
   * "Bildirimi zorunlu madde yok" beyanı.
   *
   * Boş liste tek başına iki farklı şey anlatabilir: bilgi girilmedi, ya da
   * gerçekten madde yok. Ayrımı yalnızca bu bayrak taşır ve işletmecinin
   * bilinçli beyanıdır — varsayılanı `false`, yani "girilmedi".
   */
  if (has("allergenInfoConfirmed")) {
    out.allergenInfoConfirmed = Boolean(input.allergenInfoConfirmed);
  } else if (!partial) {
    out.allergenInfoConfirmed = false;
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
