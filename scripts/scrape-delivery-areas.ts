/**
 * Teslimat bölgesi listesini üretir: `data/deliveryAreas.ts`.
 *
 * Elle yazılmış bir posta kodu listesi iki türlü yanlış olur — ya bir köy
 * unutulur (müşteri şehrini listede bulamaz, sipariş vermeden çıkar) ya da
 * yanlış yazılır (posta kodu tutmaz, teslimat bölgesi hiç eşleşmez). Bu yüzden
 * liste yazılmaz, **iki kaynaktan türetilir**:
 *
 *   1. GeoNames posta kodu dizini — her posta kodunun koordinatı. İşletmeye
 *      kuş uçuşu uzaklık buradan gelir; yakınlık sıralaması ve kademeler bu
 *      sayıya dayanır.
 *   2. OpenPLZ API (resmî Destatis/Deutsche Post verisi) — bir posta kodunun
 *      gerçekten hangi belediyeleri kapsadığı. İki işi birden yapar: yer adını
 *      resmî yazımıyla verir (Straßkirchen, "Strasskirchen" değil) ve
 *      **Großempfänger** kodlarını eler. Bunlar tek bir kuruma verilmiş posta
 *      kodlarıdır (94312 = Deutsche Post AG); GeoNames'te sıradan bir satır
 *      gibi görünürler ama teslimat yapılacak bir yer değildirler, resmî yer
 *      dizininde de karşılıkları yoktur.
 *
 * Çıktı **kaynak koda yazılır**, çalışma anında ağa çıkılmaz: sipariş formunun
 * açılması üçüncü taraf bir servisin ayakta olmasına bağlanamaz. Liste yılda
 * bir değişir, gerektiğinde `bun run data:areas` ile yeniden üretilir.
 *
 * Kullanım:  bun run data:areas [yarıçap-km]
 */

import { inflateRawSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUSINESS_INFO } from "../data/businessInfo";

const GEONAMES_URL = "https://download.geonames.org/export/zip/DE.zip";
const OPENPLZ_URL = "https://openplzapi.org/de/Localities";

/** Varsayılan yarıçap. Bir döner arabası için 25 km zaten cömert. */
const DEFAULT_RADIUS_KM = 25;

type Locality = {
  postalCode: string;
  /** Resmî belediye adı (OpenPLZ). */
  city: string;
  /** İlçe — panelde "bu neresi" sorusuna cevap verir. */
  district: string;
  /** İşletmeye kuş uçuşu uzaklık, km. */
  distanceKm: number;
};

/* ------------------------------------------------------------------ zip */

/**
 * Tek dosyalık bir ZIP'ten üye çıkarır.
 *
 * Node'un içinde ZIP okuyucu yok ve bu iş için bir paket eklemek, yılda bir
 * çalışan bir betiğe kalıcı bir bağımlılık borcu yazmak olurdu. Merkezi dizin
 * okunur (yerel başlıktaki boyut alanları akışla yazılmış arşivlerde boş
 * olabilir, merkezi dizindekiler her zaman doludur).
 */
function readZipEntry(zip: Buffer, wanted: string): Buffer {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP: merkezi dizin sonu bulunamadı.");

  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);

    if (name === wanted) {
      // Yerel başlıktaki ek alanlar merkezi dizindekinden farklı uzunlukta
      // olabilir; veri başlangıcı için yerel başlık okunmak zorunda.
      const lNameLen = zip.readUInt16LE(localOffset + 26);
      const lExtraLen = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const body = zip.subarray(start, start + compSize);
      return method === 0 ? Buffer.from(body) : inflateRawSync(body);
    }

    p += 46 + nameLen + extraLen + commentLen;
  }

  throw new Error(`ZIP: "${wanted}" arşivde yok.`);
}

/* ------------------------------------------------------------- mesafe */

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Haversine. Kuş uçuşu — gerçek yol her zaman daha uzun, kademeler buna göre. */
function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/* ------------------------------------------------------------ kaynaklar */

/** GeoNames: yarıçap içindeki posta kodları, her biri için en yakın koordinat. */
async function fetchPostalCodesInRadius(radiusKm: number): Promise<Map<string, number>> {
  process.stdout.write(`GeoNames indiriliyor (${GEONAMES_URL})… `);
  const response = await fetch(GEONAMES_URL);
  if (!response.ok) throw new Error(`GeoNames ${response.status}`);
  const zip = Buffer.from(await response.arrayBuffer());
  console.log(`${(zip.length / 1024).toFixed(0)} KB`);

  const text = readZipEntry(zip, "DE.txt").toString("utf8");
  const origin = BUSINESS_INFO.coordinates;

  /*
   * Bir posta kodu dizinde birden çok satırla geçer (mahalle başına bir satır).
   * İşletmeye en yakın olanı tutulur: kademeyi belirleyen, bölgenin en yakın
   * ucuna olan uzaklıktır — kurye oraya girdiği anda bölgeye girmiştir.
   */
  const nearest = new Map<string, number>();

  for (const line of text.split("\n")) {
    if (!line) continue;
    const cols = line.split("\t");
    const postalCode = cols[1];
    const lat = Number(cols[9]);
    const lng = Number(cols[10]);
    if (!postalCode || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const km = distanceKm(origin, { lat, lng });
    if (km > radiusKm) continue;
    if (!nearest.has(postalCode) || nearest.get(postalCode)! > km) {
      nearest.set(postalCode, km);
    }
  }

  console.log(`  yarıçap içinde ${nearest.size} posta kodu`);
  return nearest;
}

type OpenPlzLocality = {
  postalCode: string;
  name: string;
  district?: { name?: string };
};

/**
 * OpenPLZ: bir posta kodunun kapsadığı resmî belediyeler.
 *
 * Boş dizi "bu kod bir yer değil" demektir (Großempfänger) — çağıran taraf
 * kodu tamamen atar.
 */
async function fetchLocalities(postalCode: string): Promise<OpenPlzLocality[]> {
  const response = await fetch(`${OPENPLZ_URL}?postalCode=${postalCode}`);
  if (!response.ok) throw new Error(`OpenPLZ ${postalCode}: ${response.status}`);
  return (await response.json()) as OpenPlzLocality[];
}

/* ---------------------------------------------------------------- çıktı */

function render(areas: Locality[], radiusKm: number): string {
  const generatedAt = new Date().toISOString().slice(0, 10);

  const rows = areas
    .map(
      (a) =>
        `  { postalCode: ${JSON.stringify(a.postalCode)}, city: ${JSON.stringify(
          a.city
        )}, district: ${JSON.stringify(a.district)}, distanceKm: ${a.distanceKm.toFixed(1)} },`
    )
    .join("\n");

  const postalCodes = new Set(areas.map((a) => a.postalCode));

  return `/**
 * ÜRETİLMİŞ DOSYA — elle düzenlemeyin.
 *
 * Kaynak: \`scripts/scrape-delivery-areas.ts\` (GeoNames posta kodu dizini +
 * OpenPLZ resmî yer dizini). Yeniden üretmek için: \`bun run data:areas\`.
 *
 * ${BUSINESS_INFO.address.city} çevresinde ${radiusKm} km yarıçaptaki
 * ${postalCodes.size} posta kodu, ${areas.length} belediye. Üretim tarihi: ${generatedAt}.
 *
 * Bu liste **teslimat verilen yer listesi değildir**; panelde açılmayı bekleyen
 * adaylardır. Hangi köye araç çıkacağına harita değil işletme karar verir
 * (bkz. \`prisma/seed.ts\`, bölgeler kapalı tohumlanır).
 */

export type DeliveryArea = {
  postalCode: string;
  /** Resmî belediye adı — müşteriye gösterilen ad budur. */
  city: string;
  district: string;
  /** İşletmeye kuş uçuşu uzaklık, km. */
  distanceKm: number;
};

/** Uzaklığa göre sıralı: en yakın belediye başta. */
export const DELIVERY_AREAS: DeliveryArea[] = [
${rows}
];

export const DELIVERY_AREA_RADIUS_KM = ${radiusKm};

/**
 * Bir posta kodunun kapsadığı belediyeler.
 *
 * Tekil değil: 94342 hem Straßkirchen'i hem Irlbach'ı kapsar, 94330 hem
 * Aiterhofen'i hem Salching'i. Müşteri kendi köyünün adını arar — ikisini
 * "Aiterhofen / Salching" diye tek satırda birleştirmek, Salching'de oturana
 * kendi adresini tanımayan bir liste gösterir. Bu yüzden posta kodu bir bölge
 * (fiyat/ücret birimi), belediye ise bir seçenek olarak tutulur.
 */
export function citiesForPostalCode(postalCode: string): string[] {
  const code = postalCode.trim();
  return DELIVERY_AREAS.filter((area) => area.postalCode === code).map((area) => area.city);
}
`;
}

/* ----------------------------------------------------------------- akış */

async function main() {
  const radiusKm = Number(process.argv[2]) || DEFAULT_RADIUS_KM;
  console.log(
    `${BUSINESS_INFO.address.city} merkezli ${radiusKm} km — teslimat bölgesi listesi üretiliyor.\n`
  );

  const nearest = await fetchPostalCodesInRadius(radiusKm);
  const codes = [...nearest.keys()].sort();

  console.log(`OpenPLZ doğrulaması (${codes.length} istek)…`);
  const areas: Locality[] = [];
  let dropped = 0;

  for (const postalCode of codes) {
    const localities = await fetchLocalities(postalCode);
    if (localities.length === 0) {
      // Großempfänger: gerçek bir yerleşim değil.
      dropped++;
      continue;
    }
    for (const locality of localities) {
      areas.push({
        postalCode,
        city: locality.name,
        district: locality.district?.name ?? "",
        distanceKm: nearest.get(postalCode)!,
      });
    }
  }

  areas.sort((a, b) => a.distanceKm - b.distanceKm || a.city.localeCompare(b.city, "de"));

  const target = resolve(import.meta.dirname, "../data/deliveryAreas.ts");
  writeFileSync(target, render(areas, radiusKm), "utf8");

  console.log(`  ${dropped} Großempfänger kodu elendi`);
  console.log(`\ndata/deliveryAreas.ts yazıldı — ${areas.length} belediye.`);
  for (const area of areas.slice(0, 12)) {
    console.log(`  ${area.distanceKm.toFixed(1).padStart(5)} km  ${area.postalCode}  ${area.city}`);
  }
  if (areas.length > 12) console.log(`  … ve ${areas.length - 12} tane daha`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
