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
    /** ISO tarih; boşsa "en kısa sürede". */
    requestedAt: z.string().datetime().optional(),
  })
  // Kurye siparişinde adres zorunludur; gel-alda hiç sorulmaz.
  .refine((value) => value.fulfillment !== "DELIVERY" || value.address !== undefined, {
    message: "Lieferadresse fehlt.",
    path: ["address"],
  });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type GuestCustomer = z.infer<typeof guestCustomerSchema>;
export type DeliveryAddress = z.infer<typeof deliveryAddressSchema>;
