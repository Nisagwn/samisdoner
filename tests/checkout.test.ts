import { describe, expect, it } from "vitest";
import {
  EMPTY_CHECKOUT_FORM,
  toCreateOrderInput,
  validateCheckoutForm,
  type CheckoutFormValues,
} from "@/lib/checkout/validate";
import { createOrderSchema, deliveryAddressSchema } from "@/lib/orders/schema";

/**
 * Ödeme formu doğrulaması.
 *
 * Buradaki asıl sınav "istemci doğru mu" değil, **istemci ile sunucu aynı şeyi
 * mi söylüyor**. İkisi ayrışırsa müşteri, sunucunun reddedeceği bir formu
 * "geçerli" görür ve hatayı ancak ödeme adımında öğrenir. Bu yüzden testlerin
 * bir kısmı aynı girdiyi hem `validateCheckoutForm`'a hem `createOrderSchema`'ya
 * verip iki tarafın kararını karşılaştırıyor.
 */

const messages = {
  name: "ad",
  phone: "telefon",
  email: "eposta",
  street: "sokak",
  houseNo: "no",
  zip: "plz",
  city: "sehir",
};

function form(overrides: Partial<CheckoutFormValues> = {}): CheckoutFormValues {
  return {
    ...EMPTY_CHECKOUT_FORM,
    name: "Ayşe Yılmaz",
    phone: "0176 1234567",
    street: "Straubinger Str.",
    houseNo: "3",
    ...overrides,
  };
}

const validate = (values: CheckoutFormValues, extra: { zip?: string; city?: string } = {}) =>
  validateCheckoutForm({
    values,
    fulfillment: "DELIVERY",
    zip: extra.zip ?? "94342",
    city: extra.city ?? "Straßkirchen",
    messages,
  });

describe("ödeme formu doğrulaması", () => {
  it("eksiksiz teslimat formunu kabul eder", () => {
    expect(validate(form())).toEqual({});
  });

  it("kat ve zil ismi boş olabilir — ikisi de isteğe bağlı", () => {
    expect(validate(form({ floor: "", bellName: "" }))).toEqual({});
  });

  it("tek harflik adı reddeder", () => {
    expect(validate(form({ name: "A" })).name).toBe(messages.name);
  });

  it("boşluktan ibaret adı reddeder", () => {
    expect(validate(form({ name: "    " })).name).toBe(messages.name);
  });

  it("kısa ve harf içeren telefonu reddeder", () => {
    expect(validate(form({ phone: "0176" })).phone).toBe(messages.phone);
    expect(validate(form({ phone: "sıfır yüz yetmiş" })).phone).toBe(messages.phone);
  });

  it("boşluk, parantez ve + içeren telefonu kabul eder", () => {
    expect(validate(form({ phone: "+49 (9424) 39093" })).phone).toBeUndefined();
  });

  it("e-posta boşsa hata vermez, doluysa denetler", () => {
    expect(validate(form({ email: "" })).email).toBeUndefined();
    expect(validate(form({ email: "ayse@example.com" })).email).toBeUndefined();
    expect(validate(form({ email: "ayse@" })).email).toBe(messages.email);
    expect(validate(form({ email: "ayse.example.com" })).email).toBe(messages.email);
    expect(validate(form({ email: "a@b@c.com" })).email).toBe(messages.email);
  });

  it("artı etiketli adresi reddetmez (geçerli ama sıra dışı)", () => {
    expect(validate(form({ email: "ayse+siparis@example.co.uk" })).email).toBeUndefined();
  });

  it("beş haneli olmayan posta kodunu reddeder", () => {
    expect(validate(form(), { zip: "9434" }).zip).toBe(messages.zip);
    expect(validate(form(), { zip: "" }).zip).toBe(messages.zip);
  });

  it("gel-alda adres alanlarını hiç sormaz", () => {
    const errors = validateCheckoutForm({
      values: { ...EMPTY_CHECKOUT_FORM, name: "Ayşe Yılmaz", phone: "0176 1234567" },
      fulfillment: "PICKUP",
      zip: "",
      city: "",
      messages,
    });
    expect(errors).toEqual({});
  });
});

describe("istemci ile sunucu kuralları ayrışmıyor", () => {
  const lines = [{ kind: "product" as const, productId: "p1", qty: 1 }];

  it("istemcinin kabul ettiği form sunucudan da geçer", () => {
    const values = form({ email: "ayse@example.com", floor: "3. OG", bellName: "Yılmaz" });
    expect(validate(values)).toEqual({});

    const parsed = createOrderSchema.safeParse(
      toCreateOrderInput({
        lines,
        lang: "de",
        fulfillment: "DELIVERY",
        values,
        zip: "94342",
        city: "Straßkirchen",
      })
    );
    expect(parsed.success).toBe(true);
  });

  it("istemcinin reddettiği telefonu sunucu da reddeder", () => {
    const values = form({ phone: "0176" });
    expect(validate(values).phone).toBe(messages.phone);

    const parsed = createOrderSchema.safeParse(
      toCreateOrderInput({
        lines,
        lang: "de",
        fulfillment: "DELIVERY",
        values,
        zip: "94342",
        city: "Straßkirchen",
      })
    );
    expect(parsed.success).toBe(false);
  });

  it("gel-alda adres gövdeye hiç eklenmez", () => {
    const body = toCreateOrderInput({
      lines,
      lang: "de",
      fulfillment: "PICKUP",
      values: form(),
      zip: "94342",
      city: "Straßkirchen",
    });
    expect(body).not.toHaveProperty("address");
    expect(createOrderSchema.safeParse(body).success).toBe(true);
  });

  it("gövde alanları kırpılır — kurye kapıda boşluk okumaz", () => {
    const body = toCreateOrderInput({
      lines,
      lang: "de",
      fulfillment: "DELIVERY",
      values: form({ floor: "  3. OG links  ", bellName: "  Yılmaz  " }),
      zip: "94342",
      city: "  Straßkirchen  ",
    });
    expect(body.address?.floor).toBe("3. OG links");
    expect(body.address?.bellName).toBe("Yılmaz");
    expect(body.address?.city).toBe("Straßkirchen");
  });

  /*
   * Gövdede **tek** para alanı vardır: bahşiş.
   *
   * Testin asıl sorusu değişmedi — "istemci fiyat gönderiyor mu". Cevap hâlâ
   * hayır: satır fiyatı, ara toplam, ücret ve genel toplam gövdede yok ve
   * hepsi sunucuda katalogtan hesaplanıyor. Bahşiş ise bir fiyat değil,
   * müşterinin serbestçe belirlediği bir tutar; başka türlü öğrenilemez ve
   * sunucuda `clampTip` ile kelepçelenir.
   *
   * Kupon da aynı mantıkla kod olarak gider, indirim tutarı olarak değil:
   * indirimin kaç cent olduğuna kuralı okuyan sunucu karar verir.
   */
  it("gövdeye fiyat alanı eklenmez — bahşiş dışında para taşınmaz", () => {
    const body = toCreateOrderInput({
      lines,
      lang: "de",
      fulfillment: "DELIVERY",
      values: form(),
      zip: "94342",
      city: "Straßkirchen",
      couponCode: "DOENER10",
      tipCents: 200,
    });

    const { tipCents, ...withoutTip } = body;
    expect(tipCents).toBe(200);
    expect(JSON.stringify(withoutTip)).not.toMatch(/price|total|cents/i);

    // Kupon koddur, tutar değil: indirimi sunucu hesaplar.
    expect(body.couponCode).toBe("DOENER10");
  });

  it("varsayılan ödeme yöntemi online, ön sipariş saati hiç gönderilmez", () => {
    const body = toCreateOrderInput({
      lines,
      lang: "de",
      fulfillment: "DELIVERY",
      values: form(),
      zip: "94342",
      city: "Straßkirchen",
    });

    expect(body.paymentMethod).toBe("ONLINE");
    // "En kısa sürede" demenin karşılığı, alanın hiç olmaması: boş dize
    // sunucudaki ISO tarih doğrulamasını düşürürdü.
    expect("requestedAt" in body).toBe(false);
  });

  it("seçilen ön sipariş saati gövdeye olduğu gibi girer", () => {
    const body = toCreateOrderInput({
      lines,
      lang: "de",
      fulfillment: "DELIVERY",
      values: form(),
      zip: "94342",
      city: "Straßkirchen",
      paymentMethod: "CASH",
      requestedAt: "2026-09-15T18:30:00.000Z",
    });

    expect(body.paymentMethod).toBe("CASH");
    expect(body).toHaveProperty("requestedAt", "2026-09-15T18:30:00.000Z");
  });

  /*
   * İstemcinin ürettiği gövde, sunucu şemasından geçmeli. Bu iki taraf
   * ayrışırsa müşteri, sunucunun reddedeceği bir siparişi gönderir ve hatayı
   * ancak ödeme adımında öğrenir.
   */
  it("yeni alanlarla birlikte sunucu şemasından geçer", () => {
    const body = toCreateOrderInput({
      lines,
      lang: "de",
      fulfillment: "DELIVERY",
      values: form(),
      zip: "94342",
      city: "Straßkirchen",
      paymentMethod: "CARD_ON_DELIVERY",
      couponCode: "DOENER10",
      tipCents: 250,
      requestedAt: "2026-09-15T18:30:00.000Z",
    });

    const parsed = createOrderSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.paymentMethod).toBe("CARD_ON_DELIVERY");
      expect(parsed.data.tipCents).toBe(250);
      expect(parsed.data.couponCode).toBe("DOENER10");
    }
  });
});

describe("teslimat adresi şeması", () => {
  it("kat ve zil ismi verilmezse boş dizeye düşer", () => {
    const parsed = deliveryAddressSchema.parse({
      street: "Straubinger Str.",
      houseNo: "3",
      zip: "94342",
      city: "Straßkirchen",
    });
    expect(parsed.floor).toBe("");
    expect(parsed.bellName).toBe("");
  });

  it("aşırı uzun zil ismini reddeder", () => {
    const result = deliveryAddressSchema.safeParse({
      street: "Straubinger Str.",
      houseNo: "3",
      bellName: "x".repeat(81),
      zip: "94342",
      city: "Straßkirchen",
    });
    expect(result.success).toBe(false);
  });
});
