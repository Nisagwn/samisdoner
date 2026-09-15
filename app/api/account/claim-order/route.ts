import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCustomer } from "@/lib/account/guard";
import { claimGuestOrder, claimSchema, claimVerifiedOrder } from "@/lib/account/claim";
import { verifyOrderToken } from "@/lib/orders/token";
import { withDatabase } from "@/lib/security/dbGuard";
import { checkThrottle, clientIp, recordFailure, throttleKeys } from "@/lib/security/throttle";

/**
 * Misafirken verilmiş bir siparişi hesaba bağlar.
 *
 * Kısıtlama burada **gerçekten gerekli**, giriş ucundan bile daha çok:
 * sipariş numaraları gün içinde sıralı ("SD-260907-001") ve telefon numarası
 * da tahmin edilebilir bir uzayda. Sınırsız denemeye izin verilseydi, bu uç
 * başkalarının siparişlerini adres ve telefonuyla birlikte toplamanın yolu
 * olurdu. Başarısız her deneme sayaca yazılır.
 *
 * Reddedilen her durum **aynı cevabı** döner: "böyle bir sipariş bulunamadı"
 * ile "telefon tutmadı" ayrımı, doğru tahmin edilmiş bir sipariş numarasını
 * onaylamak olurdu ve saldırgana aradığı tek bilgiyi verirdi.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REJECTED =
  "Wir konnten keine passende Bestellung finden. Bitte prüfen Sie Bestellnummer und Telefonnummer.";

/** Takip jetonu; uzunluk sınırı imza doğrulamasında bedava CPU tüketimini keser. */
const tokenSchema = z.object({
  token: z.string().trim().min(10).max(300),
});

export async function POST(request: Request) {
  return withDatabase(async () => {
    const customer = await requireCustomer();
    if (customer instanceof NextResponse) return customer;

    const keys = [throttleKeys.customerIp(clientIp(request))];
    const throttle = await checkThrottle(keys);
    if (throttle.blocked) {
      return NextResponse.json(
        { error: "Zu viele Versuche. Bitte später erneut versuchen." },
        { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } }
      );
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
    }

    const parsed = claimSchema.safeParse(raw);
    if (!parsed.success) {
      await recordFailure(keys);
      return NextResponse.json({ error: REJECTED }, { status: 400 });
    }

    const result = await claimGuestOrder(customer.id, parsed.data);
    if (!result.ok) {
      await recordFailure(keys);
      return NextResponse.json({ error: REJECTED }, { status: 404 });
    }

    return NextResponse.json({ ok: true, orderNo: result.orderNo });
  });
}

/**
 * Takip bağlantısından bağlama.
 *
 * POST'tan farkı kanıtın kaynağı: orada müşteri sipariş numarası ve telefon
 * yazıyor, burada elindeki **imzalı takip jetonu** kanıt. Jeton tahmin
 * edilemez ve imzasız üretilemez (bkz. lib/orders/token.ts), yani POST'un
 * kabul ettiği çiftten daha güçlü.
 *
 * Bu yüzden burada oran sınırlaması yok: denenecek bir şey yok — geçersiz bir
 * jeton hiçbir siparişe çözülmez ve rastgele jeton üretmek HMAC'i kırmak
 * demek.
 */
export async function PUT(request: Request) {
  return withDatabase(async () => {
    const customer = await requireCustomer();
    if (customer instanceof NextResponse) return customer;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
    }

    const parsed = tokenSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: REJECTED }, { status: 400 });
    }

    const orderNo = await verifyOrderToken(parsed.data.token);
    if (!orderNo) return NextResponse.json({ error: REJECTED }, { status: 404 });

    const result = await claimVerifiedOrder(customer.id, orderNo);
    if (!result.ok) {
      return NextResponse.json({ error: REJECTED }, { status: 409 });
    }

    return NextResponse.json({ ok: true, orderNo: result.orderNo });
  });
}
