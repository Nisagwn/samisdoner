/**
 * Ödeme formunun istemci tarafı doğrulaması.
 *
 * Bu **son söz değildir.** Kesin doğrulama sunucuda, `createOrderSchema` ile
 * yapılır (`lib/orders/schema.ts`); burası yalnızca müşteriyi ağ turuna
 * göndermeden önce uyarır. İki tarafın kuralları bilinçli olarak aynıdır:
 * telefon kalıbı ve posta kodu kalıbı oradan birebir kopyalanmıştır. Ayrışırsa
 * müşteri sunucunun reddettiği bir formu "geçerli" görür.
 *
 * Saf fonksiyon: React'e, çeviriye ve tarayıcıya bağımlı değil — metinleri
 * çağıran taraf verir, testte doğrudan çalıştırılabilir.
 */

/** `guestCustomerSchema.phone` ile birebir aynı kalıp. */
const PHONE_PATTERN = /^[0-9\s()+-]{8,17}$/;
/** `deliveryAddressSchema.zip` ile birebir aynı kalıp. */
const ZIP_PATTERN = /^\d{5}$/;

export type CheckoutFormValues = {
  name: string;
  phone: string;
  email: string;
  street: string;
  houseNo: string;
  floor: string;
  bellName: string;
  note: string;
};

export type CheckoutFieldErrors = Partial<
  Record<keyof CheckoutFormValues | "zip" | "city", string>
>;

/** Doğrulama mesajları — çağıran taraf dile göre doldurur. */
export type CheckoutMessages = {
  name: string;
  phone: string;
  email: string;
  street: string;
  houseNo: string;
  zip: string;
  city: string;
};

export const EMPTY_CHECKOUT_FORM: CheckoutFormValues = {
  name: "",
  phone: "",
  email: "",
  street: "",
  houseNo: "",
  floor: "",
  bellName: "",
  note: "",
};

/**
 * Formu doğrular ve alan → mesaj eşlemesi döner. Boş nesne "geçerli" demektir.
 *
 * Kat/daire ve kapı zili ismi denetlenmez: ikisi de isteğe bağlıdır
 * (bkz. `deliveryAddressSchema`).
 */
export function validateCheckoutForm(input: {
  values: CheckoutFormValues;
  fulfillment: "DELIVERY" | "PICKUP";
  zip: string;
  city: string;
  messages: CheckoutMessages;
}): CheckoutFieldErrors {
  const { values, fulfillment, zip, city, messages } = input;
  const errors: CheckoutFieldErrors = {};

  if (values.name.trim().length < 2) errors.name = messages.name;
  if (!PHONE_PATTERN.test(values.phone.trim())) errors.phone = messages.phone;

  /*
   * E-posta isteğe bağlıdır (veri minimizasyonu, DSGVO Art. 5) ama YAZILDIYSA
   * doğru olmalı: yanlış yazılmış bir adres, sipariş onayının ve takip
   * bağlantısının hiçbir yere ulaşmaması demektir. Sunucu şeması da boş
   * dizeyi kabul edip dolu bir değeri `.email()` ile denetliyor.
   */
  const email = values.email.trim();
  if (email.length > 0 && !isPlausibleEmail(email)) errors.email = messages.email;

  if (fulfillment === "DELIVERY") {
    if (values.street.trim().length < 2) errors.street = messages.street;
    if (values.houseNo.trim().length < 1) errors.houseNo = messages.houseNo;
    if (!ZIP_PATTERN.test(zip)) errors.zip = messages.zip;
    if (city.trim().length < 2) errors.city = messages.city;
  }

  return errors;
}

/**
 * "Bu adres bir yere ulaşabilir mi" denetimi.
 *
 * Kasıtlı olarak gevşek: RFC 5322'yi tam uygulayan bir düzenli ifade,
 * geçerli ama sıra dışı adresleri (artı etiketi, uzun üst alan adı, tire)
 * reddettiği için yardımdan çok engel olur. Buradaki tek amaç yazım hatasını
 * yakalamak; adresin gerçekten var olup olmadığını ancak gönderilen posta
 * söyler.
 */
function isPlausibleEmail(value: string): boolean {
  if (value.length > 160) return false;
  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  if (domain.length < 3 || !domain.includes(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  return !/\s/.test(value);
}

/**
 * Formu `createOrderAction`'ın beklediği gövdeye çevirir.
 *
 * Gel-alda `address` **hiç gönderilmez**: sunucu şeması onu yalnızca kurye
 * siparişinde zorunlu tutuyor, boş bir nesne göndermek doğrulamayı gereksiz
 * yere düşürürdü.
 */
export function toCreateOrderInput(input: {
  lines: unknown[];
  lang: "tr" | "de";
  fulfillment: "DELIVERY" | "PICKUP";
  values: CheckoutFormValues;
  zip: string;
  city: string;
  /** Seçilen ödeme yöntemi; verilmezse online. */
  paymentMethod?: "ONLINE" | "CASH" | "CARD_ON_DELIVERY";
  /** Sunucunun onayladığı kupon kodu; kupon yoksa boş. */
  couponCode?: string;
  /** Sunucunun kelepçelediği bahşiş (cent). */
  tipCents?: number;
  /** İleri saatli siparişte seçilen saat (ISO); "en kısa sürede"de boş. */
  requestedAt?: string;
}) {
  const { lines, lang, fulfillment, values, zip, city } = input;

  return {
    lines,
    lang,
    fulfillment,
    paymentMethod: input.paymentMethod ?? "ONLINE",
    couponCode: input.couponCode ?? "",
    tipCents: input.tipCents ?? 0,
    /*
     * Boş dize hiç gönderilmez: sunucu şeması `requestedAt` alanını ISO tarih
     * olarak doğruluyor ve boş dize o doğrulamayı düşürürdü. "En kısa sürede"
     * demenin karşılığı, alanın hiç olmaması.
     */
    ...(input.requestedAt ? { requestedAt: input.requestedAt } : {}),
    customer: {
      name: values.name.trim(),
      phone: values.phone.trim(),
      email: values.email.trim(),
      note: values.note.trim(),
    },
    ...(fulfillment === "DELIVERY"
      ? {
          address: {
            street: values.street.trim(),
            houseNo: values.houseNo.trim(),
            floor: values.floor.trim(),
            bellName: values.bellName.trim(),
            zip,
            city: city.trim(),
          },
        }
      : {}),
  };
}
