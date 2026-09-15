import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ENV_OWNER_ID, SESSION_COOKIE, readSessionToken, type AdminSession } from "./auth";
import { can, type AdminPermission } from "./roles";
import { Prisma } from "@prisma/client";

/**
 * Route handler'lar için ikinci savunma hattı.
 *
 * Middleware'e güvenilmez: yetki her yazma ucunda burada yeniden doğrulanır.
 * Middleware yalnızca gezinmeyi yönlendirir — matcher'daki bir yazım hatası
 * tüm panel uçlarını açık bırakabilirdi.
 */

/**
 * Oturumdaki panel kullanıcısı, yoksa null.
 *
 * İmza geçerli olsa bile kayıt tekrar okunur ve üç şey kontrol edilir: hesap
 * hâlâ var mı, aktif mi, jetonun `tokenVersion`'ı güncel mi. Sonuncusu
 * parola/rol değişiminden sonra eski jetonların ölmesini sağlar — imza tek
 * başına bunu bilemez, çünkü imzalandığı an geçerliydi.
 *
 * Ortak parolayla açılan oturumun tabloda karşılığı yoktur; o jeton
 * doğrudan kabul edilir (bkz. lib/admin/auth.ts).
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const session = await readSessionToken(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return null;
  if (session.userId === ENV_OWNER_ID) return session;

  const user = await prisma.adminUser.findUnique({
    where: { id: session.userId },
    select: { active: true, role: true, tokenVersion: true },
  });
  if (!user || !user.active) return null;
  if (user.tokenVersion !== session.tokenVersion) return null;

  // Rol jetondan değil **kayıttan** okunur: ikisi ayrıştığında doğru olan
  // kayıttır ve jetonun yalanı sekiz saat yaşamamalı.
  return { ...session, role: user.role };
}

/** Yetkisizse hazır 401 yanıtı döner, yetkiliyse null döner. */
export async function requireAdmin(): Promise<NextResponse | null> {
  if (await getAdminSession()) return null;
  return NextResponse.json(
    { error: "Bu işlem için admin oturumu gerekli." },
    { status: 401 }
  );
}

/**
 * Belirli bir izni şart koşar.
 *
 * Oturum varsa ama izin yoksa 401 değil **403** döner: ikisini aynı kodla
 * karşılamak, yetkisi olmayan bir personeli giriş ekranına atar ve o kişi
 * parolasının bozulduğunu sanır. 403, "girişin doğru ama bu senin işin değil"
 * demenin tek doğru yolu.
 *
 * Dönen değer `NextResponse` değilse oturumun kendisidir; çağıran taraf
 * `instanceof` ile iki durumu güvenle ayırır ve olayın failini (`session.userId`)
 * kayda yazabilir.
 */
export async function requirePermission(
  permission: AdminPermission
): Promise<AdminSession | NextResponse> {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json(
      { error: "Bu işlem için admin oturumu gerekli." },
      { status: 401 }
    );
  }
  if (!can(session.role, permission)) {
    return NextResponse.json(
      { error: "Bu işlem için yetkiniz yok. Yöneticinizle görüşün." },
      { status: 403 }
    );
  }
  return session;
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = "Kayıt bulunamadı.") {
  return NextResponse.json({ error: message }, { status: 404 });
}

/**
 * Katalog yazma çağrılarını sarar.
 *
 * Veri katmanı artık PostgreSQL: beklenen tek "geçici" arıza veritabanına
 * ulaşılamamasıdır. O durumda isteği ham 500 ile düşürmek yerine, arayüzün
 * gösterebileceği açıklayıcı bir 503 döneriz. Benzersizlik ihlali gibi
 * kullanıcı hatasından doğan durumlar 409 ile ayrılır; beklenmedik hatalar
 * olduğu gibi yukarı fırlatılır.
 *
 * `T` hiçbir zaman `NextResponse` olmadığı için çağıran taraf `instanceof` ile
 * iki durumu güvenle ayırabilir.
 */
export async function storeWrite<T>(fn: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await fn();
  } catch (error) {
    // Veritabanına hiç bağlanılamadı (yanlış DATABASE_URL, kapalı sunucu…).
    if (error instanceof Prisma.PrismaClientInitializationError) {
      return NextResponse.json(
        { error: "Veritabanına ulaşılamıyor. Değişiklik kaydedilmedi." },
        { status: 503 }
      );
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P1001/P1002: sunucu erişilemez veya zaman aşımı — geçici arıza.
      if (error.code === "P1001" || error.code === "P1002") {
        return NextResponse.json(
          { error: "Veritabanına ulaşılamıyor. Değişiklik kaydedilmedi." },
          { status: 503 }
        );
      }
      // P2002: benzersizlik ihlali — aynı kimlikte kayıt zaten var.
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "Bu kayıt zaten var." },
          { status: 409 }
        );
      }
      // P2003: ilişki kısıtı — ör. var olmayan kategoriye ürün bağlanması.
      if (error.code === "P2003") {
        return NextResponse.json(
          { error: "İlişkili kayıt bulunamadı." },
          { status: 400 }
        );
      }
    }

    throw error;
  }
}
