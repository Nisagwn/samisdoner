import { prisma } from "@/lib/db";
import { CACHE_KEYS, cached, invalidate } from "@/lib/cache";
import type { Prisma } from "@prisma/client";
import type { MenuSection } from "@/data/speisekarte";
import { toCents, toEuro } from "@/lib/money";
import { grundpreisLabel } from "@/lib/legal/grundpreis";
import {
  CATALOG_VERSION,
  effectivePrice,
  formatPrice,
  slugify,
  type Catalog,
  type Category,
  type Product,
  type PublicCategory,
  type Settings,
} from "./types";

/**
 * Katalog deposu — PostgreSQL (Prisma).
 *
 * Bu modül veri katmanının **tek kapısıdır**: API route'ları ve sayfalar
 * doğrudan Prisma çağırmaz, buradaki fonksiyonları kullanır. Depo dosya
 * tabanlıyken de kural buydu; kaynak değişti, sözleşme değişmedi.
 *
 * Birim dönüşümü burada olur:
 *  - Veritabanında fiyatlar **cent (Int)** tutulur — kayan noktalı toplama
 *    sipariş tutarında bir cent'lik sapmalara yol açtığı için `Float` yok.
 *  - Bu modülün dışarı verdiği alan modeli (`lib/admin/types.ts`) fiyatları
 *    **Euro (number)** olarak taşımaya devam eder; admin arayüzü ve mevcut
 *    gösterim mantığı bu birimle çalışıyor. Çeviri `toCents` / `toEuro` ile
 *    yalnızca bu dosyanın sınırında yapılır.
 */

/* ------------------------------------------------------------ eşleyiciler */

type ProductRow = Prisma.ProductGetPayload<{ include: { variants: true } }>;
type CategoryRow = Prisma.CategoryGetPayload<object>;
type SettingsRow = Prisma.SettingsGetPayload<object>;

const productInclude = {
  variants: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.ProductInclude;

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    no: row.no,
    name: row.name,
    nameTr: row.nameTr,
    description: row.description,
    descriptionTr: row.descriptionTr,
    categoryId: row.categoryId,
    price: toEuro(row.priceCents),
    discountPrice: row.discountPriceCents === null ? null : toEuro(row.discountPriceCents),
    image: row.image,
    active: row.active,
    inStock: row.inStock,
    showOnHome: row.showOnHome,
    featured: row.featured,
    variants: row.variants
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((v) => ({ size: v.size, price: toEuro(v.priceCents) })),
    sortOrder: row.sortOrder,
    vatRate: row.vatRate,
    isPerishable: row.isPerishable,
  };
}

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    nameTr: row.nameTr,
    note: row.note,
    noteTr: row.noteTr,
    sortOrder: row.sortOrder,
  };
}

function defaultSettings(): Settings {
  return { serviceFee: 0, freeServiceOver: 0 };
}

function toSettings(row: SettingsRow | null): Settings {
  if (!row) return defaultSettings();
  return {
    serviceFee: toEuro(row.serviceFeeCents),
    freeServiceOver: toEuro(row.freeServiceOverCents),
  };
}

/* ------------------------------------------------------------------ okuma */

/**
 * Katalog önbelleği.
 *
 * Menü ve fiyat ayarları **nadiren** değişir ama neredeyse her
 * istekte okunur: ana sayfa, kart, sepet fiyatlaması, sipariş akışı. Her
 * okumanın veritabanına gitmesi, uygulamanın hızını veritabanına olan ağ
 * gecikmesine bağlar — havuzlanmış bağlantı üzerinden sorgu başına yüzlerce
 * milisaniye eder ve sayfa birkaç saniyede açılır.
 *
 * Bu yüzden katalog bir kez okunur ve paylaşımlı önbellekte tutulur
 * (`lib/cache.ts` → Redis varsa Redis, yoksa süreç içi bellek). Bayatlık riski
 * yok: panelden yapılan her yazma `invalidateCatalog()` çağırır ve önbellek o
 * anda düşer. Süre sınırı yalnızca son çare — veritabanı uygulama dışından
 * (seed, Prisma Studio) değiştirilirse en geç bu süre sonunda yakalanır.
 */
const CATALOG_MAX_AGE_SECONDS = 300;

async function loadCatalog(): Promise<Catalog> {
  const [categories, products, settings] = await Promise.all([
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.product.findMany({ orderBy: { sortOrder: "asc" }, include: productInclude }),
    prisma.settings.findUnique({ where: { id: 1 } }),
  ]);

  return {
    version: CATALOG_VERSION,
    categories: categories.map(toCategory),
    products: products.map(toProduct),
    settings: toSettings(settings),
  };
}

export async function getCatalog(): Promise<Catalog> {
  return cached(CACHE_KEYS.catalog, CATALOG_MAX_AGE_SECONDS, loadCatalog);
}

/**
 * Katalog önbelleğini düşürür.
 *
 * Katalogu değiştiren **her** yazma bunu `await` etmek zorundadır; unutulan bir
 * çağrı, panelde değişmiş ama müşteride eski görünen bir fiyat demektir.
 */
export async function invalidateCatalog(): Promise<void> {
  await invalidate(CACHE_KEYS.catalog);
}

/**
 * `Settings` satırını değiştiren yazmalar için.
 *
 * Aynı satır iki ayrı görünüme besleniyor: katalog (servis ücreti) ve sipariş
 * ayarları (açık/kapalı anahtarları, nakit, hazırlık süresi). Hangi alanın
 * değiştiğine bakıp yalnızca birini düşürmek, bir gün eklenen üçüncü bir alanın
 * sessizce bayat kalması demek olurdu; iki anahtar birlikte düşer.
 */
export async function invalidateSettings(): Promise<void> {
  await invalidate(CACHE_KEYS.catalog, CACHE_KEYS.orderSettings);
}

/** Ürün müşteriye gösterilir mi: üç anahtarın da açık olması gerekir. */
export function isVisible(product: Product): boolean {
  return product.active && product.inStock && product.showOnHome;
}

/**
 * Müşteri tarafı: yalnızca gösterilebilir ürünler, kategori sırasına göre
 * gruplanmış. Hiç ürünü kalmayan kategori listeye girmez.
 */
export async function getPublicMenu(): Promise<PublicCategory[]> {
  // Görünürlük süzgeci veritabanında değil burada uygulanır: katalog zaten
  // önbellekte, ayrıca sorgu atmanın karşılığı yok. `isVisible` ile aynı
  // kuralı paylaşır, dolayısıyla iki yerde ayrışma ihtimali yoktur.
  const catalog = await getCatalog();

  return catalog.categories
    .map((cat) => ({
      ...cat,
      products: catalog.products
        .filter((p) => p.categoryId === cat.id && isVisible(p))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .filter((cat) => cat.products.length > 0);
}

/**
 * Kartanın (`/speisekarte`) beklediği görünüm.
 *
 * `data/speisekarte.ts` ile aynı şekli üretir; böylece MenuGrid tarafında
 * gösterim mantığı değişmeden veri kaynağı depoya taşınmış olur.
 */
export async function getMenuSections(): Promise<MenuSection[]> {
  const categories = await getPublicMenu();
  return categories.map((cat) => ({
    id: cat.id,
    title: cat.name,
    titleTr: cat.nameTr || undefined,
    note: cat.note || undefined,
    noteTr: cat.noteTr || undefined,
    items: cat.products.map((p) => {
      return {
        // Kartanın sepete ekleyebilmesi için tek gereken alan. Fiyat değil
        // kimlik taşınır: tutarı `/api/menu/quote` hesaplar.
        productId: p.id,
        no: p.no || undefined,
        name: p.name,
        nameTr: p.nameTr || undefined,
        desc: p.description || undefined,
        descTr: p.descriptionTr || undefined,
        image: p.image ?? undefined,
        // Varyasyonlu üründe satırda tek fiyat değil, boy listesi gösterilir.
        price: p.variants.length > 0 ? undefined : formatPrice(p.discountPrice ?? p.price),
        oldPrice:
          p.variants.length > 0 || p.discountPrice === null ? undefined : formatPrice(p.price),
        variants:
          p.variants.length > 0
            ? p.variants.map((v) => ({
                size: v.size,
                price: formatPrice(v.price),
                grundpreis: grundpreisLabel(v.size, toCents(v.price)) ?? undefined,
              }))
            : undefined,
        // Tek fiyatlı üründe hacim bilgisi taşıyan bir etiket yoktur (boy
        // yalnızca varyantta bulunur), dolayısıyla temel fiyat hesaplanamaz.
        // Uydurulmuş bir litre değeri göstermektense hiç göstermemek doğrudur.
      };
    }),
  }));
}

export async function getStats() {
  const { categories: categoryList, products } = await getCatalog();
  const categories = categoryList.length;

  return {
    totalProducts: products.length,
    activeProducts: products.filter((p) => p.active).length,
    passiveProducts: products.filter((p) => !p.active).length,
    outOfStock: products.filter((p) => !p.inStock).length,
    hiddenFromMenu: products.filter((p) => p.active && !p.showOnHome).length,
    visibleProducts: products.filter((p) => p.active && p.inStock && p.showOnHome).length,
    discounted: products.filter((p) => p.discountPrice !== null).length,
    categories,
  };
}

/**
 * "Öne çıkanlar" vitrini — ana sayfada ve karta sayfasının en üstünde.
 *
 * Liste **admin panelinden** yönetilir: panelde "Öne çıkar" işaretlenen
 * ürünler, menü sırasına göre burada görünür. Menüden düşmüş bir ürün
 * (pasif / tükenmiş / menüde gizli) işaretli olsa bile vitrine girmez —
 * satılamayan ürünü vitrinde göstermek müşteriyi boşuna uğraştırır.
 *
 * Hiçbir ürün işaretlenmemişse liste boş kalmaz, sıraya göre doldurulur:
 * yeni kurulan bir sitede vitrin bölümünün boş görünmesindense makul bir
 * varsayılan göstermek daha iyidir. İşletmeci ilk ürünü işaretlediği anda
 * kontrol tamamen ona geçer.
 */
export async function getFeaturedProducts(limit = 3): Promise<Product[]> {
  const catalog = await getCatalog();
  const visible = catalog.products
    .filter(isVisible)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const chosen = visible.filter((p) => p.featured);
  if (chosen.length > 0) return chosen.slice(0, limit);

  // Varsayılan: görseli olan ürünler öne alınır, kalanı sırayla tamamlar.
  const withImage = visible.filter((p) => p.image);
  return [...withImage, ...visible.filter((p) => !p.image)].slice(0, limit);
}

/* ------------------------------------------------------------------ yazma */

/**
 * Yeni ürün girdisi.
 *
 * Yasal alanlar (KDV oranı, cayma hakkı istisnası) isteğe bağlıdır: mevcut
 * çağrı yerleri bunları göndermiyor ve varsayılanla oluşuyor. Panel bu alanları
 * gönderdiğinde değerler olduğu gibi yazılır.
 */
export type ProductInput = Omit<Product, "id" | "sortOrder" | "vatRate" | "isPerishable"> &
  Partial<Pick<Product, "vatRate" | "isPerishable">>;

/** Güncellemede sıra da değiştirilebilir; oluşturmada sıra otomatik verilir. */
export type ProductPatch = Partial<ProductInput & Pick<Product, "sortOrder">>;

/** Alan modelindeki ürün alanlarını veritabanı sütunlarına çevirir. */
function productData(patch: ProductPatch) {
  const data: Prisma.ProductUncheckedUpdateInput = {};

  if (patch.no !== undefined) data.no = patch.no;
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.nameTr !== undefined) data.nameTr = patch.nameTr;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.descriptionTr !== undefined) data.descriptionTr = patch.descriptionTr;
  if (patch.categoryId !== undefined) data.categoryId = patch.categoryId;
  if (patch.price !== undefined) data.priceCents = toCents(patch.price);
  if (patch.discountPrice !== undefined) {
    data.discountPriceCents = patch.discountPrice === null ? null : toCents(patch.discountPrice);
  }
  if (patch.image !== undefined) data.image = patch.image;
  if (patch.active !== undefined) data.active = patch.active;
  if (patch.inStock !== undefined) data.inStock = patch.inStock;
  if (patch.showOnHome !== undefined) data.showOnHome = patch.showOnHome;
  if (patch.featured !== undefined) data.featured = patch.featured;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  if (patch.vatRate !== undefined) data.vatRate = patch.vatRate;
  if (patch.isPerishable !== undefined) data.isPerishable = patch.isPerishable;

  return data;
}

/** Aynı kimlik varsa sonuna sayı ekleyerek benzersizini bulur. */
async function uniqueProductId(base: string): Promise<string> {
  let id = base;
  let n = 2;
  while (await prisma.product.findUnique({ where: { id }, select: { id: true } })) {
    id = `${base}-${n++}`;
  }
  return id;
}

export async function createProduct(input: ProductInput & { id: string }): Promise<Product> {
  const id = await uniqueProductId(input.id);
  const max = await prisma.product.aggregate({ _max: { sortOrder: true } });

  const row = await prisma.product.create({
    data: {
      id,
      no: input.no,
      name: input.name,
      nameTr: input.nameTr,
      description: input.description,
      descriptionTr: input.descriptionTr,
      categoryId: input.categoryId,
      priceCents: toCents(input.price),
      discountPriceCents: input.discountPrice === null ? null : toCents(input.discountPrice),
      image: input.image,
      active: input.active,
      inStock: input.inStock,
      showOnHome: input.showOnHome,
      sortOrder: (max._max.sortOrder ?? 0) + 1,
      vatRate: input.vatRate ?? 7,
      isPerishable: input.isPerishable ?? true,
      variants: {
        create: input.variants.map((v, i) => ({
          size: v.size,
          priceCents: toCents(v.price),
          sortOrder: i,
        })),
      },
    },
    include: productInclude,
  });

  await invalidateCatalog();
  return toProduct(row);
}

export async function updateProduct(id: string, patch: ProductPatch): Promise<Product | null> {
  const exists = await prisma.product.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;

  // Varyantlar gömülü bir liste gibi davranır: gönderildiyse tamamı değişir.
  // Silinmiş bir boy ayakta kalmasın diye önce temizlenir.
  const row = await prisma.$transaction(async (tx) => {
    if (patch.variants !== undefined) {
      await tx.variant.deleteMany({ where: { productId: id } });
      if (patch.variants.length > 0) {
        await tx.variant.createMany({
          data: patch.variants.map((v, i) => ({
            productId: id,
            size: v.size,
            priceCents: toCents(v.price),
            sortOrder: i,
          })),
        });
      }
    }
    return tx.product.update({
      where: { id },
      data: productData(patch),
      include: productInclude,
    });
  });

  await invalidateCatalog();
  return toProduct(row);
}

export async function deleteProduct(id: string): Promise<boolean> {
  const { count } = await prisma.product.deleteMany({ where: { id } });
  if (count > 0) await invalidateCatalog();
  return count > 0;
}

export async function createCategory(name: string, id: string): Promise<Category> {
  let unique = id;
  let n = 2;
  while (await prisma.category.findUnique({ where: { id: unique }, select: { id: true } })) {
    unique = `${id}-${n++}`;
  }

  const max = await prisma.category.aggregate({ _max: { sortOrder: true } });
  const row = await prisma.category.create({
    data: { id: unique, name, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  await invalidateCatalog();
  return toCategory(row);
}

/**
 * Kategori güncelleme.
 *
 * `nameTr`, `note` ve `noteTr` şemada baştan vardı ve menü onları **okuyordu**
 * (`getMenuSections` → `MenuSection.titleTr/note/noteTr`), ama panelde
 * girilemiyordu: kategori düzenleme yalnızca `name` kabul ediyordu. Sonuç,
 * Türkçe menüde kategori başlıklarının Almanca kalması ve "ekstra malzeme /
 * depozito" gibi kategori notlarının hiç görünmemesiydi.
 */
export async function updateCategory(
  id: string,
  patch: Partial<Pick<Category, "name" | "nameTr" | "note" | "noteTr" | "sortOrder">>
): Promise<Category | null> {
  const exists = await prisma.category.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;
  const row = await prisma.category.update({ where: { id }, data: patch });
  await invalidateCatalog();
  return toCategory(row);
}

export type DeleteCategoryResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "has_products"; count: number };

/** Ürünü olan kategori silinmez — ürünler sahipsiz kalmasın. */
export async function deleteCategory(id: string): Promise<DeleteCategoryResult> {
  const exists = await prisma.category.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { ok: false, reason: "not_found" };

  const used = await prisma.product.count({ where: { categoryId: id } });
  if (used > 0) return { ok: false, reason: "has_products", count: used };

  await prisma.category.delete({ where: { id } });
  await invalidateCatalog();
  return { ok: true };
}

/* ---------------------------------------------------------------- ayarlar */

export async function getSettings(): Promise<Settings> {
  return (await getCatalog()).settings;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const data: Prisma.SettingsUncheckedUpdateInput = {};
  if (patch.serviceFee !== undefined) data.serviceFeeCents = toCents(patch.serviceFee);
  if (patch.freeServiceOver !== undefined) {
    data.freeServiceOverCents = toCents(patch.freeServiceOver);
  }

  const row = await prisma.settings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      serviceFeeCents: toCents(patch.serviceFee ?? 0),
      freeServiceOverCents: toCents(patch.freeServiceOver ?? 0),
    },
    update: data,
  });
  await invalidateSettings();
  return toSettings(row);
}

/* -------------------------------------------------------------- fiyatlama */

/**
 * Sepet satırının **istemciden gelen tarifi**.
 *
 * Dikkat: burada fiyat yoktur ve olmamalıdır. İstemci yalnızca "hangi ürün,
 * hangi boy, hangi seçenekler, kaç adet" der; para hesabını her zaman sunucu
 * yapar. Böylece istek gövdesi kurcalanarak fiyat değiştirilemez.
 */
export type CartLineInput = {
  kind: "product";
  productId: string;
  variantSize?: string;
  qty: number;
};

export type PricedLine = {
  /** Sepette satırı benzersiz kılan anahtar (aynı yapılandırma = aynı satır). */
  key: string;
  input: CartLineInput;
  label: string;
  detail: string;
  unitCents: number;
  lineCents: number;
  qty: number;
  /** Satırın KDV oranı (7 veya 19); dökümü bu belirler. */
  vatRate: number;
  /** Ürün menüden kalktıysa/silindiyse true; toplama dahil edilmez. */
  unavailable: boolean;
};

/** Bir KDV oranı için net/vergi/brüt üçlüsü. */
export type VatBucket = {
  rate: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
};

export type Quote = {
  lines: PricedLine[];
  subtotalCents: number;
  serviceFeeCents: number;
  totalCents: number;
  /** Ücretsiz servise kalan tutar; eşik yoksa veya aşıldıysa 0. */
  remainingForFreeServiceCents: number;
  freeServiceOverCents: number;
  /** Orana göre KDV dökümü. Brüt toplamları `totalCents` ile eşittir. */
  vatBreakdown: VatBucket[];
  currency: "EUR";
};

const MAX_QTY = 99;

function clampQty(qty: unknown): number {
  const n = typeof qty === "number" ? Math.floor(qty) : Number.NaN;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_QTY);
}

export function productKey(productId: string, variantSize?: string): string {
  return `product:${productId}|${variantSize ?? ""}`;
}

/**
 * Bir ürün satırının fiyatı.
 *
 * Menüden kalkmış (pasif / tükenmiş / gizli) ya da silinmiş ürün `unavailable`
 * işaretiyle döner ve toplama girmez; satır sepetten sessizce silinmez, çünkü
 * müşteri neyin düştüğünü görmeli. Boy seçilmişse fiyat o boyun fiyatıdır.
 */
function priceProductLine(
  catalog: Catalog,
  input: Extract<CartLineInput, { kind: "product" }>,
  lang: "tr" | "de"
): PricedLine {
  const qty = clampQty(input.qty);
  const product = catalog.products.find((p) => p.id === input.productId);
  const key = productKey(input.productId, input.variantSize);

  if (!product || !isVisible(product)) {
    return {
      key,
      input: { ...input, qty },
      label: product?.name ?? input.productId,
      detail: "",
      unitCents: 0,
      lineCents: 0,
      qty,
      vatRate: product?.vatRate ?? 7,
      unavailable: true,
    };
  }

  // Boy seçilmişse o boyun fiyatı geçerlidir; boy artık yoksa satır düşer.
  const variant = input.variantSize
    ? product.variants.find((v) => v.size === input.variantSize)
    : undefined;
  if (input.variantSize && !variant) {
    return {
      key,
      input: { ...input, qty },
      label: product.name,
      detail: input.variantSize,
      unitCents: 0,
      lineCents: 0,
      qty,
      vatRate: product.vatRate,
      unavailable: true,
    };
  }

  const unitCents = toCents(variant ? variant.price : effectivePrice(product));
  const label = lang === "tr" ? product.nameTr || product.name : product.name;
  const desc = lang === "tr" ? product.descriptionTr || product.description : product.description;

  return {
    key,
    input: { ...input, qty },
    label,
    detail: variant ? [variant.size, desc].filter(Boolean).join(" — ") : desc,
    unitCents,
    lineCents: unitCents * qty,
    qty,
    vatRate: product.vatRate,
    unavailable: false,
  };
}

/**
 * Brüt tutardan KDV ayrıştırır.
 *
 * Almanya'da tüketiciye gösterilen fiyat brüttür (PAngV § 3): vergi fiyatın
 * **içindedir**, üstüne eklenmez. Bu yüzden net = brüt / (1 + oran).
 */
function splitVat(grossCents: number, rate: number): { netCents: number; vatCents: number } {
  const netCents = Math.round(grossCents / (1 + rate / 100));
  return { netCents, vatCents: grossCents - netCents };
}

/**
 * Sepetin KDV dökümü.
 *
 * Servis ücreti yan edim (Nebenleistung) sayılır ve tek bir orana bağlanamaz;
 * sepetteki brüt tutarların oranına göre bölüştürülür. Yuvarlama artığı en
 * büyük paya eklenir, böylece dökümün brüt toplamı `totalCents` ile birebir
 * eşit kalır.
 *
 * NOT: Karışık %7/%19 sepette yan edimin bölüştürülmesi Steuerberater'e
 * doğrulatılacak açık bir konudur; buradaki yöntem oransal dağıtımdır.
 */
export function buildVatBreakdown(lines: PricedLine[], extraCents: number): VatBucket[] {
  const byRate = new Map<number, number>();
  for (const line of lines) {
    if (line.unavailable) continue;
    byRate.set(line.vatRate, (byRate.get(line.vatRate) ?? 0) + line.lineCents);
  }
  if (byRate.size === 0) return [];

  const lineTotal = [...byRate.values()].reduce((a, b) => a + b, 0);
  const rates = [...byRate.keys()].sort((a, b) => a - b);

  // Yan edimi oransal dağıt; kuruş artığı en büyük paya gider.
  const gross = new Map<number, number>();
  let distributed = 0;
  rates.forEach((rate, i) => {
    const share = byRate.get(rate) ?? 0;
    const add =
      i === rates.length - 1
        ? extraCents - distributed
        : lineTotal === 0
          ? 0
          : Math.round((extraCents * share) / lineTotal);
    distributed += add;
    gross.set(rate, share + add);
  });

  return rates.map((rate) => {
    const grossCents = gross.get(rate) ?? 0;
    return { rate, grossCents, ...splitVat(grossCents, rate) };
  });
}

/**
 * Sepetin **tek geçerli** fiyat hesabı.
 *
 * Sepet çekmecesi, ödeme adımı ve sipariş ucu aynı bu fonksiyonu kullanır; dolayısıyla ekranda görünen tutarla siparişe yazılan tutarın
 * ayrışması mümkün değildir.
 */
export async function priceCart(
  inputs: CartLineInput[],
  lang: "tr" | "de" = "tr"
): Promise<Quote> {
  const catalog = await getCatalog();

  const lines = inputs.slice(0, 60).map((input) => priceProductLine(catalog, input, lang));

  const subtotalCents = lines
    .filter((l) => !l.unavailable)
    .reduce((sum, l) => sum + l.lineCents, 0);

  const { serviceFee, freeServiceOver } = catalog.settings;
  const feeCents = toCents(serviceFee);
  const thresholdCents = toCents(freeServiceOver);
  const waived = subtotalCents === 0 || (thresholdCents > 0 && subtotalCents >= thresholdCents);
  const serviceFeeCents = waived ? 0 : feeCents;

  return {
    lines,
    subtotalCents,
    serviceFeeCents,
    totalCents: subtotalCents + serviceFeeCents,
    remainingForFreeServiceCents:
      thresholdCents > 0 && subtotalCents > 0 && subtotalCents < thresholdCents
        ? thresholdCents - subtotalCents
        : 0,
    freeServiceOverCents: thresholdCents,
    vatBreakdown: buildVatBreakdown(lines, serviceFeeCents),
    currency: "EUR",
  };
}

/** Slug üretimi tip modülünde; buradan da erişilebilsin diye yeniden verilir. */
export { slugify };
