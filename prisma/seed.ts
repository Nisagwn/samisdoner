/**
 * Katalog göçü: data/store/catalog.json → PostgreSQL.
 *
 * Tek seferlik bir dönüştürme değil, **yeniden çalıştırılabilir** bir tohumlama:
 * her kayıt upsert edilir, böylece şema değişince veriyi kaybetmeden yeniden
 * çalıştırılabilir. Panelden yapılmış düzenlemeleri ezmemek için yalnızca
 * katalogda karşılığı olan alanlar yazılır.
 *
 * Çalıştırma:  npm run db:seed
 */

import { PrismaClient } from "@prisma/client";
import catalog from "../data/store/catalog.json";
import { BUSINESS_INFO } from "../data/businessInfo";
import { DELIVERY_AREAS } from "../data/deliveryAreas";
import { toCents } from "../lib/money";

const prisma = new PrismaClient();

/**
 * KDV oranı.
 *
 * Steueränderungsgesetz 2025 (§ 12 Abs. 2 Nr. 15 UStG), 01.01.2026'dan beri:
 * tüm yemekler %7 — yerinde/paket/teslimat ayrımı kalktı. Tüm içecekler %19;
 * istisna >=%75 inek sütü içeren içecekler ve musluk suyu (%7).
 *
 * Ayran gibi sınır ürünler burada içecek sayılıp %19 tohumlanır; doğru oran
 * ürün bazında Steuerberater'e sorulup panelden düzeltilir.
 */
function vatRateFor(categoryId: string): number {
  return categoryId === "getraenke" ? 19 : 7;
}

/**
 * § 312g Abs. 2 BGB — cayma hakkı istisnası yalnızca çabuk bozulan mallarda.
 * Kapalı şişe içecek bozulmaz, dolayısıyla istisna kapsamı dışındadır.
 */
function isPerishable(categoryId: string): boolean {
  return categoryId !== "getraenke";
}

/** "11:00" → 660. Gün başından itibaren dakika. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

async function seedCatalog() {
  for (const category of catalog.categories) {
    await prisma.category.upsert({
      where: { id: category.id },
      create: {
        id: category.id,
        name: category.name,
        nameTr: category.nameTr ?? "",
        note: category.note ?? "",
        noteTr: category.noteTr ?? "",
        sortOrder: category.sortOrder ?? 0,
      },
      update: {
        name: category.name,
        nameTr: category.nameTr ?? "",
        note: category.note ?? "",
        noteTr: category.noteTr ?? "",
        sortOrder: category.sortOrder ?? 0,
      },
    });
  }
  console.log(`  kategori: ${catalog.categories.length}`);

  for (const product of catalog.products) {
    const base = {
      no: product.no ?? "",
      name: product.name,
      nameTr: product.nameTr ?? "",
      description: product.description ?? "",
      descriptionTr: product.descriptionTr ?? "",
      categoryId: product.categoryId,
      priceCents: toCents(product.price),
      discountPriceCents:
        product.discountPrice === null || product.discountPrice === undefined
          ? null
          : toCents(product.discountPrice),
      image: product.image ?? null,
      active: product.active ?? true,
      inStock: product.inStock ?? true,
      showOnHome: product.showOnHome ?? true,
      sortOrder: product.sortOrder ?? 0,
    };

    await prisma.product.upsert({
      where: { id: product.id },
      // KDV oranı ve cayma hakkı istisnası yalnızca **oluştururken** yazılır:
      // panelden düzeltilmiş bir oran, tohumlama yeniden çalıştığında geri
      // alınmamalı.
      create: {
        id: product.id,
        ...base,
        vatRate: vatRateFor(product.categoryId),
        isPerishable: isPerishable(product.categoryId),
      },
      update: base,
    });

    // Varyantlar katalogda gömülü dizi; burada ilişki tablosuna açılır.
    // Silinmiş bir boyun ayakta kalmaması için önce temizlenir.
    await prisma.variant.deleteMany({ where: { productId: product.id } });
    if (product.variants.length > 0) {
      await prisma.variant.createMany({
        data: product.variants.map((v, i) => ({
          productId: product.id,
          size: v.size,
          priceCents: toCents(v.price),
          sortOrder: i,
        })),
      });
    }
  }
  console.log(`  ürün: ${catalog.products.length}`);
}

async function seedSettings() {
  // Tekil kayıt. Var olan ayarlar korunur — yalnızca yoksa oluşturulur.
  await prisma.settings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      serviceFeeCents: toCents(catalog.settings.serviceFee),
      freeServiceOverCents: toCents(catalog.settings.freeServiceOver),
    },
    update: {},
  });
  console.log("  ayarlar: hazır");
}

async function seedOpeningHours() {
  if ((await prisma.openingHour.count()) > 0) {
    console.log("  çalışma saatleri: mevcut, atlandı");
    return;
  }
  // businessInfo listesi Pazartesi ile başlıyor; DB'de 0 = Pazar (JS getDay).
  const rows = BUSINESS_INFO.openingHours.map((day, i) => ({
    weekday: (i + 1) % 7,
    openMinute: toMinutes(day.open),
    closeMinute: toMinutes(day.close),
  }));
  await prisma.openingHour.createMany({ data: rows });
  console.log(`  çalışma saatleri: ${rows.length} gün`);
}

/**
 * Uzaklık kademeleri.
 *
 * Uzak bir adrese 15 €'luk sepet için araç çıkarmak zarardır: yol parası da,
 * mutfağın o yarım saati de sabittir. Bu yüzden minimum sepet ve ücret
 * uzaklıkla birlikte artar, tahmini süre de öyle.
 *
 * Kademeler bir **başlangıç önerisidir**, işletmenin aracına ve mutfağına göre
 * panelden satır satır düzeltilir. Uzaklık kuş uçuşudur (bkz.
 * `scripts/scrape-delivery-areas.ts`); gerçek yol her zaman daha uzun olduğu
 * için süreler cömert tutulmuştur.
 */
const DISTANCE_TIERS = [
  { maxKm: 5, minOrderCents: 1500, feeCents: 200, freeOverCents: 3000, etaMinutes: 45 },
  { maxKm: 10, minOrderCents: 1500, feeCents: 250, freeOverCents: 3000, etaMinutes: 55 },
  { maxKm: 16, minOrderCents: 2000, feeCents: 350, freeOverCents: 4000, etaMinutes: 65 },
  { maxKm: Infinity, minOrderCents: 2500, feeCents: 450, freeOverCents: 5000, etaMinutes: 80 },
];

function tierFor(km: number) {
  const { maxKm: _ignored, ...tier } = DISTANCE_TIERS.find((entry) => km <= entry.maxKm)!;
  return tier;
}

/**
 * Teslimat bölgeleri.
 *
 * Satırlar `data/deliveryAreas.ts` listesinden gelir — elle yazılmaz, iki resmî
 * kaynaktan üretilir (bkz. `scripts/scrape-delivery-areas.ts`). Elle yazılmış
 * bir listede ya bir köy unutulur ya bir posta kodu yanlış yazılır; ikisi de
 * müşteriye "buraya teslimat yapmıyoruz" diye görünür.
 *
 * **Bölge birimi posta kodudur, belediye değil**: 94342 hem Straßkirchen'i hem
 * Irlbach'ı kapsar ve kuryenin tarifesi ikisi için aynıdır. Müşteriye
 * gösterilen belediye listesi bu tek satırdan türetilir
 * (`app/api/menu/delivery`).
 *
 * İşletmenin kendi posta kodu **açık** tohumlanır; komşu posta kodları satır
 * olarak eklenir ama **kapalı** gelir. Sebebi: siparişi kabul etmek bir
 * taahhüttür — hangi köye gerçekten araç çıkacağına harita değil işletme karar
 * verir. Panelde ("Teslimat bölgeleri") her satır tek tıkla açılır, tutarları
 * düzenlenir ya da tamamen silinir.
 *
 * `update: {}` — yeniden tohumlama panelden yapılmış düzenlemeyi ezmez; kapattığı
 * bir bölge kapalı, açtığı açık kalır.
 */
async function seedDeliveryZone() {
  const home = BUSINESS_INFO.address.postalCode;

  /*
   * Posta kodu başına tek satır: liste belediye başına bir kayıt taşır, tabloda
   * `postalCode` tekildir. Aynı kodu paylaşan belediyeler panelde okunabilsin
   * diye adları birleştirilir; müşteriye gösterilen ad bu alandan değil,
   * listenin kendisinden gelir.
   */
  const byPostalCode = new Map<string, { cities: string[]; distanceKm: number }>();
  for (const area of DELIVERY_AREAS) {
    const entry = byPostalCode.get(area.postalCode);
    if (entry) entry.cities.push(area.city);
    else byPostalCode.set(area.postalCode, { cities: [area.city], distanceKm: area.distanceKm });
  }

  // İşletmenin kendi kodu listede yoksa (yarıçap değiştiyse) yine de açılır.
  if (!byPostalCode.has(home)) {
    byPostalCode.set(home, { cities: [BUSINESS_INFO.address.city], distanceKm: 0 });
  }

  let opened = 0;
  for (const [postalCode, { cities, distanceKm }] of byPostalCode) {
    await prisma.deliveryZone.upsert({
      where: { postalCode },
      create: {
        postalCode,
        city: cities.join(" / "),
        ...tierFor(distanceKm),
        active: postalCode === home,
      },
      update: {},
    });
    if (postalCode === home) opened++;
  }

  console.log(`  teslimat bölgesi: ${home} ${BUSINESS_INFO.address.city} (açık)`);
  console.log(
    `  komşu bölge: ${byPostalCode.size - opened} posta kodu (kapalı — panelden açılır)`
  );
}

async function main() {
  console.log("Katalog göçü başlıyor…");
  await seedCatalog();
  await seedSettings();
  await seedOpeningHours();
  await seedDeliveryZone();
  console.log("Bitti.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
