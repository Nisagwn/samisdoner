import { prisma } from "@/lib/db";

/**
 * E-posta doğrulama jetonları.
 *
 * `Customer.emailVerifiedAt` sütunu şemada baştan beri vardı ve hiçbir zaman
 * dolmuyordu: doğrulama akışı hiç yazılmamıştı. Bunun bedeli parola
 * sıfırlamada ortaya çıkıyor — sıfırlama bağlantısı, doğruluğu hiç
 * kanıtlanmamış bir adrese gidiyordu. Yazım hatasıyla girilmiş bir adres
 * (ya da kasten girilmiş başkasının adresi) hesabın kurtarılmasını imkânsız
 * kılar, kötü ihtimalde başkasının eline verir.
 *
 * Kalıp `passwordReset.ts` ile birebir aynı ve bilerek öyle:
 *
 *  1. **Jeton düz saklanmaz**, yalnızca SHA-256 özeti. Tabloya erişen biri
 *     kimsenin adresini doğrulayamaz.
 *  2. **Bir jeton bir kez.** `usedAt` işaretlendikten sonra aynı bağlantı
 *     çalışmaz.
 *
 * Bir fark var: jeton, doğrulanacak **adresi de taşır**. Kullanıcı bağlantıyı
 * aldıktan sonra e-postasını değiştirirse, eski adrese giden bağlantı yeni
 * adresi doğrulamamalı — yoksa "adresimi değiştir, eski adresteki bağlantıya
 * tıkla" ile hiç erişimi olmayan bir adres doğrulanmış sayılırdı.
 */

/**
 * Bir hafta.
 *
 * Parola sıfırlamada bir saat, burada bir hafta — ikisinin tehdit modeli
 * farklı. Sıfırlama bağlantısı hesabı ele geçirir ve çalınan bir gelen
 * kutusunda uzun süre beklememelidir; doğrulama bağlantısı ise yalnızca
 * "bu adres sana ait" der ve aciliyeti yoktur. Bir saatlik bir doğrulama
 * bağlantısı, akşam siparişi verip sabah e-postasına bakan kullanıcının
 * hiçbir zaman tıklayamayacağı bir bağlantı olurdu.
 */
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashVerificationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Doğrulama jetonu açar ve düz hâlini döner.
 *
 * Aynı hesabın bekleyen eski jetonları iptal edilir: "tekrar gönder"e üç kez
 * basan kullanıcının elinde üç çalışan bağlantı olmamalı.
 */
export async function createEmailVerificationToken(
  customerId: string,
  email: string
): Promise<string> {
  const token = newToken();

  await prisma.$transaction([
    prisma.emailVerification.updateMany({
      where: { customerId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.emailVerification.create({
      data: {
        customerId,
        email: email.toLowerCase(),
        tokenHash: await hashVerificationToken(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    }),
  ]);

  return token;
}

export type VerifyOutcome =
  | { ok: true; alreadyVerified: boolean }
  | { ok: false; reason: "invalid" | "expired" | "used" | "email_changed" };

/**
 * Jetonu doğrular ve adresi onaylanmış olarak işaretler.
 *
 * Doğrulama ile kullanım tek işlemde: iki eşzamanlı istek aynı jetonu iki kez
 * tüketemesin diye `usedAt: null` koşulu güncellemenin kendi `where`'ine
 * konur.
 *
 * `tokenVersion` **artırılmaz**: parola sıfırlamanın aksine burada bir ele
 * geçirme şüphesi yok ve kullanıcının açık oturumlarını düşürmek, e-postasını
 * doğruladığı için cezalandırmak olurdu.
 */
export async function consumeEmailVerificationToken(
  token: string
): Promise<VerifyOutcome> {
  const record = await prisma.emailVerification.findUnique({
    where: { tokenHash: await hashVerificationToken(token) },
    select: { id: true, customerId: true, email: true, expiresAt: true, usedAt: true },
  });

  if (!record) return { ok: false, reason: "invalid" };
  if (record.usedAt) return { ok: false, reason: "used" };
  if (record.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  const customer = await prisma.customer.findUnique({
    where: { id: record.customerId },
    select: { email: true, emailVerifiedAt: true },
  });
  if (!customer) return { ok: false, reason: "invalid" };

  // Bağlantı gönderildikten sonra adres değiştiyse bu jeton artık geçersiz.
  if (customer.email.toLowerCase() !== record.email) {
    return { ok: false, reason: "email_changed" };
  }

  const alreadyVerified = customer.emailVerifiedAt !== null;

  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.emailVerification.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) throw new Error("token_already_used");

      await tx.customer.update({
        where: { id: record.customerId },
        data: { emailVerifiedAt: new Date() },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "token_already_used") {
      return { ok: false, reason: "used" };
    }
    throw error;
  }

  return { ok: true, alreadyVerified };
}
