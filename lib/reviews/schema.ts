import { z } from "zod";
import { MAX_RATING, MIN_RATING } from "./eligibility";

/**
 * Değerlendirme uçlarının girdi doğrulaması.
 *
 * Puanlar `coerce` ile alınmaz: gelen `"5"` değeri sessizce sayıya çevrilseydi
 * `"5abc"` gibi bir girdinin hangi yolda nasıl davranacağı arayüzden
 * okunamazdı. İstemci sayı gönderir, uç sayı bekler.
 */

const rating = z
  .number()
  .int()
  .min(MIN_RATING, "Bitte eine Bewertung zwischen 1 und 5 Sternen wählen.")
  .max(MAX_RATING, "Bitte eine Bewertung zwischen 1 und 5 Sternen wählen.");

export const reviewSubmitSchema = z.object({
  /** Hangi sipariş değerlendiriliyor. Sahiplik uçta ayrıca doğrulanır. */
  orderNo: z.string().trim().min(3).max(40),
  foodRating: rating,
  /**
   * Teslimat puanı. Gel-al siparişte gönderilmez; gönderilirse uç onu
   * **yok sayar** (bkz. app/api/account/reviews/route.ts) — istemcinin
   * gönderdiği bir alan, olmayan bir teslimatı var edemez.
   */
  deliveryRating: rating.nullish(),
  /**
   * Serbest metin. Üst sınır 800: bundan uzun bir yorum artık yorum değil,
   * şikâyet dilekçesidir ve yeri e-posta. Alt sınır yok — yıldız tek başına
   * geçerli bir değerlendirmedir.
   */
  comment: z.string().trim().max(800).default(""),
});

export type ReviewSubmitInput = z.infer<typeof reviewSubmitSchema>;

/**
 * İşletmenin cevabı.
 *
 * Boş dize kabul edilir ve **cevabı siler**: yanlış yazılmış bir cevabı geri
 * almanın başka yolu olmamalı diye ayrı bir uç açmanın anlamı yok.
 */
export const reviewReplySchema = z.object({
  reply: z.string().trim().max(800),
});

/**
 * Yorumu gizleme/yayına alma.
 *
 * Gizlerken sebep zorunludur. Zorunlu olmasaydı her rahatsız edici yorum
 * sebepsizce gizlenir ve "kötü yorumlar siliniyor" şüphesi doğrulanırdı;
 * yazılan sebep, kararı sonradan savunulabilir kılan tek şey.
 */
export const reviewVisibilitySchema = z
  .object({
    published: z.boolean(),
    hiddenReason: z.string().trim().max(200).default(""),
  })
  .refine((value) => value.published || value.hiddenReason.length >= 3, {
    message: "Yorumu gizlemek için sebep yazılmalı.",
    path: ["hiddenReason"],
  });
