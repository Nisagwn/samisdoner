/**
 * ÜRETİLMİŞ DOSYA — elle düzenlemeyin.
 *
 * Kaynak: `scripts/scrape-delivery-areas.ts` (GeoNames posta kodu dizini +
 * OpenPLZ resmî yer dizini). Yeniden üretmek için: `bun run data:areas`.
 *
 * Straßkirchen çevresinde 25 km yarıçaptaki
 * 52 posta kodu, 58 belediye. Üretim tarihi: 2026-09-10.
 *
 * Bu liste **teslimat verilen yer listesi değildir**; panelde açılmayı bekleyen
 * adaylardır. Hangi köye araç çıkacağına harita değil işletme karar verir
 * (bkz. `prisma/seed.ts`, bölgeler kapalı tohumlanır).
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
  { postalCode: "94342", city: "Irlbach", district: "Straubing-Bogen", distanceKm: 0.1 },
  { postalCode: "94342", city: "Straßkirchen", district: "Straubing-Bogen", distanceKm: 0.1 },
  { postalCode: "94553", city: "Mariaposching", district: "Straubing-Bogen", distanceKm: 5.8 },
  { postalCode: "94569", city: "Stephansposching", district: "Deggendorf", distanceKm: 6.0 },
  { postalCode: "94363", city: "Oberschneiding", district: "Straubing-Bogen", distanceKm: 7.0 },
  { postalCode: "94330", city: "Aiterhofen", district: "Straubing-Bogen", distanceKm: 7.2 },
  { postalCode: "94330", city: "Salching", district: "Straubing-Bogen", distanceKm: 7.2 },
  { postalCode: "94559", city: "Niederwinkling", district: "Straubing-Bogen", distanceKm: 8.2 },
  { postalCode: "94327", city: "Bogen", district: "Straubing-Bogen", distanceKm: 9.1 },
  { postalCode: "94563", city: "Otzing", district: "Deggendorf", distanceKm: 10.1 },
  { postalCode: "94522", city: "Wallersdorf", district: "Dingolfing-Landau", distanceKm: 10.6 },
  { postalCode: "94560", city: "Offenberg", district: "Deggendorf", distanceKm: 10.9 },
  { postalCode: "94374", city: "Schwarzach", district: "Straubing-Bogen", distanceKm: 11.5 },
  { postalCode: "94315", city: "Aiterhofen", district: "Straubing-Bogen", distanceKm: 12.1 },
  { postalCode: "94315", city: "Straubing", district: "Straubing", distanceKm: 12.1 },
  { postalCode: "94336", city: "Hunderdorf", district: "Straubing-Bogen", distanceKm: 12.5 },
  { postalCode: "94336", city: "Windberg", district: "Straubing-Bogen", distanceKm: 12.5 },
  { postalCode: "94447", city: "Plattling", district: "Deggendorf", distanceKm: 12.7 },
  { postalCode: "94365", city: "Parkstetten", district: "Straubing-Bogen", distanceKm: 12.9 },
  { postalCode: "94351", city: "Feldkirchen", district: "Straubing-Bogen", distanceKm: 14.1 },
  { postalCode: "94366", city: "Perasdorf", district: "Straubing-Bogen", distanceKm: 14.4 },
  { postalCode: "94526", city: "Metten", district: "Deggendorf", distanceKm: 14.5 },
  { postalCode: "94505", city: "Bernried", district: "Deggendorf", distanceKm: 15.2 },
  { postalCode: "94431", city: "Pilsting", district: "Dingolfing-Landau", distanceKm: 15.4 },
  { postalCode: "94377", city: "Steinach", district: "Straubing-Bogen", distanceKm: 16.0 },
  { postalCode: "94339", city: "Leiblfing", district: "Straubing-Bogen", distanceKm: 16.1 },
  { postalCode: "94362", city: "Neukirchen", district: "Straubing-Bogen", distanceKm: 16.2 },
  { postalCode: "94562", city: "Oberpöring", district: "Deggendorf", distanceKm: 16.3 },
  { postalCode: "94360", city: "Mitterfels", district: "Straubing-Bogen", distanceKm: 16.4 },
  { postalCode: "94527", city: "Aholming", district: "Deggendorf", distanceKm: 17.5 },
  { postalCode: "94469", city: "Deggendorf", district: "Deggendorf", distanceKm: 17.6 },
  { postalCode: "94405", city: "Landau an der Isar", district: "Dingolfing-Landau", distanceKm: 17.8 },
  { postalCode: "94356", city: "Kirchroth", district: "Straubing-Bogen", distanceKm: 18.1 },
  { postalCode: "94348", city: "Atting", district: "Straubing-Bogen", distanceKm: 18.4 },
  { postalCode: "94354", city: "Haselbach", district: "Straubing-Bogen", distanceKm: 19.2 },
  { postalCode: "94554", city: "Moos", district: "Deggendorf", distanceKm: 19.7 },
  { postalCode: "94347", city: "Ascha", district: "Straubing-Bogen", distanceKm: 19.8 },
  { postalCode: "94539", city: "Grafling", district: "Deggendorf", distanceKm: 19.9 },
  { postalCode: "94574", city: "Wallerfing", district: "Deggendorf", distanceKm: 20.1 },
  { postalCode: "94369", city: "Rain", district: "Straubing-Bogen", distanceKm: 20.2 },
  { postalCode: "94379", city: "Sankt Englmar", district: "Straubing-Bogen", distanceKm: 20.6 },
  { postalCode: "94368", city: "Perkam", district: "Straubing-Bogen", distanceKm: 20.7 },
  { postalCode: "94533", city: "Buchhofen", district: "Deggendorf", distanceKm: 21.1 },
  { postalCode: "94350", city: "Falkenfels", district: "Straubing-Bogen", distanceKm: 21.3 },
  { postalCode: "94353", city: "Haibach", district: "Straubing-Bogen", distanceKm: 21.4 },
  { postalCode: "94437", city: "Mamming", district: "Dingolfing-Landau", distanceKm: 21.6 },
  { postalCode: "94372", city: "Rattiszell", district: "Straubing-Bogen", distanceKm: 22.1 },
  { postalCode: "94250", city: "Achslach", district: "Regen", distanceKm: 22.1 },
  { postalCode: "94345", city: "Aholfing", district: "Straubing-Bogen", distanceKm: 22.2 },
  { postalCode: "94557", city: "Niederalteich", district: "Deggendorf", distanceKm: 23.4 },
  { postalCode: "94239", city: "Gotteszell", district: "Regen", distanceKm: 23.4 },
  { postalCode: "94239", city: "Ruhmannsfelden", district: "Regen", distanceKm: 23.4 },
  { postalCode: "94239", city: "Zachenberg", district: "Regen", distanceKm: 23.4 },
  { postalCode: "94333", city: "Geiselhöring", district: "Straubing-Bogen", distanceKm: 23.7 },
  { postalCode: "84164", city: "Moosthenning", district: "Dingolfing-Landau", distanceKm: 23.8 },
  { postalCode: "84152", city: "Mengkofen", district: "Dingolfing-Landau", distanceKm: 24.1 },
  { postalCode: "94428", city: "Eichendorf", district: "Dingolfing-Landau", distanceKm: 24.2 },
  { postalCode: "94375", city: "Stallwang", district: "Straubing-Bogen", distanceKm: 24.9 },
];

export const DELIVERY_AREA_RADIUS_KM = 25;

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
