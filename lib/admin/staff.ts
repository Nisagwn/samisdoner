import { Prisma, type AdminRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/account/password";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/account/password";

/**
 * Panel kullanıcıları.
 *
 * Parola özeti müşteri tarafıyla **aynı** koddan geçer (PBKDF2-HMAC-SHA256,
 * 600.000 yineleme — bkz. lib/account/password.ts). Panele özel ikinci bir
 * parola şeması yazmanın hiçbir faydası yok; zararı ise iki ayrı yerde
 * bakılması gereken, biri er geç geride kalan iki kripto uygulaması olurdu.
 *
 * Üç kural burada uygulanır ve üçü de aynı soruya cevap veriyor — "panel
 * kilitlenebilir mi?":
 *
 *  1. **Son OWNER silinemez ve rolü düşürülemez.** Aksi hâlde kimsenin
 *     personel ekleyemediği bir panel kalır. Kontrol veritabanı işleminin
 *     içinde: iki sekmeden aynı anda yapılan iki "rolü düşür" isteği, ayrı
 *     ayrı bakan bir kontrolü yarışla geçebilirdi.
 *  2. **Kimse kendini kapatamaz.** Yanlışlıkla yapılması çok kolay ve
 *     geri alması — kendi oturumu düştüğü için — imkânsız.
 *  3. **Parola ya da rol değişince o kullanıcının oturumları düşer.**
 *     `tokenVersion` artar; elindeki jeton ne yazıyor olursa olsun geçersizdir.
 */

export const staffCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin.").max(160),
  name: z.string().trim().max(80).default(""),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Parola en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`)
    .max(MAX_PASSWORD_LENGTH),
  role: z.enum(["OWNER", "MANAGER", "STAFF"]),
});

export const staffUpdateSchema = z.object({
  name: z.string().trim().max(80).optional(),
  role: z.enum(["OWNER", "MANAGER", "STAFF"]).optional(),
  active: z.boolean().optional(),
  /** Boş bırakılırsa parola değişmez; yazılırsa oturumlar düşer. */
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Parola en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`)
    .max(MAX_PASSWORD_LENGTH)
    .optional(),
});

export type StaffRecord = {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

const selection = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  createdAt: true,
  lastLoginAt: true,
} as const;

function toRecord(row: {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  active: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}): StaffRecord {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  };
}

export async function listStaff(): Promise<StaffRecord[]> {
  const rows = await prisma.adminUser.findMany({
    // Aktifler önce, sonra en yeni: kapatılmış hesaplar listenin dibinde
    // durur ama kaybolmaz — "bu kişi hâlâ girebiliyor mu" sorusu sorulur.
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    select: selection,
  });
  return rows.map(toRecord);
}

export async function countOwners(): Promise<number> {
  return prisma.adminUser.count({ where: { role: "OWNER", active: true } });
}

export type StaffResult =
  | { ok: true; staff: StaffRecord }
  | { ok: false; reason: "email_taken" | "not_found" | "last_owner" | "self" };

export async function createStaff(
  input: z.infer<typeof staffCreateSchema>
): Promise<StaffResult> {
  const passwordHash = await hashPassword(input.password);

  try {
    const row = await prisma.adminUser.create({
      data: {
        email: input.email,
        name: input.name,
        role: input.role,
        passwordHash,
      },
      select: selection,
    });
    return { ok: true, staff: toRecord(row) };
  } catch (error) {
    // Benzersizlik kontrolü veritabanına bırakılır: "önce bak, sonra yaz"
    // iki eşzamanlı istekte yarışır, UNIQUE kısıt yarışamaz.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, reason: "email_taken" };
    }
    throw error;
  }
}

export async function updateStaff(
  id: string,
  input: z.infer<typeof staffUpdateSchema>,
  actorId: string
): Promise<StaffResult> {
  // Kendi hesabını kapatmak ya da kendi rolünü düşürmek: yapılması kolay,
  // geri alınması imkânsız. Engel burada, çünkü kural veriye ait.
  if (id === actorId && (input.active === false || input.role !== undefined)) {
    return { ok: false, reason: "self" };
  }

  const passwordHash = input.password ? await hashPassword(input.password) : undefined;

  try {
    const row = await prisma.$transaction(async (tx) => {
      const current = await tx.adminUser.findUnique({
        where: { id },
        select: { id: true, role: true, active: true },
      });
      if (!current) throw new StaffError("not_found");

      /*
       * Son sahibi kaybetmeyi engelle.
       *
       * Sayım işlemin İÇİNDE: dışarıda yapılsaydı, iki sekmeden aynı anda
       * gönderilen iki "rolü düşür" isteğinin ikisi de "iki sahip var"
       * görüp ikisini birden düşürebilirdi.
       */
      const losingOwner =
        current.role === "OWNER" &&
        current.active &&
        ((input.role !== undefined && input.role !== "OWNER") || input.active === false);

      if (losingOwner) {
        const owners = await tx.adminUser.count({ where: { role: "OWNER", active: true } });
        if (owners <= 1) throw new StaffError("last_owner");
      }

      // Rol ya da parola değiştiyse o kullanıcının açık oturumları düşmeli.
      const invalidate = passwordHash !== undefined || input.role !== undefined;

      return tx.adminUser.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(passwordHash ? { passwordHash } : {}),
          ...(invalidate ? { tokenVersion: { increment: 1 } } : {}),
        },
        select: selection,
      });
    });

    return { ok: true, staff: toRecord(row) };
  } catch (error) {
    if (error instanceof StaffError) return { ok: false, reason: error.reason };
    throw error;
  }
}

/**
 * Hesabı kapatır — **silmez**.
 *
 * Silmek, o kullanıcının yaptığı işlemlerin failini kayıtta boşa düşürürdü:
 * sipariş geçmişindeki "kim iptal etti" sorusunun cevabı bir e-posta adresi
 * ve o adresin kime ait olduğu ancak burada duruyorsa bilinir. Kapatılan
 * hesap giriş yapamaz, listede gri durur ve gerekirse geri açılır.
 */
export async function deactivateStaff(id: string, actorId: string): Promise<StaffResult> {
  return updateStaff(id, { active: false }, actorId);
}

class StaffError extends Error {
  constructor(readonly reason: "not_found" | "last_owner") {
    super(reason);
  }
}

/* ------------------------------------------------------------------ giriş */

export type StaffLogin = {
  id: string;
  role: AdminRole;
  tokenVersion: number;
  email: string;
};

/**
 * E-posta + parola doğrulaması.
 *
 * Hesap bulunamasa bile parola doğrulaması **yine de çalıştırılır**: aksi
 * hâlde var olmayan bir e-posta anında, var olan bir e-posta ~300 ms sonra
 * yanıt dönerdi ve bu zamanlama farkı, hangi adreslerin panele kayıtlı
 * olduğunu saymaya yeter. Müşteri girişindeki kalıbın aynısı.
 */
const DUMMY_HASH =
  "pbkdf2$sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function authenticateStaff(
  email: string,
  password: string
): Promise<StaffLogin | null> {
  const user = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });

  const matches = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !matches || !user.active) return null;

  // Parola maliyeti artırıldıysa, elimizde düz parola varken sessizce yükselt.
  const passwordHash = needsRehash(user.passwordHash)
    ? await hashPassword(password)
    : undefined;

  const updated = await prisma.adminUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), ...(passwordHash ? { passwordHash } : {}) },
    select: { id: true, role: true, tokenVersion: true, email: true },
  });

  return updated;
}
