import { NextResponse } from "next/server";
import { authenticateCustomer } from "@/lib/account/repository";
import { loginSchema } from "@/lib/account/schema";
import { withDatabase } from "@/lib/security/dbGuard";
import { autoClaimGuestOrders } from "@/lib/account/claim";
import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_MAX_AGE,
  createCustomerToken,
  customerCookieOptions,
} from "@/lib/account/session";
import {
  checkThrottle,
  clearAttempts,
  clientIp,
  recordFailure,
  throttleKeys,
} from "@/lib/security/throttle";

/**
 * Giriş.
 *
 * Hata mesajı tek tiptir: "e-posta bulunamadı" ile "parola yanlış" ayrımı
 * yapılmaz. Ayrım yapmak, kayıtlı adreslerin listesini çıkarmayı bir formdan
 * ibaret hâle getirirdi. Zamanlama farkı da kapatılıyor (bkz.
 * `authenticateCustomer` içindeki sahte özet).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withDatabase(async () => {
    const ip = clientIp(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
    }

    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "E-Mail oder Passwort ist falsch." }, { status: 401 });
    }

    const keys = [
      throttleKeys.customerIp(ip),
      throttleKeys.customerEmail(parsed.data.email),
    ];

    const throttle = await checkThrottle(keys);
    if (throttle.blocked) {
      return NextResponse.json(
        { error: "Zu viele Anmeldeversuche. Bitte später erneut versuchen." },
        { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } }
      );
    }

    const customer = await authenticateCustomer(parsed.data.email, parsed.data.password);

    if (!customer) {
      await recordFailure(keys);
      return NextResponse.json({ error: "E-Mail oder Passwort ist falsch." }, { status: 401 });
    }

    await clearAttempts(keys);

    /*
     * Misafirken verilmiş siparişleri her girişte bağlamayı dene.
     *
     * Kayıt anında da yapılıyor ama orada yakalanmayan bir durum var: hesabı
     * altı ay önce açan müşteri, dün telefonla/misafir olarak sipariş vermiş
     * olabilir. Giriş, o siparişin hesapta görünmesi için doğal fırsat.
     *
     * Ucuz bir sorgu değil ama giriş de sık bir işlem değil; hata yutulur
     * çünkü bir eşleştirme arızası girişi düşürmemeli.
     */
    try {
      await autoClaimGuestOrders(customer.id, customer.email, customer.phone);
    } catch (error) {
      console.error("[account] misafir siparişleri bağlanamadı", error);
    }

    const response = NextResponse.json({
      ok: true,
      customer: { name: customer.name, email: customer.email },
    });

    response.cookies.set(
      CUSTOMER_SESSION_COOKIE,
      await createCustomerToken({
        customerId: customer.id,
        tokenVersion: customer.tokenVersion,
      }),
      customerCookieOptions(CUSTOMER_SESSION_MAX_AGE)
    );

    return response;
  });
}
