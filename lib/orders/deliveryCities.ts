import { citiesForPostalCode } from "@/data/deliveryAreas";

/**
 * Teslimat bölgesi satırlarını **müşteriye gösterilen belediye listesine** çevirir.
 *
 * Tabloda satır posta kodudur, seçenek ise belediyedir ve ikisi bire bir
 * değildir: 94342 hem Straßkirchen'i hem Irlbach'ı kapsar, tersinden Aiterhofen
 * hem 94330'a hem 94315'e dağılır. Tek satırı "Irlbach / Straßkirchen" diye
 * göstermek Irlbach'ta oturana kendi adresini tanımayan bir liste verirdi.
 *
 * Ucun kendisinden ayrı bir dosyada: burası saf bir dönüşüm, testte veritabanı
 * olmadan çalıştırılabilmeli — listeyle tablonun ayrışması sessizce olur,
 * müşteri şehrini bulamayınca fark edilir.
 */

export type DeliveryZoneOption = {
  zip: string;
  minOrderCents: number;
  feeCents: number;
  freeOverCents: number;
  etaMinutes: number;
};

export type DeliveryCity = {
  city: string;
  zips: DeliveryZoneOption[];
};

export type ZoneRow = {
  postalCode: string;
  city: string;
  minOrderCents: number;
  feeCents: number;
  freeOverCents: number;
  etaMinutes: number;
};

export function groupZonesByCity(zones: ZoneRow[]): DeliveryCity[] {
  const byCity = new Map<string, DeliveryZoneOption[]>();

  for (const zone of zones) {
    const option: DeliveryZoneOption = {
      zip: zone.postalCode,
      minOrderCents: zone.minOrderCents,
      feeCents: zone.feeCents,
      freeOverCents: zone.freeOverCents,
      etaMinutes: zone.etaMinutes,
    };

    /*
     * Resmî liste öncelikli; yoksa panelin yazdığı ad. Şehir adı hiç girilmemiş
     * bir bölge posta koduyla anılır — boş başlıklı bir seçenek kutusu
     * kullanılamaz.
     */
    const official = citiesForPostalCode(zone.postalCode);
    const names = official.length > 0 ? official : [zone.city.trim() || zone.postalCode];

    for (const city of names) {
      const list = byCity.get(city) ?? [];
      // Aynı belediye iki posta kodundan gelebilir (Aiterhofen: 94330 + 94315).
      if (!list.some((entry) => entry.zip === option.zip)) list.push(option);
      byCity.set(city, list);
    }
  }

  return [...byCity.entries()]
    .map(([city, zips]) => ({
      city,
      zips: [...zips].sort((a, b) => a.zip.localeCompare(b.zip)),
    }))
    .sort((a, b) => a.city.localeCompare(b.city, "de"));
}
