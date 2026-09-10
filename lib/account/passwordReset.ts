import { prisma } from "@/lib/db";
import { hashPassword } from "./password";

/**
 * Parola sıfırlama jetonları.
 *
 * `PasswordReset` tablosu şemada baştan doğru tasarlanmıştı ama yalnızca hesap
 * silinirken temizlemek için kullanılıyordu — sıfırlama akışının kendisi hiç
 * yazılmamıştı. Parolasını unutan müşterinin yapabileceği hiçbir şey yoktu.
 *
 * İki kural bu dosyanın tamamını belirliyor:
 *
 *  1. **Jeton düz saklanmaz.** Veritabanı sızarsa saklanan özetlerden jeton
 *     üretilemez; tabloya erişen biri kimsenin hesabını ele geçiremez. Bu
 *     yüzden `tokenHash` sütunu var ve `@unique` — arama da özet üzerinden
 *     yapılır.
 *
 *  2. **Bir jeton bir kez.** `usedAt` işaretlendikten sonra aynı bağlantı
 *     çalışmaz. Sıfırlama maili müşterinin gelen kutusunda kalıcıdır; tek
 *     kullanım olmasaydı o kutuya sonradan erişen biri hesabı ele geçirirdi.
 *
 * Jeton SHA-256 ile özetlenir (parolalar gibi PBKDF2 ile değil) ve bu doğrudur:
 * yavaş özet, tahmin edilebilir düşük entropili girdileri korur. Buradaki jeton
 * 256 bit rastgeledir — kaba kuvvetle bulunamaz, yavaşlatmanın koruyacağı bir
 * şey yoktur. Yavaş olsaydı yalnızca sunucuyu yavaşlatırdı.
 */

/** Bir saat: e-postayı görüp tıklamak için fazlasıyla yeter, çalınan bir kutuda uzun süre beklemez. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/** Jeton üretimi — 32 bayt (256 bit) rastgele, base64url. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Sıfırlama jetonu açar ve düz hâlini döner.
 *
 * Düz jeton **yalnızca burada** ve maili yazan kodda görülür; hiçbir yere
 * kaydedilmez. Çağıran onu bağlantıya koyar ve unutur.
 *
 * Aynı hesabın bekleyen eski jetonları iptal edilir: "sıfırla" düğmesine üç
 * kez basan kullanıcının elinde üç çalışan bağlantı olmamalı, sonuncusu
 * geçerli olmalı.
 */
export async function createPasswordResetToken(customerId: string): Promise<string> {
  const token = newToken();

  await prisma.$transaction([
    prisma.passwordReset.updateMany({
      where: { customerId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordReset.create({
      data: {
        customerId,
        tokenHash: await hashToken(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    }),
  ]);

  return token;
}

export type ResetOutcome = { ok: true } | { ok: false; reason: "invalid" | "expired" | "used" };

/**
 * Jetonu doğrular ve parolayı değiştirir.
 *
 * `tokenVersion` artırılır: sıfırlama, hesabın ele geçirildiği şüphesiyle de
 * yapılır ve o durumda saldırganın açık oturumları **düşmelidir**. Parola
 * değiştirme ucundan farkı, burada kullanıcının kendi oturumunun da düşmesi —
 * zaten oturumu yok, giriş ekranına gidecek.
 *
 * Doğrulama ile kullanım tek işlemde: iki eşzamanlı istek aynı jetonla iki
 * kez parola değiştiremesin diye `usedAt: null` koşulu güncellemenin kendi
 * `where`'ine konur.
 */
export async function consumePasswordResetToken(
  token: string,
  newPassword: string
): Promise<ResetOutcome> {
  const record = await prisma.passwordReset.findUnique({
    where: { tokenHash: await hashToken(token) },
    select: { id: true, customerId: true, expiresAt: true, usedAt: true },
  });

  if (!record) return { ok: false, reason: "invalid" };
  if (record.usedAt) return { ok: false, reason: "used" };
  if (record.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  const passwordHash = await hashPassword(newPassword);

  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordReset.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      // Yarışı kaybettik: başka bir istek jetonu bizden önce tüketti.
      if (claimed.count === 0) throw new Error("token_already_used");

      await tx.customer.update({
        where: { id: record.customerId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "token_already_used") {
      return { ok: false, reason: "used" };
    }
    throw error;
  }

  return { ok: true };
}
