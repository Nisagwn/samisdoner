import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ENV_OWNER_ID,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionToken,
  sessionCookieOptions,
  verifyEnvPassword,
} from "@/lib/admin/auth";
import { authenticateStaff } from "@/lib/admin/staff";
import { withDatabase } from "@/lib/security/dbGuard";
import {
  checkThrottle,
  clearAttempts,
  clientIp,
  recordFailure,
  throttleKeys,
} from "@/lib/security/throttle";

/**
 * Panel girişi — iki yol, tek uç.
 *
 * 1. **E-posta + parola.** Olağan yol: oturum bir kişiyi taşır, rolü kendi
 *    kaydından gelir ve yaptığı işlemler o kişinin adına yazılır.
 * 2. **Yalnızca parola** (`ADMIN_PASSWORD`). Kurtarma yolu: `AdminUser`
 *    tablosunda hiç kullanıcı yokken ilk girişin bir yerden yapılması gerekir,
 *    ve personel listesinden yanlışlıkla düşen bir işletmecinin panele
 *    girmesinin başka yolu olmamalı. Bu yolla girenin rolü OWNER'dır.
 *
 * Hangi yolun denendiği gövdedeki `email` alanının varlığından anlaşılır.
 * Hata mesajı iki yolda da aynı: "hangi e-posta kayıtlı" sorusunun cevabı bir
 * giriş formundan okunmamalı.
 *
 * Kısıtlayıcı veritabanında (`lib/security/throttle.ts`). Bellekteki bir
 * sayaç sunucu yeniden başlayınca sıfırlanır ve çok örnekli dağıtımda hiç
 * çalışmaz — her istek başka bir örneğe düşer, hiçbiri diğerinin sayacını
 * görmez.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** Boş bırakılırsa ortak parola yolu denenir. */
  email: z.string().trim().toLowerCase().max(160).optional().default(""),
  password: z.string().min(1).max(200),
});

/** Giriş denemesinin sonucu ne olursa olsun aynı cümle görünür. */
const WRONG = "E-posta veya parola hatalı.";

export async function POST(request: Request) {
  return withDatabase(async () => {
    const ip = clientIp(request);
    const keys = [throttleKeys.adminIp(ip)];

    const throttle = await checkThrottle(keys);
    if (throttle.blocked) {
      return NextResponse.json(
        { error: "Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin." },
        { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } }
      );
    }

    if (!process.env.ADMIN_SESSION_SECRET) {
      return NextResponse.json(
        { error: "Sunucuda ADMIN_SESSION_SECRET tanımlı değil." },
        { status: 500 }
      );
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: WRONG }, { status: 401 });
    }

    const { email, password } = parsed.data;

    /*
     * Kullanıcı yolu.
     *
     * Ortak parolaya **düşülmez**: e-posta yazılmışsa niyet bellidir ve
     * yanlış parolada sessizce ortak parolayı denemek, bir kullanıcının
     * hesabına başkasının kimliğiyle girmesine yol açardı.
     */
    if (email) {
      const user = await authenticateStaff(email, password);
      if (!user) {
        await recordFailure(keys);
        return NextResponse.json({ error: WRONG }, { status: 401 });
      }

      await clearAttempts(keys);
      return withSession(
        { userId: user.id, role: user.role, tokenVersion: user.tokenVersion },
        { email: user.email, role: user.role }
      );
    }

    /* Kurtarma yolu. */
    if (!process.env.ADMIN_PASSWORD || !(await verifyEnvPassword(password))) {
      await recordFailure(keys);
      return NextResponse.json({ error: WRONG }, { status: 401 });
    }

    await clearAttempts(keys);
    return withSession(
      { userId: ENV_OWNER_ID, role: "OWNER", tokenVersion: 0 },
      { email: "", role: "OWNER", recovery: true }
    );
  });
}

async function withSession(
  session: Parameters<typeof createSessionToken>[0],
  body: Record<string, unknown>
) {
  const response = NextResponse.json({ ok: true, ...body });
  response.cookies.set(
    SESSION_COOKIE,
    await createSessionToken(session),
    sessionCookieOptions(SESSION_MAX_AGE)
  );
  return response;
}
