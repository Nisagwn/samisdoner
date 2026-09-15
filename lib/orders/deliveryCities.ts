import { DELIVERY_AREAS, citiesForPostalCode } from "@/data/deliveryAreas";

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

/* ────────────────────────────────────────────────────── panel: aday listesi */

/**
 * Panelde "yeni bölge" eklerken seçilecek posta kodları.
 *
 * Yukarıdakinin tersi yön: orası tablodan müşteri listesini üretir, burası
 * resmî dizinden panelin seçeneklerini. İşletmeci posta kodunu elle yazarken
 * bir haneyi kaydırdığında hata sessizdir — kod kaydedilir, hiçbir müşteri o
 * bölgeye denk gelmez ve teslimat açılmış sanılır. Listeden seçilen kodda bu
 * hata doğmaz.
 *
 * `taken` ile işaretlenir, listeden atılmaz: zaten eklenmiş bir kodu görmek,
 * "ben bunu eklemiş miydim" sorusunun cevabıdır — sessizce kaybolan satır o
 * soruyu cevapsız bırakır.
 */
export type PostalCodeCandidate = {
  postalCode: string;
  /** Kodun kapsadığı belediyeler — resmî dizinden, panelin yazdığından değil. */
  cities: string[];
  /** İşletmeye kuş uçuşu uzaklık, km. */
  distanceKm: number;
  /** Bu kod için tabloda zaten bir bölge satırı var. */
  taken: boolean;
};

/**
 * Adayları uzaklığa göre sıralı döner — en yakın köy başta.
 *
 * Alfabetik sıra burada yanlış olurdu: teslimat kararı mesafeyle verilir,
 * "sıradaki en yakın yer neresi" sorusunun cevabı listenin başında durmalı.
 */
export function postalCodeCandidates(existing: Iterable<string> = []): PostalCodeCandidate[] {
  const taken = new Set([...existing].map((code) => code.trim()));
  const byCode = new Map<string, PostalCodeCandidate>();

  // DELIVERY_AREAS uzaklığa göre sıralıdır; ilk görülen satır en yakın olandır.
  for (const area of DELIVERY_AREAS) {
    const found = byCode.get(area.postalCode);
    if (found) {
      if (!found.cities.includes(area.city)) found.cities.push(area.city);
      continue;
    }
    byCode.set(area.postalCode, {
      postalCode: area.postalCode,
      cities: [area.city],
      distanceKm: area.distanceKm,
      taken: taken.has(area.postalCode),
    });
  }

  return [...byCode.values()];
}

/**
 * Resmî dizindeki tüm belediye adları, alfabetik ve tekrarsız.
 *
 * Posta kodu elle yazıldığında (dizinde olmayan bir kod) şehir kutusunun yine
 * de bir listesi olsun diye: elle yazılan kod çoğu zaman dizinin yarıçapı
 * dışında kalan bir komşu köydür, adı ise listede bulunur.
 */
export function knownCityNames(): string[] {
  return [...new Set(DELIVERY_AREAS.map((area) => area.city))].sort((a, b) =>
    a.localeCompare(b, "de")
  );
}

/* ──────────────────────────────────────────────────────────── panel: arama */

/**
 * Arama kutusuyla karşılaştırmadan önce metni sadeleştirir.
 *
 * Liste Almanca yer adlarından oluşuyor ama panelde arayan kişi Türkçe klavye
 * kullanıyor: "Straßkirchen" ararken yazılan "strassk", "Röhrnbach" ararken
 * yazılan "rohrn" eşleşmezse kutu çalışmıyor sanılır ve elle taranan bir
 * listeye geri dönülür. ß → ss açılır, aksanlar (ä, ö, ü, é) taşıyıcı harfe
 * indirilir.
 */
export function foldForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/**
 * Panelin arama kutusu bir bölge satırını gösterir mi.
 *
 * Kod ve ad birlikte taranır: işletmeci kimi zaman kodu ("94333") kimi zaman
 * adı ("Aiterhofen") hatırlar, hangisini yazdığını kutuya önceden söylemek
 * zorunda kalmamalı.
 *
 * `needle` **sadeleştirilmiş** gelir (bkz. `foldForSearch`): kutuda her tuş
 * vuruşunda bir kez çevrilir, satır başına değil. Sadeleştirmesi unutulmuş bir
 * çağrı "Straßkirchen" ararken hiçbir şey bulamaz; boş bir liste ise hatadan
 * çok "böyle bir bölge yok" gibi okunur — bu yüzden ayrı bir işlev, ayrı testi
 * olsun diye.
 *
 * İki alan **ayrı ayrı** taranır, birleştirilip tek metin olarak değil: "94342
 * Irlbach" diye birleştirilen satırda "2 irl" araması kodun sonuyla adın
 * başını yakalıyor ve kimsenin kastetmediği bir satır dönüyordu.
 */
export function matchesZoneSearch(
  zone: { postalCode: string; city: string },
  needle: string
): boolean {
  if (needle === "") return true;
  return (
    foldForSearch(zone.postalCode).includes(needle) || foldForSearch(zone.city).includes(needle)
  );
}
