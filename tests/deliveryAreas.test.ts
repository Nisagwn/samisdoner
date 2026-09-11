import { describe, expect, it } from "vitest";
import {
  DELIVERY_AREAS,
  DELIVERY_AREA_RADIUS_KM,
  citiesForPostalCode,
} from "@/data/deliveryAreas";
import {
  groupZonesByCity,
  knownCityNames,
  postalCodeCandidates,
  type ZoneRow,
} from "@/lib/orders/deliveryCities";
import { BUSINESS_INFO } from "@/data/businessInfo";

/**
 * `data/deliveryAreas.ts` üretilmiş bir dosya, elle düzenlenmiyor — ama
 * yeniden üretildiğinde (yarıçap değişti, kaynak veri güncellendi) sessizce
 * bozulabilir. Bu testler o sessizliği kırar: liste boşalırsa, posta kodu
 * biçimi değişirse ya da işletmenin kendi bölgesi listeden düşerse sipariş
 * formundaki şehir listesi boş gelir ve kimse sipariş veremez.
 */
describe("teslimat bölgesi listesi", () => {
  it("boş değil ve uzaklığa göre sıralı", () => {
    expect(DELIVERY_AREAS.length).toBeGreaterThan(20);

    const distances = DELIVERY_AREAS.map((area) => area.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it("her satır beş haneli bir posta kodu ve dolu bir belediye adı taşır", () => {
    for (const area of DELIVERY_AREAS) {
      expect(area.postalCode).toMatch(/^\d{5}$/);
      expect(area.city.trim().length).toBeGreaterThan(1);
      expect(area.distanceKm).toBeLessThanOrEqual(DELIVERY_AREA_RADIUS_KM);
    }
  });

  it("aynı posta kodu–belediye çifti iki kez geçmez", () => {
    const seen = new Set(DELIVERY_AREAS.map((area) => `${area.postalCode}|${area.city}`));
    expect(seen.size).toBe(DELIVERY_AREAS.length);
  });

  it("işletmenin kendi posta kodu ve şehri listede", () => {
    const home = citiesForPostalCode(BUSINESS_INFO.address.postalCode);
    expect(home).toContain(BUSINESS_INFO.address.city);
  });

  it("bir posta kodu birden çok belediye taşıyabilir", () => {
    // 94342 hem Straßkirchen'i hem Irlbach'ı kapsar — teslimat listesinin
    // posta koduna değil belediyeye göre kurulmasının sebebi bu.
    expect(citiesForPostalCode("94342").length).toBeGreaterThan(1);
  });

  it("listede olmayan posta kodu boş döner", () => {
    expect(citiesForPostalCode("10115")).toEqual([]);
    expect(citiesForPostalCode("")).toEqual([]);
  });
});

const zone = (postalCode: string, city: string, extra: Partial<ZoneRow> = {}): ZoneRow => ({
  postalCode,
  city,
  minOrderCents: 1500,
  feeCents: 250,
  freeOverCents: 3000,
  etaMinutes: 45,
  ...extra,
});

describe("bölge satırlarının belediye listesine açılması", () => {
  it("bir posta kodu kapsadığı her belediye için seçenek üretir", () => {
    const cities = groupZonesByCity([zone("94342", "Straßkirchen / Irlbach")]);

    expect(cities.map((entry) => entry.city)).toEqual(["Irlbach", "Straßkirchen"]);
    // Tarife tek satırdan gelir; iki belediye de aynı ücreti görür.
    for (const entry of cities) {
      expect(entry.zips).toEqual([
        { zip: "94342", minOrderCents: 1500, feeCents: 250, freeOverCents: 3000, etaMinutes: 45 },
      ]);
    }
  });

  it("iki posta koduna dağılan belediye tek seçenekte iki kod gösterir", () => {
    const cities = groupZonesByCity([
      zone("94330", "Aiterhofen / Salching"),
      zone("94315", "Straubing", { feeCents: 350 }),
    ]);

    const aiterhofen = cities.find((entry) => entry.city === "Aiterhofen");
    expect(aiterhofen?.zips.map((z) => z.zip)).toEqual(["94315", "94330"]);
    // Kodların tarifesi farklı olabilir; bu yüzden seçim müşteriye bırakılır.
    expect(aiterhofen?.zips.find((z) => z.zip === "94315")?.feeCents).toBe(350);
  });

  it("kapalı bölge listeye hiç girmez", () => {
    // Uç yalnızca `active: true` satırları okur; boş girdi boş liste demek.
    expect(groupZonesByCity([])).toEqual([]);
  });

  it("resmî listede olmayan posta kodu panelin yazdığı adla görünür", () => {
    const cities = groupZonesByCity([zone("10115", "Berlin-Mitte")]);
    expect(cities).toEqual([
      {
        city: "Berlin-Mitte",
        zips: [
          { zip: "10115", minOrderCents: 1500, feeCents: 250, freeOverCents: 3000, etaMinutes: 45 },
        ],
      },
    ]);
  });

  it("şehir adı hiç girilmemişse posta koduyla anılır", () => {
    // Boş başlıklı bir seçenek kutusu kullanılamaz.
    const cities = groupZonesByCity([zone("10115", "   ")]);
    expect(cities[0].city).toBe("10115");
  });
});
