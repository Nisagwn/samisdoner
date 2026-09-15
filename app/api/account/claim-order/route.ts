import { NextResponse } from "next/server";
import { requireCustomer } from "@/lib/account/guard";
import { claimGuestOrder, claimSchema } from "@/lib/account/claim";
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
