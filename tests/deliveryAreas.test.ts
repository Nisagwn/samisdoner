import { describe, expect, it } from "vitest";
import {
  DELIVERY_AREAS,
  DELIVERY_AREA_RADIUS_KM,
  citiesForPostalCode,
} from "@/data/deliveryAreas";
import {
  foldForSearch,
  groupZonesByCity,
  matchesZoneSearch,
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

/**
 * Panelin aday listesi. Yanlış üretilen bir aday, işletmecinin teslimata
 * açtığını sandığı ama hiçbir müşterinin denk gelmediği bir posta kodudur.
 */
describe("panel aday posta kodları", () => {
  it("her kodu bir kez listeler ve belediyelerini toplar", () => {
    const candidates = postalCodeCandidates();
    const codes = candidates.map((candidate) => candidate.postalCode);
    expect(new Set(codes).size).toBe(codes.length);

    const multi = candidates.find((candidate) => candidate.postalCode === "94342");
    expect(multi?.cities).toEqual(expect.arrayContaining(["Straßkirchen", "Irlbach"]));
  });

  it("uzaklığa göre sıralı — en yakın köy başta", () => {
    const distances = postalCodeCandidates().map((candidate) => candidate.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it("eklenmiş kodu işaretler ama listeden atmaz", () => {
    const candidates = postalCodeCandidates(["94342"]);
    expect(candidates.find((c) => c.postalCode === "94342")?.taken).toBe(true);
    expect(candidates.filter((c) => c.taken)).toHaveLength(1);
  });

  it("dizinde olmayan bir kodun eklenmiş olması listeyi bozmaz", () => {
    // Panelde elle yazılmış, yarıçap dışı bir kod. Eşleşecek aday yok.
    expect(postalCodeCandidates(["10115"]).every((c) => !c.taken)).toBe(true);
  });

  it("belediye adları tekrarsız ve alfabetik", () => {
    const names = knownCityNames();
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort((a, b) => a.localeCompare(b, "de"))).toEqual(names);
  });
});

/**
 * Panelin arama kutusu. Almanca yer adlarını Türkçe klavyeyle arayan kişi
 * "ß" ya da "ö" yazamaz; eşleşme kurulamazsa kutu çalışmıyor sanılır ve elli
 * küsur satır elle taranmaya geri dönülür.
 */
describe("arama için sadeleştirme", () => {
  it("büyük/küçük harf ayırmaz", () => {
    expect(foldForSearch("Irlbach")).toBe(foldForSearch("irlbach"));
  });

  it("ß yerine ss yazılabilir", () => {
    expect(foldForSearch("Straßkirchen")).toContain("strasskirchen");
    expect(foldForSearch("Straßkirchen").includes(foldForSearch("strassk"))).toBe(true);
  });

  it("noktalı harfler taşıyıcı harfe iner", () => {
    expect(foldForSearch("Röhrnbach")).toBe("rohrnbach");
    expect(foldForSearch("Künzing")).toBe("kunzing");
  });

  it("baştaki ve sondaki boşluğu atar", () => {
    expect(foldForSearch("  94342 ")).toBe("94342");
  });

  it("dizindeki her belediye kendi sadeleştirilmiş adıyla bulunur", () => {
    for (const name of knownCityNames()) {
      expect(foldForSearch(name).includes(foldForSearch(name.slice(0, 3)))).toBe(true);
    }
  });
});

/**
 * Arama kutusunun kendisi. Panelde elli küsur posta kodu var; kutu sessizce
 * boş dönerse işletmeci "böyle bir bölge yok" sanıp aynı kodu ikinci kez
 * eklemeye kalkar.
 */
describe("bölge araması", () => {
  const row = (postalCode: string, city: string) => ({ postalCode, city });

  it("posta kodunun parçasıyla bulur", () => {
    expect(matchesZoneSearch(row("94342", "Irlbach"), foldForSearch("943"))).toBe(true);
    expect(matchesZoneSearch(row("94342", "Irlbach"), foldForSearch("94342"))).toBe(true);
  });

  it("şehir adının parçasıyla bulur, büyük/küçük harf ayırmaz", () => {
    expect(matchesZoneSearch(row("94342", "Irlbach"), foldForSearch("irl"))).toBe(true);
    expect(matchesZoneSearch(row("94342", "Irlbach"), foldForSearch("BACH"))).toBe(true);
  });

  it("ß ve noktalı harfler düz yazılabilir", () => {
    expect(matchesZoneSearch(row("94342", "Straßkirchen"), foldForSearch("strassk"))).toBe(true);
    expect(matchesZoneSearch(row("94342", "Straßkirchen"), foldForSearch("Straßk"))).toBe(true);
    expect(matchesZoneSearch(row("94339", "Röhrnbach"), foldForSearch("rohrn"))).toBe(true);
  });

  it("eşleşmeyeni göstermez", () => {
    expect(matchesZoneSearch(row("94342", "Irlbach"), foldForSearch("münchen"))).toBe(false);
    expect(matchesZoneSearch(row("94342", "Irlbach"), foldForSearch("10115"))).toBe(false);
  });

  it("boş kutu her satırı gösterir — arama yokken liste eksilmez", () => {
    expect(matchesZoneSearch(row("94342", "Irlbach"), foldForSearch("   "))).toBe(true);
    expect(matchesZoneSearch(row("94342", "Irlbach"), "")).toBe(true);
  });

  it("kodla ad arasındaki boşluk sahte eşleşme üretmez", () => {
    // "Irlbach" ve "94342" tek bir metinde taranıyor; aradaki boşluğu kapsayan
    // bir arama satırı bulursa kutu anlamsız sonuçlar gösterirdi.
    expect(matchesZoneSearch(row("94342", "Irlbach"), foldForSearch("2 irl"))).toBe(false);
  });

  it("panelde gerçekten aranacak adları bulur", () => {
    // Dizin yeniden üretildiğinde adlar değişebilir; arama o adların
    // üstünde çalışmalı.
    for (const name of knownCityNames().slice(0, 10)) {
      expect(matchesZoneSearch(row("00000", name), foldForSearch(name))).toBe(true);
    }
  });
});
