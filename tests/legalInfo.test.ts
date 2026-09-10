import { describe, expect, it } from "vitest";
import { parseCategoryPatch, parseProductBody } from "@/lib/admin/validate";
import { VAT_RATES } from "@/lib/admin/types";

/**
 * Ürünün yasal bilgi alanlarının doğrulanması.
 *
 * Geriye iki alan kaldı: `vatRate` ve `isPerishable`. İkisi de gövdeden
 * **sessizce düşüyordu** — depo katmanı onları yazmaya hazırdı ama doğrulayıcı
 * tanımıyordu; bu dosyanın varlık sebebi o hatanın geri gelmemesi.
 *
 * Ürün başına alerjen/katkı maddesi girişi kaldırıldı; alerjen bildirimi artık
 * kartanın ve sipariş sayfasının altındaki tek uyarıdır. Aşağıda bunun bir
 * testi var: gövdeye alerjen alanı konsa bile yamaya girmemeli, yoksa
 * kaldırılmış bir alan panelden sessizce yazılmaya devam eder.
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

describe("kaldırılan alerjen alanları", () => {
  it("gövdeden gelse bile yamaya girmez", () => {
    const result = parseProductBody(
      body({ allergens: ["GLUTEN"], additives: ["FARBSTOFF"], allergenInfoConfirmed: true }),
      CATEGORIES,
      false
    );
    // İstek reddedilmez: eski bir sekmeden ya da betikten gelen gövde yüzünden
    // ürün kaydetmek imkânsız hale gelmemeli. Alanlar yalnızca yok sayılır.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toHaveProperty("allergens");
    expect(result.value).not.toHaveProperty("additives");
    expect(result.value).not.toHaveProperty("allergenInfoConfirmed");
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

describe("bozulabilirlik bayrağı", () => {
  it("yeni üründe çabuk bozulan açık başlar", () => {
    const result = parseProductBody(body(), CATEGORIES, false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.isPerishable).toBe(true);
  });

  it("kısmi güncellemede gönderilmeyen bayrağa dokunmaz", () => {
    const result = parseProductBody({ name: "Cola" }, CATEGORIES, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.isPerishable).toBeUndefined();
    expect(result.value.vatRate).toBeUndefined();
  });

  it("içecekte kapatılabilir", () => {
    // Kapalı şişe içecek § 312g Abs. 2 Nr. 1 BGB istisnasına girmez.
    const result = parseProductBody({ isPerishable: false }, CATEGORIES, true);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.isPerishable).toBe(false);
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
