import { z } from "zod";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password";

/**
 * Hesap uçlarının girdi doğrulaması.
 *
 * Sipariş şemasındaki telefon/adres kalıplarıyla **aynı** kurallar kullanılır;
 * hesaptaki adresle siparişteki adresin farklı kurallara tabi olması, kayıtlı
 * adresin sipariş anında reddedilmesi gibi anlamsız bir duruma yol açardı.
 */

/** E-posta her yerde küçük harfe indirgenir: "Ali@x.de" ile "ali@x.de" aynı hesap. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Bitte gültige E-Mail-Adresse angeben.")
  .max(160);

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`)
  .max(MAX_PASSWORD_LENGTH);

const phoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9\s()+-]{8,17}$/, "Bitte gültige Telefonnummer angeben.");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(2, "Bitte Namen angeben.").max(80),
  phone: phoneSchema,
  lang: z.enum(["tr", "de"]).default("de"),
  // Kayıt sırasında adres istenmez: kaydı ne kadar kısa tutarsak o kadar çok
  // kişi tamamlar. Adres ilk siparişte ya da profilde girilir.
  street: z.string().trim().max(120).optional().default(""),
  houseNo: z.string().trim().max(12).optional().default(""),
  zip: z
    .string()
    .trim()
    .regex(/^(\d{5})?$/, "Bitte gültige PLZ angeben.")
    .optional()
    .default(""),
  city: z.string().trim().max(80).optional().default(""),
});

export const loginSchema = z.object({
  email: emailSchema,
  // Girişte parola politikası uygulanmaz: eski/kısa bir parolayı reddedip
  // "parolanız kurallara uymuyor" demek, doğrulamadan önce bilgi sızdırır.
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

/**
 * Profil güncellemesi.
 *
 * Adres alanları **isteğe bağlıdır ve varsayılanları yoktur**: adres artık
 * adres defterinden (bkz. lib/account/addresses.ts) yönetiliyor ve profildeki
 * tekil alanlar varsayılan adresin kopyası. Alanlara boş dize varsayılanı
 * verilseydi, yalnızca telefonunu güncelleyen bir istek kayıtlı adresi
 * sessizce siler ve ödeme formu bir daha önden dolmazdı.
 */
export const profileSchema = z.object({
  name: z.string().trim().min(2, "Bitte Namen angeben.").max(80),
  phone: phoneSchema,
  street: z.string().trim().max(120).optional(),
  houseNo: z.string().trim().max(12).optional(),
  zip: z
    .string()
    .trim()
    .regex(/^(\d{5})?$/, "Bitte gültige PLZ angeben.")
    .optional(),
  city: z.string().trim().max(80).optional(),
  lang: z.enum(["tr", "de"]).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: passwordSchema,
});

/**
 * Hesap silme.
 *
 * Parola tekrar istenir. Oturumu ele geçirilmiş bir tarayıcı, tek tıkla
 * hesabı silememelidir; ayrıca kullanıcı için de kasıtlı bir eşiktir.
 */
export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  confirm: z.literal(true),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;

/**
 * Parola sıfırlama isteği.
 *
 * Yalnızca e-posta. Kullanıcının hesabı olup olmadığı **cevapta söylenmez**
 * (bkz. `app/api/account/password-reset/route.ts`); şema burada yalnızca
 * adresin biçimini kontrol eder.
 */
export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});

/**
 * Sıfırlamanın tamamlanması.
 *
 * Jeton bağlantıdan gelir; uzunluğu sınırlıdır çünkü doğrulama onu SHA-256'dan
 * geçirecek ve sınırsız uzunlukta bir girdi bedava CPU tüketimi olurdu.
 */
export const passwordResetConfirmSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: passwordSchema,
});
