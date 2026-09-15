import { NextResponse } from "next/server";
import { registerCustomer } from "@/lib/account/repository";
import { registerSchema } from "@/lib/account/schema";
import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_MAX_AGE,
  createCustomerToken,
  customerCookieOptions,
} from "@/lib/account/session";
import { checkThrottle, clientIp, recordFailure, throttleKeys } from "@/lib/security/throttle";
import { withDatabase } from "@/lib/security/dbGuard";
import { createEmailVerificationToken } from "@/lib/account/emailVerification";
import { sendEmailVerificationMail } from "@/lib/mail/account";
import { autoClaimGuestOrders } from "@/lib/account/claim";

/**
 * Hesap açma.
 *
 * Kayıt başarılı olur olmaz oturum da açılır: kullanıcıyı "kaydınız oluştu,
 * şimdi giriş yapın" diye ikinci bir forma göndermek, sepetini bekleten biri
 * için gereksiz bir engeldir.
 *
 * Hesap açmak sipariş vermenin **önkoşulu değildir**; bu uç yalnızca isteyen
 * için vardır. Misafir akışı olduğu gibi durur.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withDatabase(async () => {
    const ip = clientIp(request);

    // Kayıt ucu da kısıtlanır: aksi hâlde tek bir kaynak binlerce sahte hesap
    // açıp hem tabloyu hem de parola özetleme maliyetiyle CPU'yu doldurabilir.
    const throttle = await checkThrottle([throttleKeys.customerIp(ip)]);
    if (throttle.blocked) {
      return NextResponse.json(
        { error: "Zu viele Versuche. Bitte später erneut versuchen." },
        { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
    }

    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json(
        { error: issue?.message ?? "Ungültige Eingabe.", field: issue?.path.join(".") },
        { status: 400 }
      );
    }

    const result = await registerCustomer(parsed.data);

    if (!result.ok) {
      // Bu yanıt, adresin kayıtlı olduğunu ele verir. Kaçınılmaz: benzersiz bir
      // e-posta ile hesap açmaya çalışan kullanıcıya "olmadı" deyip sebebini
      // söylememek, kendi hesabını olduğunu bilmeyen kişiyi çıkmaza sokar.
      // Ölçülü karşılık: başarısız kayıt da sayaca yazılır, böylece bu uç
      // üzerinden adres listesi taranamaz.
      await recordFailure([throttleKeys.customerIp(ip)]);
      return NextResponse.json(
        {
          error: "Für diese E-Mail-Adresse besteht bereits ein Konto. Bitte melden Sie sich an.",
          field: "email",
          code: "email_taken",
        },
        { status: 409 }
      );
    }

    /*
     * Doğrulama bağlantısı kayıt anında gider.
     *
     * Gönderim **beklenmez ve başarısızlığı kaydı düşürmez**: Resend anahtarı
     * yoksa ya da sağlayıcı hata verirse hesap yine açılmış olur ve kullanıcı
     * bağlantıyı ayarlar ekranından yeniden isteyebilir. Bir bildirim hatası
     * yüzünden açılmış bir hesabı geri almak kabul edilemez.
     *
     * Doğrulama sipariş vermenin önkoşulu değil (bkz. şemadaki not): tek işi,
     * parola sıfırlamanın güvenilir bir adrese gitmesini sağlamak.
     */
    try {
      const token = await createEmailVerificationToken(
        result.customer.id,
        result.customer.email
      );
      await sendEmailVerificationMail({
        to: result.customer.email,
        name: result.customer.name,
        token,
      });
    } catch (error) {
      console.error("[account] doğrulama e-postası gönderilemedi", error);
    }

    /*
     * Misafirken verilmiş siparişleri hesaba bağla.
     *
     * Kayıt olan kişinin e-postası ve telefonu, o gün misafir olarak verdiği
     * siparişte de yazıyor olabilir. Bu siparişleri elle "hesabıma ekle"
     * adımına bırakmak, çoğu müşterinin geçmişini boş görmesi demek — ve o
     * adımı bulan da zaten az.
     *
     * Eşleşme iki alanın **birden** tutmasını ister (bkz. lib/account/claim.ts);
     * burada kullanıcıdan hiçbir şey istenmediği için ölçüt daha da dar:
     * e-posta ile telefon aynı anda tutmalı.
     */
    try {
      await autoClaimGuestOrders(
        result.customer.id,
        result.customer.email,
        result.customer.phone
      );
    } catch (error) {
      console.error("[account] misafir siparişleri bağlanamadı", error);
    }

    const response = NextResponse.json({
      ok: true,
      customer: { name: result.customer.name, email: result.customer.email },
    });

    response.cookies.set(
      CUSTOMER_SESSION_COOKIE,
      await createCustomerToken({
        customerId: result.customer.id,
        tokenVersion: result.customer.tokenVersion,
      }),
      customerCookieOptions(CUSTOMER_SESSION_MAX_AGE)
    );

    return response;
  });
}
