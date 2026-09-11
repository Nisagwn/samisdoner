import { formatEuro } from "@/lib/money";

/**
 * Katalog veri modeli.
 *
 * Menü kaydının şekli: isim, açıklama, boyut varyasyonları ve panelin ihtiyaç
 * duyduğu alanlar — indirimli fiyat, aktif/pasif ve stok durumu.
 *
 * Fiyatlar burada **sayı** olarak (Euro) tutulur; gösterimdeki "7,00 €"
 * biçimlendirmesi `formatPrice` ile yapılır. Kaynak dosyadaki string fiyatlar
 * seed sırasında bir kez parse edilir.
 */

export type Variant = {
  /** "kl.", "gr.", "0,5 l", "Rolle" – tek fiyatlı üründe boş string */
  size: string;
  price: number;
};

export type Product = {
  id: string;
  /** Menüdeki sipariş numarası ("01", "80"). İçeceklerde yoktur. */
  no: string;
  name: string;
  /** Türkçe ad; boşsa müşteri tarafında Almanca `name` kullanılır. */
  nameTr: string;
  description: string;
  /** Türkçe açıklama; boşsa `description` kullanılır. */
  descriptionTr: string;
  categoryId: string;
  /** Varyasyonlu üründe ilk varyasyonun fiyatı; liste/sıralama için taban */
  price: number;
  /** null = indirim yok. Set edilmişse müşteri tarafında üstü çizili fiyat gösterilir. */
  discountPrice: number | null;
  image: string | null;
  /** Ürünün kaydı yayında mı. Pasifse müşteri tarafında hiç görünmez. */
  active: boolean;
  /** Gün içi stok durumu. Tükendiyse menüden düşer. */
  inStock: boolean;
  /** Aktif olsa bile menü/ana sayfa listesinde gösterilsin mi. */
  showOnHome: boolean;
  /**
   * "Öne çıkanlar" vitrinine alınmış mı.
   *
   * Ana sayfadaki kısa liste ve karta sayfasının en üstü buna bakar. Ürünün
   * menüde görünmesiyle ilgisi yoktur: `showOnHome` ürünü menüde tutar,
   * `featured` onu vitrine çıkarır.
   */
  featured: boolean;
  variants: Variant[];
  /** Menüdeki sıra; küçük olan üstte. */
  sortOrder: number;

  /**
   * KDV oranı (7 veya 19) — sabit değil, **ürün başına**.
   * Steueränderungsgesetz 2025 (§ 12 Abs. 2 Nr. 15 UStG) ile 01.01.2026'dan
   * beri tüm yemekler %7, tüm içecekler %19.
   */
  vatRate: number;
  /**
   * § 312g Abs. 2 BGB — cayma hakkı istisnası yalnızca çabuk bozulan malda.
   * Kapalı şişe içecek bozulmaz; istisnaya girmez.
   */
  isPerishable: boolean;
};

export type Category = {
  id: string;
  name: string;
  /** Türkçe kategori başlığı; boşsa `name` kullanılır. */
  nameTr: string;
  /** Kategorinin tamamı için geçerli not (ekstra malzeme, depozito …). */
  note: string;
  noteTr: string;
  sortOrder: number;
};

/** Sipariş toplamına eklenen ücretler. Admin panelinden yönetilir. */
export type Settings = {
  /** Paket/servis ücreti (€). 0 = ücret alınmıyor. */
  serviceFee: number;
  /**
   * Bu tutarın üstündeki siparişlerde servis ücreti alınmaz.
   * 0 = eşik yok (ücret her zaman uygulanır).
   */
  freeServiceOver: number;
};

export type Catalog = {
  /** Şema sürümü. Artarsa depo göç ettirilir (bkz. store/migrate). */
  version: number;
  categories: Category[];
  products: Product[];
  settings: Settings;
};

/**
 * Depodaki şema sürümü.
 *
 * 1 → eski demo menüsü.
 * 2 → gerçek karta (`data/speisekarte.ts`) + no/TR alanları + showOnHome.
 * 3 → fiyat tek kaynağa taşındı: servis ücreti (`settings`) katalogun parçası
 *     oldu. Bu sürümde ayrıca "kendin seç" yapılandırıcısı vardı; bölüm
 *     kaldırıldığında ayarları okunmaz oldu, kayıtlar yerinde bırakıldı.
 */
export const CATALOG_VERSION = 3;

/** Müşteri tarafına gönderilen, kategorileriyle gruplanmış görünüm. */
export type PublicCategory = Category & { products: Product[] };

/** Katalogdaki Euro değerini "7,50 €" biçiminde gösterir. */
export function formatPrice(value: number): string {
  return formatEuro(value);
}

/** Ürünün geçerli satış fiyatı: indirim varsa indirimli olan. */
export function effectivePrice(product: Pick<Product, "price" | "discountPrice">): number {
  return product.discountPrice ?? product.price;
}

/** "7,00 €" / "+ 1,00 €" → 7 / 1. Parse edilemezse null. */
export function parsePrice(raw: string): number | null {
  const match = raw.replace(/\s/g, "").match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/** İsimden URL/id dostu slug üretir; çakışmayı çağıran taraf çözer. */
export function slugify(input: string): string {
  const map: Record<string, string> = {
    ä: "ae", ö: "oe", ü: "ue", ß: "ss",
    ı: "i", İ: "i", ş: "s", ğ: "g", ç: "c",
  };
  return input
    .toLowerCase()
    .replace(/[äöüßıİşğç]/g, (c) => map[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/* ------------------------------------------------------------ vergi (yasal) */

/** Geçerli KDV oranları. Başka bir değer kabul edilmez. */
export const VAT_RATES = [7, 19] as const;
