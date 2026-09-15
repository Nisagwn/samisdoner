import { NextResponse } from "next/server";
import { withDatabase } from "@/lib/security/dbGuard";
import { cancelOrderByCustomer } from "@/lib/orders/lifecycle";
import { verifyOrderToken } from "@/lib/orders/token";

/**
 * Müşterinin kendi siparişini iptal etmesi.
 *
 * Referans (Lieferando): sipariş **restoran onaylayana kadar** iptal
 * edilebiliyor, sonrasında müşteri dükkânı aramak zorunda. Aynı çizgi burada
 * da geçerli; pencerenin tam kuralı `lib/orders/cancelWindow.ts` içinde saf
 * mantık olarak yazılı ve testli.
 *
 * YETKİ
 *
 * Takip jetonunun imzası. Jetonu üretmek sunucudaki gizli anahtarı gerektirir,
 * dolayısıyla sipariş numarasını bilen biri başkasının siparişini iptal
 * edemez. Oturum aranmaz: iptal hakkı misafir siparişinde de olmalı ve üyelik
 * akışın hiçbir yerinde zorunlu değil.
 *
 * Jeton gövdede taşınır, adreste değil: iptal bağlantısı sunucu ve ara sunucu
 * erişim günlüklerine düşmesin.
 *
 * İPTAL = İADE
 *
 * Online ödenmiş siparişte para aynı akışta iade edilir (bahşiş dahil: tahsil
 * edilen tutarın tamamı döner). İade sağlayıcıya iletilemezse uç **hata
 * döner** — müşteriye "iptal edildi" deyip parasının dönmediğini söylememek,
 * öğreneceği en kötü yer olan hesap ekstresine bırakmak olurdu.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let token: unknown;
  try {
    token = (await request.json())?.token;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const orderNo = await verifyOrderToken(typeof token === "string" ? token : undefined);
  // Geçersiz imza ile var olmayan sipariş aynı cevabı alır; farkı söylemek
  // bilgi sızdırır.
  if (!orderNo) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return withDatabase(async () => {
    const result = await cancelOrderByCustomer(orderNo);

    if (result.ok) {
      return NextResponse.json({
        ok: true,
        status: result.status,
        refunded: result.refund?.kind === "refunded",
        refundedCents: result.refund && "amountCents" in result.refund ? result.refund.amountCents : 0,
      });
    }

    if (result.reason === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (result.reason === "refund_failed") {
      // 502: iptal oldu ama para dönmedi. Müşteri de işletme de bunu görmeli.
      return NextResponse.json({ error: "refund_failed" }, { status: 502 });
    }

    /*
     * 409: istek doğru ama artık geçerli değil — pencere kapandı, mutfak
     * siparişi üstlendi ya da sipariş zaten kapanmış. Sayfa 20 saniyede bir
     * tazelendiği için bu, çoğu zaman eskimiş bir ekranda basılmış bir
     * düğmedir; sunucu hatası değil.
     */
    return NextResponse.json({ error: result.reason }, { status: 409 });
  });
}
