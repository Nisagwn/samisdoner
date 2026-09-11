import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withDatabase } from "@/lib/security/dbGuard";
import { groupZonesByCity } from "@/lib/orders/deliveryCities";

/**
 * Teslimat bölgeleri — müşteriye **belediye listesi** olarak.
 *
 * Bu uç, sipariş formundaki "şehrini seç, gerisi gelsin" akışını besler.
 * Öncesinde müşteri posta kodunu **elle yazıyor** ve ancak beşinci haneden
 * sonra "bu bölgeye teslimat yapılmıyor" cevabını alıyordu; teslimat alanının
 * neresi olduğunu sipariş vermeden öğrenmesinin hiçbir yolu yoktu. Kimse kendi
 * posta kodunu ezbere bilmek zorunda değil — ama herkes hangi köyde oturduğunu
 * bilir. Artık seçilebilecek yerlerin tamamı önden geliyor: bölge dışı bir
 * adres yazılamıyor, dolayısıyla o hata hiç doğmuyor.
 *
 * Satırdan belediyeye açılım `lib/orders/deliveryCities.ts` içinde; oradaki
 * yorumda neden bire bir olmadığı anlatılıyor.
 *
 * Yalnızca **açık** bölgeler döner: panelde kapatılan posta kodu listede hiç
 * görünmez, sipariş akışındaki `findDeliveryZone` ile aynı kural.
 *
 * Buradaki tutarlar **gösterim içindir** (müşteri seçmeden önce "min. 15 €"
 * görebilsin diye). Tahsil edilecek gerçek teslimat ücreti her zaman
 * `/api/menu/quote` yanıtından gelir; sepet tutarına göre ücretsiz eşiği
 * orada uygulanır.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type { DeliveryZoneOption, DeliveryCity } from "@/lib/orders/deliveryCities";

export async function GET() {
  return withDatabase(async () => {
    const zones = await prisma.deliveryZone.findMany({
      where: { active: true },
      orderBy: [{ city: "asc" }, { postalCode: "asc" }],
    });

    return NextResponse.json({ cities: groupZonesByCity(zones) });
  });
}
