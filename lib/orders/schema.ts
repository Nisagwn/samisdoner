import { z } from "zod";

/**
 * Sipariş girdisi doğrulaması (Zod).
 *
 * Kritik kural: burada **fiyat alanı yoktur**. İstemci yalnızca "hangi ürün,
 * hangi boy, kaç adet" der. Tutar her zaman sunucuda,
 * katalogtaki güncel fiyatlardan hesaplanır — istek gövdesi kurcalanarak
 * ucuza sipariş verilemez.
 */

const MAX_LINES = 60;
const MAX_QTY = 99;

const productLineSchema = z.object({
  kind: z.literal("product"),
  productId: z.string().min(1).max(120),
  variantSize: z.string().max(40).optional(),
  qty: z.number().int().min(1).max(MAX_QTY),
});

export const cartLineSchema = productLineSchema;

/**
 * Misafir müşteri bilgileri.
 *
 * Üyelik yok: yalnızca siparişin teslim edilebilmesi için gereken asgari alan
 * istenir (veri minimizasyonu, DSGVO Art. 5). E-posta **zorunlu değildir** —
 * müşteri vermezse Stripe Checkout'un topladığı adres webhook sırasında yazılır.
 */
export const guestCustomerSchema = z.object({
  name: z.string().trim().min(2, "Bitte Namen angeben.").max(80),
  // Mevcut sipariş ucundaki kalıpla aynı: rakam, boşluk, parantez, + ve -.
  phone: z
    .string()
    .trim()
    .regex(/^[0-9\s()+-]{8,17}$/, "Bitte gültige Telefonnummer angeben."),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  note: z.string().trim().max(200).optional().default(""),
});

/** Teslimat adresi — yalnızca kurye siparişinde istenir. */
export const deliveryAddressSchema = z.object({
  street: z.string().trim().min(2).max(120),
  houseNo: z.string().trim().min(1).max(12),
  /*
   * Kat/daire ve kapı zili ismi **isteğe bağlıdır**: müstakil evde ikisi de
   * anlamsız, çok katlı binada ikisi de siparişin teslim edilip edilmemesini
   * belirler. Zorunlu tutmak birinci grubu boş yere zorlar, hiç sormamak
   * ikinci grubun siparişini kurye elinde bırakır — bu yüzden sorulur ama
   * dayatılmaz. Teslimat bölgesi kararına girmezler.
   */
  floor: z.string().trim().max(40).optional().default(""),
  bellName: z.string().trim().max(80).optional().default(""),
  // Alman posta kodu: tam 5 rakam.
  zip: z.string().trim().regex(/^\d{5}$/, "Bitte gültige PLZ angeben."),
  city: z.string().trim().min(2).max(80),
});

export const createOrderSchema = z
  .object({
    lines: z.array(cartLineSchema).min(1, "Warenkorb ist leer.").max(MAX_LINES),
    fulfillment: z.enum(["DELIVERY", "PICKUP"]),
    lang: z.enum(["tr", "de"]).default("de"),
    customer: guestCustomerSchema,
    address: deliveryAddressSchema.optional(),
    /**
     * İleri saatli sipariş (Vorbestellung) için istenen teslim saati; boşsa
     * "en kısa sürede". Değerin gerçekten seçilebilir bir saat olduğu burada
     * **denetlenmez** — o karar çalışma saatlerini ve tatil günlerini bilen
     * `checkOrderability`'ye aittir. Burada yalnızca biçim doğrulanır.
     */
    requestedAt: z.string().datetime().optional(),
    /**
     * Ödeme yöntemi. Varsayılan ONLINE: alan hiç gönderilmeyen eski istemci
     * de çalışmaya devam etsin.
     *
     * Yöntemin gerçekten açık olup olmadığı (kapıda ödeme anahtarı, gel-al /
     * teslimat ayrımı) sunucuda ayrıca denetlenir; burada yalnızca tanınan bir
     * değer olduğu doğrulanır.
     */
    paymentMethod: z.enum(["ONLINE", "CASH", "CARD_ON_DELIVERY"]).default("ONLINE"),
    /** Gutscheincode. Boş dize "kupon yok" demektir. */
    couponCode: z.string().trim().max(40).optional().default(""),
    /**
     * Bahşiş (cent).
     *
     * Üst sınır burada dar tutulmaz: asıl kelepçe `clampTip` içinde ve sepete
     * bağlı (bkz. lib/orders/tip.ts). Buradaki sınır yalnızca saçma bir sayının
     * hesaba hiç girmemesi için.
     */
    tipCents: z.number().int().min(0).max(100_000).optional().default(0),
  })
  // Kurye siparişinde adres zorunludur; gel-alda hiç sorulmaz.
  .refine((value) => value.fulfillment !== "DELIVERY" || value.address !== undefined, {
    message: "Lieferadresse fehlt.",
    path: ["address"],
  });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type GuestCustomer = z.infer<typeof guestCustomerSchema>;
export type DeliveryAddress = z.infer<typeof deliveryAddressSchema>;

/* ═══════════════════════════════════════════════ panel: kampanya girdisi */

/** Ürüne bağlı kampanyanın bir kalemi (ayın ürünü, menü fiyatı). */
const campaignItemSchema = z.object({
  productId: z.string().trim().min(1, "Kampanyadaki her satırda bir ürün seçin.").max(120),
  /** Boş = ürünün bütün boyları. */
  variantSize: z.string().trim().max(40).optional().default(""),
  /** Menü fiyatında setteki adet; ürüne özel fiyatta okunmaz. */
  qty: z.number().int().min(1).max(20).default(1),
});

/**
 * Kampanya oluşturma/düzenleme gövdesi.
 *
 * Panel kullanıcısına da güvenilmez: yanlış girilmiş bir kampanya burada
 * durdurulmazsa her siparişte para kaybettirir ve fark edilmesi günler sürer.
 * Doğrulama bu yüzden dar:
 *
 *  - Kod boş olabilir (otomatik kampanya); doluysa yalnızca harf ve rakam, en
 *    az 3 karakter. Boşluk, tire ve noktalama telefonda yanlış yazılır.
 *  - Otomatik kampanyanın adı olmalı: menüde ve sepette adsız bir indirim
 *    satırı müşteriye bir şey anlatmaz.
 *  - Yüzde 1–100 arasında; sabit indirim 1 cent – 500 €. Üst sınır bir yazım
 *    hatasının (250 yerine 25000) tüm sepeti bedavaya getirmesini engeller.
 *  - Ürüne özel fiyatta en az bir ürün, menü fiyatında en az iki adet.
 *  - Tarihler verilmişse başlangıç bitişten önce olmalı.
 *
 * Tutarlar **cent** olarak gelir: panelin geri kalanında da öyle
 * (bkz. lib/orders/zones.ts), Euro'ya çevrim arayüzde bir kez yapılır.
 *
 * Düzenleme de aynı şemayla doğrulanır: panel formu her zaman bütün alanları
 * gönderiyor ve alanların anlamı türe bağlı — tür değişip değer gelmeyen bir
 * kısmi güncelleme "%650 indirim" gibi bir kayıt bırakabilirdi.
 */
export const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .max(40, "Kod en fazla 40 karakter olabilir.")
      .regex(/^[A-Za-z0-9]*$/, "Kod yalnızca harf ve rakam içerebilir.")
      .default(""),
    kind: z.enum(["PERCENT", "FIXED", "PRODUCT_PRICE", "BUNDLE_PRICE"]),
    title: z.string().trim().max(80, "Kampanya adı en fazla 80 karakter olabilir.").default(""),
    titleTr: z.string().trim().max(80, "Kampanya adı en fazla 80 karakter olabilir.").default(""),
    value: z.number().int().min(0, "Değer negatif olamaz."),
    items: z.array(campaignItemSchema).max(12, "Bir kampanyada en fazla 12 ürün satırı olabilir.").default([]),
    minOrderCents: z.number().int().min(0).max(1_000_00).default(0),
    /** Yalnızca yüzde indiriminde anlamlı; 0 = tavan yok. */
    maxDiscountCents: z.number().int().min(0).max(500_00).default(0),
    /** null = her iki teslim biçiminde geçerli. */
    fulfillment: z.enum(["DELIVERY", "PICKUP"]).nullable().default(null),
    startsAt: z.string().datetime().nullable().default(null),
    expiresAt: z.string().datetime().nullable().default(null),
    /** 0 = sınırsız. */
    maxRedemptions: z.number().int().min(0).max(100_000).default(0),
    active: z.boolean().default(true),
  })
  .refine((value) => value.code === "" || value.code.length >= 3, {
    message: "Kod en az 3 karakter olmalı.",
    path: ["code"],
  })
  .refine((value) => value.code !== "" || value.title !== "" || value.titleTr !== "", {
    message: "Otomatik kampanyanın müşteriye görünecek bir adı olmalı.",
    path: ["title"],
  })
  .refine((value) => value.kind !== "PERCENT" || (value.value >= 1 && value.value <= 100), {
    message: "Yüzde indirimi 1 ile 100 arasında olmalı.",
    path: ["value"],
  })
  .refine((value) => value.kind !== "FIXED" || (value.value >= 1 && value.value <= 500_00), {
    message: "Sabit indirim 0,01 € ile 500 € arasında olmalı.",
    path: ["value"],
  })
  .refine(
    (value) =>
      (value.kind !== "PRODUCT_PRICE" && value.kind !== "BUNDLE_PRICE") || value.value <= 500_00,
    { message: "Kampanya fiyatı en fazla 500 € olabilir.", path: ["value"] }
  )
  .refine((value) => value.kind !== "PRODUCT_PRICE" || value.items.length >= 1, {
    message: "Kampanya fiyatının geçeceği en az bir ürün seçin.",
    path: ["items"],
  })
  .refine(
    (value) =>
      value.kind !== "BUNDLE_PRICE" || value.items.reduce((sum, item) => sum + item.qty, 0) >= 2,
    { message: "Menü fiyatı için en az iki ürün (ya da aynı üründen iki adet) seçin.", path: ["items"] }
  )
  .refine(
    (value) =>
      !value.startsAt || !value.expiresAt || Date.parse(value.startsAt) < Date.parse(value.expiresAt),
    { message: "Başlangıç tarihi bitiş tarihinden önce olmalı.", path: ["expiresAt"] }
  );

export type CouponBody = z.infer<typeof couponSchema>;
