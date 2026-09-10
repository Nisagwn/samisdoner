import { describe, expect, it } from "vitest";
import { parseCategoryPatch, parseProductBody } from "@/lib/admin/validate";
import { ADDITIVES, ALLERGENS, VAT_RATES, hasLegalInfo } from "@/lib/admin/types";

/**
 * Ürünün yasal bilgi alanlarının doğrulanması.
 *
 * Bu alanlar (`allergens`, `additives`, `vatRate`, `allergenInfoConfirmed`,
 * `isPerishable`) gövdeden **sessizce düşüyordu**: depo katmanı onları yazmaya
 * hazırdı ama doğrulayıcı tanımıyordu, dolayısıyla panelden gönderilen her
 * değer kayboluyordu.
 *
 * Buradaki en önemli test "sessiz düşme yok" olanı. Alerjen alanında bir kodun
 * sessizce yutulması, işletmecinin glüteni işaretlediğini sanıp menüde hiçbir
 * şey görmemesi demektir; bu doğrudan bir sağlık riski, kozmetik bir hata değil.
 */

const CATEGORIES = ["doener", "getraenke"];

/** Yeni ürün için asgari geçerli gövde (`partial: false` yolu). */
function body(extra: Record<string, unknown> = {}) {
  return {
    name: "Döner Teller",
    nameTr: "",
    no: "12",
    description: "",
    descriptionTr: "",
    categoryId: "doener",
    price: "9,50",
    discountPrice: "",
    image: null,
    variants: [],
    ...extra,
  };
}

describe("ürün yasal bilgi doğrulaması", () => {
  it("alerjen ve katkı maddesi listelerini kabul eder", () => {
    const result = parseProductBody(
      body({ allergens: ["GLUTEN", "MILK"], additives: ["FARBSTOFF"] }),
      CATEGORIES,
      false
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.allergens).toEqual(["GLUTEN", "MILK"]);
    expect(result.value.additives).toEqual(["FARBSTOFF"]);
  });

  it("tanınmayan alerjen kodunu sessizce düşürmez, hata verir", () => {
    const result = parseProductBody(body({ allergens: ["GLUTEN", "TOZ_SEKER"] }), CATEGORIES, false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Alerjen");
  });

  it("tanınmayan katkı maddesi kodunu reddeder", () => {
    const result = parseProductBody(body({ additives: ["E999"] }), CATEGORIES, false);
    expect(result.ok).toBe(false);
  });

  it("liste yerine metin gelirse reddeder", () => {
    const result = parseProductBody(body({ allergens: "GLUTEN" }), CATEGORIES, false);
    expect(result.ok).toBe(false);
  });

  it("tekrar eden kodları teke indirir ve sabit listenin sırasına sokar", () => {
    // Girişteki sıra ters ve MILK iki kez: aynı seçim her kayıtta aynı diziyi
    // üretmeli, yoksa hiçbir şey değişmeden "değişti" görünür.
    const result = parseProductBody(
      body({ allergens: ["MILK", "GLUTEN", "MILK"] }),
      CATEGORIES,
      false
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.allergens).toEqual(["GLUTEN", "MILK"]);
  });

  it("boş liste geçerlidir — 'madde yok' beyanı ayrı alandır", () => {
    const result = parseProductBody(body({ allergens: [] }), CATEGORIES, false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.allergens).toEqual([]);
  });

  it("bilinen her alerjen ve katkı maddesi kodunu kabul eder", () => {
    const result = parseProductBody(
      body({ allergens: [...ALLERGENS], additives: [...ADDITIVES] }),
      CATEGORIES,
      false
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.allergens).toHaveLength(ALLERGENS.length);
    expect(result.value.additives).toHaveLength(ADDITIVES.length);
  });
});

describe("KDV oranı", () => {
  it("geçerli oranları kabul eder", () => {
    for (const rate of VAT_RATES) {
      const result = parseProductBody(body({ vatRate: rate }), CATEGORIES, false);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.vatRate).toBe(rate);
    }
  });

  it("metin olarak gelen oranı sayıya çevirir", () => {
    const result = parseProductBody(body({ vatRate: "19" }), CATEGORIES, false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.vatRate).toBe(19);
  });

  it("listede olmayan oranı reddeder", () => {
    // Serbest sayı kabul edilseydi yanlış oran fişe ve KDV beyanına giderdi.
    for (const bad of [0, 5, 20, 7.5, -7]) {
      expect(parseProductBody(body({ vatRate: bad }), CATEGORIES, false).ok).toBe(false);
    }
  });

  it("yeni üründe oran gönderilmezse varsayılan yemek oranıdır", () => {
    const result = parseProductBody(body(), CATEGORIES, false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.vatRate).toBe(7);
  });
});

describe("beyan ve bozulabilirlik bayrakları", () => {
  it("yeni üründe beyan kapalı, çabuk bozulan açık başlar", () => {
    const result = parseProductBody(body(), CATEGORIES, false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Beyan varsayılan olarak açık olsaydı, bilgi girilmemiş her ürün
    // "madde yok" demiş sayılırdı.
    expect(result.value.allergenInfoConfirmed).toBe(false);
    expect(result.value.isPerishable).toBe(true);
  });

  it("kısmi güncellemede gönderilmeyen bayrağa dokunmaz", () => {
    const result = parseProductBody({ name: "Cola" }, CATEGORIES, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.allergenInfoConfirmed).toBeUndefined();
    expect(result.value.isPerishable).toBeUndefined();
    expect(result.value.vatRate).toBeUndefined();
  });

  it("kısmi güncellemede yalnızca alerjenler gönderilebilir", () => {
    // Toplu alerjen ekranının yaptığı istek tam olarak budur.
    const result = parseProductBody(
      { allergens: ["SESAME"], allergenInfoConfirmed: true },
      CATEGORIES,
      true
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.allergens).toEqual(["SESAME"]);
    expect(result.value.allergenInfoConfirmed).toBe(true);
    expect(result.value.name).toBeUndefined();
  });
});

describe("hasLegalInfo", () => {
  it("alerjen işaretliyse bilgi tamdır", () => {
    expect(hasLegalInfo({ allergens: ["GLUTEN"], allergenInfoConfirmed: false })).toBe(true);
  });

  it("liste boş ama beyan varsa bilgi tamdır", () => {
    expect(hasLegalInfo({ allergens: [], allergenInfoConfirmed: true })).toBe(true);
  });

  it("liste boş ve beyan yoksa bilgi eksiktir", () => {
    // İki hâlin ayrımı budur: "girilmedi" ile "yok" aynı şey değil.
    expect(hasLegalInfo({ allergens: [], allergenInfoConfirmed: false })).toBe(false);
  });
});

describe("kategori yaması", () => {
  it("dört metin alanını da kabul eder", () => {
    const result = parseCategoryPatch({
      name: "Getränke",
      nameTr: "İçecekler",
      note: "zzgl. Pfand",
      noteTr: "depozito hariç",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      name: "Getränke",
      nameTr: "İçecekler",
      note: "zzgl. Pfand",
      noteTr: "depozito hariç",
    });
  });

  it("yalnızca sıra gönderilebilir", () => {
    // Sıralama okları tam olarak bu isteği yapar.
    const result = parseCategoryPatch({ sortOrder: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ sortOrder: 3 });
  });

  it("gönderilmeyen alanı yamaya koymaz", () => {
    const result = parseCategoryPatch({ nameTr: "Tatlılar" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value)).toEqual(["nameTr"]);
  });

  it("boş ad reddedilir", () => {
    expect(parseCategoryPatch({ name: "   " }).ok).toBe(false);
  });

  it("boş Türkçe ad ve boş not kabul edilir", () => {
    // Boş `nameTr` "Türkçesi de aynı", boş not "not yok" demektir.
    const result = parseCategoryPatch({ nameTr: "", note: "" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ nameTr: "", note: "" });
  });

  it("boş gövde boş yama üretir", () => {
    const result = parseCategoryPatch({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
  });
});
