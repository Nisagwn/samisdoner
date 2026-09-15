import { prisma } from "@/lib/db";
import { CACHE_KEYS, cached, invalidate } from "@/lib/cache";
import type { Prisma } from "@prisma/client";
import type { MenuSection } from "@/data/speisekarte";
import { toCents, toEuro } from "@/lib/money";
import { grundpreisLabel } from "@/lib/legal/grundpreis";
import {
  describeSelection,
  missingRequiredGroups,
  normalizeNote,
  normalizeSelection,
  optionsKeyPart,
  selectionSurchargeCents,
  type OptionGroup,
} from "@/lib/menu/options";
import {
  CATALOG_VERSION,
  discountPercent,
  effectivePrice,
  formatPrice,
  slugify,
  type Catalog,
  type Category,
  type DietTag,
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

type ProductRow = Prisma.ProductGetPayload<{
  include: { variants: true; optionGroups: { include: { choices: true } } };
}>;
type CategoryRow = Prisma.CategoryGetPayload<object>;
type SettingsRow = Prisma.SettingsGetPayload<object>;

const productInclude = {
  variants: { orderBy: { sortOrder: "asc" } },
  optionGroups: {
    orderBy: { sortOrder: "asc" },
    include: { choices: { orderBy: { sortOrder: "asc" } } },
  },
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
    // Seçenek ek ücretleri alan modelinde de **cent** kalır, Euro'ya
    // çevrilmez: taban fiyattan farklı olarak bunlar hiçbir zaman tek başına
    // gösterilmiyor, hep bir toplamın parçası oluyorlar.
    optionGroups: row.optionGroups
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => ({
        id: g.id,
        name: g.name,
        nameTr: g.nameTr,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        choices: g.choices
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((c) => ({
            id: c.id,
            name: c.name,
            nameTr: c.nameTr,
            priceCents: c.priceCents,
            isDefault: c.isDefault,
          })),
      })),
    sortOrder: row.sortOrder,
    vatRate: row.vatRate,
    isPerishable: row.isPerishable,
    isPopular: row.isPopular,
    isNew: row.isNew,
    diet: row.diet as DietTag,
    spicyLevel: row.spicyLevel,
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
 * Katalog ürününü kartanın okuduğu satıra çevirir.
 *
 * Tek yerde duruyor çünkü aynı şekli üç yer istiyor: menü (`getMenuSections`),
 * sepetteki satırın düzenlenmesi ve çapraz satış önerileri
 * (`getMenuItemsByIds` / `getSuggestions`). Üç ayrı kopya, üçünün farklı
 * alanları unutması demekti.
 */
function toMenuItem(p: Product): MenuSection["items"][number] {
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
    oldPrice: p.variants.length > 0 || p.discountPrice === null ? undefined : formatPrice(p.price),
    variants:
      p.variants.length > 0
        ? p.variants.map((v) => ({
            size: v.size,
            price: formatPrice(v.price),
            priceCents: toCents(v.price),
            grundpreis: grundpreisLabel(v.size, toCents(v.price)) ?? undefined,
          }))
        : undefined,
    // Pencerede canlı toplam bu tabana kurulur; boy seçilirse varyantın kendi
    // cent değeri geçerli olur.
    baseCents: toCents(p.discountPrice ?? p.price),
    optionGroups: p.optionGroups.length > 0 ? p.optionGroups : undefined,
    isPopular: p.isPopular || undefined,
    isNew: p.isNew || undefined,
    diet: p.diet === "NONE" ? undefined : p.diet,
    spicyLevel: p.spicyLevel > 0 ? p.spicyLevel : undefined,
    discountPercent: discountPercent(p) ?? undefined,
    // Tek fiyatlı üründe hacim bilgisi taşıyan bir etiket yoktur (boy yalnızca
    // varyantta bulunur), dolayısıyla temel fiyat hesaplanamaz. Uydurulmuş bir
    // litre değeri göstermektense hiç göstermemek doğrudur.
  };
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
    items: cat.products.map(toMenuItem),
  }));
}

/**
 * Tek tek ürünler — sepetteki bir satırı yeniden yapılandırmak için.
 *
 * Menüden düşmüş ürün listeye girmez: düzenlenemeyen bir satırı düzenletmeye
 * çalışmak, müşteriye boş bir pencere açmak olurdu. Çağıran taraf eksik
 * kimlikten "artık yok" sonucunu çıkarır.
 */
export async function getMenuItemsByIds(
  ids: readonly string[]
): Promise<MenuSection["items"]> {
  const catalog = await getCatalog();
  const wanted = new Set(ids);
  return catalog.products.filter((p) => wanted.has(p.id) && isVisible(p)).map(toMenuItem);
}

/**
 * Çapraz satış önerileri — "Dazu passt".
 *
 * Seçim kuralı bilinçli olarak basit: sepette olmayan, **ucuz** ve tek tıkla
 * eklenebilen (zorunlu seçimi olmayan) ürünler. İçecek ve tatlı kategorileri
 * öne alınır, çünkü bir dönerin yanına satılan şey pratikte budur.
 *
 * Sipariş geçmişinden öğrenen bir öneri motoru kurulmadı: yeni bir dükkânda o
 * veri yok ve varken bile "bu ürünü alanlar şunu aldı" listesi, otuz ürünlük
 * bir menüde rastgeleden ayırt edilemez. Basit kural en azından **öngörülebilir**
 * ve işletmeci sırayı panelden değiştirebiliyor.
 */
const SUGGESTION_CATEGORY_HINTS = ["getrank", "getraenk", "drink", "icecek", "dessert", "nachtisch", "tatli"];

export async function getSuggestions(
  excludeIds: readonly string[],
  limit = 3
): Promise<MenuSection["items"]> {
  const catalog = await getCatalog();
  const excluded = new Set(excludeIds);

  const candidates = catalog.products
    .filter((p) => isVisible(p) && !excluded.has(p.id))
    // Zorunlu seçimi olan ürün öneri olamaz: öneri şeridindeki düğme tek
    // dokunuşla eklemeli, pencere açmamalı.
    .filter((p) => !p.optionGroups.some((g) => g.minSelect > 0));

  const slug = (id: string) => id.toLowerCase();
  const isSide = (categoryId: string) =>
    SUGGESTION_CATEGORY_HINTS.some((hint) => slug(categoryId).includes(hint));

  const sides = candidates.filter((p) => isSide(p.categoryId));
  const rest = candidates.filter((p) => !isSide(p.categoryId));

  const byPrice = (a: Product, b: Product) => effectivePrice(a) - effectivePrice(b);

  return [...sides.sort(byPrice), ...rest.sort(byPrice)].slice(0, limit).map(toMenuItem);
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
type OptionalOnCreate =
  | "vatRate"
  | "isPerishable"
  | "optionGroups"
  | "isPopular"
  | "isNew"
  | "diet"
  | "spicyLevel";

export type ProductInput = Omit<Product, "id" | "sortOrder" | OptionalOnCreate> &
  Partial<Pick<Product, OptionalOnCreate>>;

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
  if (patch.isPopular !== undefined) data.isPopular = patch.isPopular;
  if (patch.isNew !== undefined) data.isNew = patch.isNew;
  if (patch.diet !== undefined) data.diet = patch.diet;
  if (patch.spicyLevel !== undefined) data.spicyLevel = patch.spicyLevel;

  return data;
}

/**
 * Seçenek gruplarının veritabanı yazımı.
 *
 * Gruplar ürünün gömülü bir listesi gibi davranır: gönderildiyse tamamı
 * değişir, silinen grup ayakta kalmaz. Kimlikler **yeniden üretilir** — yani
 * panelde kaydet'e basmak eski seçenek kimliklerini geçersiz kılar ve o
 * kimlikleri taşıyan açık sepetlerdeki satırlar `unavailable` görünür.
 *
 * Bu bilinçli: seçeneklerin adı ya da ek ücreti değişmişken müşterinin
 * sepetindeki eski tarifi sessizce yeni fiyata bağlamak, ekranda gördüğünden
 * farklı bir tutar tahsil etmek olurdu. Satırın düşüp yeniden seçilmesi daha
 * dürüst.
 */
function optionGroupCreateData(groups: OptionGroup[]) {
  return groups.map((group, i) => ({
    name: group.name,
    nameTr: group.nameTr,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    sortOrder: i,
    choices: {
      create: group.choices.map((choice, j) => ({
        name: choice.name,
        nameTr: choice.nameTr,
        priceCents: choice.priceCents,
        isDefault: choice.isDefault,
        sortOrder: j,
      })),
    },
  }));
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
      isPopular: input.isPopular ?? false,
      isNew: input.isNew ?? false,
      diet: input.diet ?? "NONE",
      spicyLevel: input.spicyLevel ?? 0,
      variants: {
        create: input.variants.map((v, i) => ({
          size: v.size,
          priceCents: toCents(v.price),
          sortOrder: i,
        })),
      },
      optionGroups: { create: optionGroupCreateData(input.optionGroups ?? []) },
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
    // Seçenek grupları da gömülü liste: gönderildiyse tamamı yenilenir.
    // Seçenekler `onDelete: Cascade` ile grupla birlikte gider.
    if (patch.optionGroups !== undefined) {
      await tx.optionGroup.deleteMany({ where: { productId: id } });
    }

    return tx.product.update({
      where: { id },
      data: {
        ...productData(patch),
        ...(patch.optionGroups === undefined
          ? {}
          : { optionGroups: { create: optionGroupCreateData(patch.optionGroups) } }),
      },
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
  /**
   * Seçilen seçenek kimlikleri (`OptionChoice.id`).
   *
   * Yalnızca kimlik gelir, ek ücret gelmez: "+2,00 €" yazan bir gövde
   * gönderilebilseydi fiyatı istemci belirlerdi.
   */
  options?: string[];
  /** Müşterinin bu satıra yazdığı not ("ohne Zwiebeln"). Fiyata etkisi yok. */
  note?: string;
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

/**
 * Sepet satırının kimliği.
 *
 * Aynı ürünün farklı **yapılandırması** ayrı satırdır: ekstra peynirli döner
 * ile sade döner tek satırda toplanamaz, mutfak ikisini ayrı hazırlar. Not da
 * anahtarın parçası — "soğansız" yazılmış satır ayrı durmalı.
 *
 * İstemci (`lib/cart.tsx`) birebir aynı biçimi üretir; iki taraf ayrışırsa
 * sunucudan gelen fiyat sepetteki satıra bağlanamaz.
 */
export function productKey(
  productId: string,
  variantSize?: string,
  options: readonly string[] = [],
  note = ""
): string {
  return `product:${productId}|${variantSize ?? ""}|${optionsKeyPart(options)}|${normalizeNote(note)}`;
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
  const note = normalizeNote(input.note);
  const rawOptions = input.options ?? [];
  const key = productKey(input.productId, input.variantSize, rawOptions, note);

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

  /*
   * Seçenekler.
   *
   * Önce süzülür (silinmiş seçenek, üst sınırı aşan gövde), sonra ek ücret
   * eklenir. Ek ücret **birim fiyata** girer, satır toplamına değil: iki adet
   * ekstra peynirli döner = (taban + peynir) × 2.
   *
   * Zorunlu bir grup boş kaldıysa satır fiyatlanmaz. Sessizce en ucuzunu
   * seçmek de, ek ücreti atlayıp satırı geçirmek de mutfağa "et türü yok"
   * diyen bir fiş yollardı; bu yüzden satır `unavailable` işaretlenir ve
   * ödeme düğmesi kilitlenir.
   */
  const groups = product.optionGroups;
  const options = normalizeSelection(groups, rawOptions);
  const missing = missingRequiredGroups(groups, options);

  const baseCents = toCents(variant ? variant.price : effectivePrice(product));
  const unitCents = baseCents + selectionSurchargeCents(groups, options);

  const label = lang === "tr" ? product.nameTr || product.name : product.name;
  const desc = lang === "tr" ? product.descriptionTr || product.description : product.description;
  const chosen = describeSelection(groups, options, lang);

  // Satırın tarifi: boy → seçimler → not → açıklama. Mutfak ilk üçünü okur,
  // sonuncusu yalnızca müşterinin neyi seçtiğini hatırlaması için.
  const detail = [variant?.size, chosen, note ? `„${note}“` : "", desc]
    .filter(Boolean)
    .join(" — ");

  if (missing.length > 0) {
    return {
      key,
      input: { ...input, qty, options, note },
      label,
      detail,
      unitCents: 0,
      lineCents: 0,
      qty,
      vatRate: product.vatRate,
      unavailable: true,
    };
  }

  return {
    key,
    input: { ...input, qty, options, note },
    label,
    detail,
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
