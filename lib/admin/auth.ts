/**
 * Admin oturumu.
 *
 * Panele giriş uzun süre tek bir şeye dayanıyordu: `.env` içindeki
 * `ADMIN_PASSWORD`. Bir dönerci için bunun iki bedeli vardı ve ikisi de
 * yazılım değil işletme sorunu:
 *
 *  - **Kim yaptı?** Siparişi kimin iptal ettiği, ödemeyi kimin iade ettiği
 *    hiçbir yerde yazmıyordu; her olayın faili "admin" idi.
 *  - **Nasıl keserim?** İşten ayrılan bir çalışanın erişimini kesmek, kalan
 *    herkesin parolasını değiştirmek demekti — yani pratikte hiç yapılmadı.
 *
 * Artık oturum bir **kişiyi** taşıyor: kimlik, rol ve oturum sürümü. Ortak
 * parola kaldırılmadı ama görevi değişti — `AdminUser` tablosunda hiç kullanıcı
 * yokken ilk girişin bir yerden yapılması gerekir. O parolayla girenin rolü
 * OWNER'dır ve kimliği `env`'dir; ilk iş kendi kullanıcısını açmaktır.
 *
 * Jeton biçimi: "<kullanıcıId>.<rol>.<oturumSürümü>.<sonaErme>.<HMAC>"
 *
 * Sunucuda oturum tablosu tutulmuyor (durum yok, ölçeklenir). Bedeli, verilmiş
 * bir jetonu tek tek iptal edememektir; `tokenVersion` bunu çözer — parola ya
 * da rol değişince `AdminUser.tokenVersion` artar ve o kişinin bütün açık
 * oturumları bir anda düşer. Rol değişiminde artması ayrıca şart: aksi hâlde
 * STAFF'a indirilmiş biri, elindeki jeton OWNER yazdığı için sekiz saat daha
 * OWNER kalırdı.
 *
 * Bu dosyada veritabanı **yoktur** ve olmamalıdır: Edge middleware'i de bunu
 * çağırıyor. Jetonun `tokenVersion`'ının gerçekten güncel olup olmadığı
 * kaydı okuyan tarafta (lib/admin/guard.ts) doğrulanır.
 */

import type { AdminRole } from "@prisma/client";

export const SESSION_COOKIE = "samis_admin_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 saat

/** Ortak parolayla giren kullanıcının kimliği. Tabloda karşılığı yoktur. */
export const ENV_OWNER_ID = "env";

function secret(): string {
  const value = process.env.ADMIN_SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error(
      "ADMIN_SESSION_SECRET tanımlı değil veya çok kısa (en az 16 karakter). .env.local dosyasına ekleyin."
    );
  }
  return value;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64url(mac);
}

/** Uzunluk sızdırmayan, erken çıkışsız karşılaştırma. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type AdminSession = {
  /** `AdminUser.id`, ya da ortak parolayla girildiyse `ENV_OWNER_ID`. */
  userId: string;
  role: AdminRole;
  tokenVersion: number;
};

const ROLES: AdminRole[] = ["OWNER", "MANAGER", "STAFF"];

function isRole(value: string): value is AdminRole {
  return (ROLES as string[]).includes(value);
}

/** Süresi `SESSION_TTL_MS` sonra dolan imzalı oturum jetonu üretir. */
export async function createSessionToken(session: AdminSession): Promise<string> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${session.userId}.${session.role}.${session.tokenVersion}.${expiresAt}`;
  return `${payload}.${await sign(payload)}`;
}

/**
 * Jetonun imzasını ve süresini doğrular, içeriğini döner.
 *
 * `tokenVersion`'ın veritabanındakiyle eşleşip eşleşmediğine **burada
 * bakılmaz** — bu saf, veritabanısız bir işlevdir ve Edge middleware'inde de
 * çalışır. Sürüm kontrolü kaydı okuyan `getAdminSession` içinde yapılır.
 */
export async function readSessionToken(
  token: string | undefined
): Promise<AdminSession | null> {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 5) return null;

  const [userId, roleRaw, versionRaw, expiresRaw, signature] = parts;
  if (!userId || !isRole(roleRaw)) return null;

  const tokenVersion = Number(versionRaw);
  const expiresAt = Number(expiresRaw);
  if (!Number.isInteger(tokenVersion) || tokenVersion < 0) return null;
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;

  try {
    const expected = await sign(`${userId}.${roleRaw}.${versionRaw}.${expiresRaw}`);
    return safeEqual(signature, expected)
      ? { userId, role: roleRaw, tokenVersion }
      : null;
  } catch {
    return null;
  }
}

/**
 * Yalnızca "geçerli bir oturum var mı" sorusu — middleware için.
 *
 * Middleware bir **yönlendiricidir**, yetkilendirici değil: hangi rolün hangi
 * sayfayı görebileceği kararı route handler'larda ve sayfalarda verilir
 * (bkz. lib/admin/guard.ts). Burada rol kontrolü yapmak, yetkinin tek
 * kaynağının bir `matcher` deseni olması demekti.
 */
export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  return (await readSessionToken(token)) !== null;
}

/**
 * Girilen parolayı `ADMIN_PASSWORD` ile sabit zamanlı karşılaştırır.
 *
 * Yalnızca kurtarma yolu için: tabloda kullanıcı varken de çalışır, çünkü
 * kilitlenen bir işletmecinin panele girmesinin başka yolu yoktur. Parolanın
 * `.env` dışına çıkmaması bu yüzden önemli.
 */
export async function verifyEnvPassword(input: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;

  // Farklı uzunlukların erken dönmemesi için önce iki tarafın da özetini al.
  const digest = async (value: string) =>
    base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

  return safeEqual(await digest(input), await digest(expected));
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export const SESSION_MAX_AGE = SESSION_TTL_MS / 1000;
