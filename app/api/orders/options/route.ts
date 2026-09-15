import { NextResponse } from "next/server";
import { getOrderSettings, getSchedulableSlots, isOpenNow } from "@/lib/orders/availability";
import { withDatabase } from "@/lib/security/dbGuard";
import type { TimeSlot } from "@/lib/orders/slots";

/**
 * Ödeme adımının seçenekleri: **ne zaman** ve **nasıl** ödeneceği.
 *
 * İkisi tek uçta, çünkü ikisi de aynı ekranda aynı anda gerekiyor ve ikisi de
 * aynı ayar satırından okunuyor. Ayrı uçlar iki istek, iki yükleme durumu ve
 * ikisinden biri geldiğinde yarım görünen bir form demekti.
 *
 * Buradaki bilgi **önden uyarı**dır, karar değil: seçilen saatin gerçekten
 * seçilebilir ve seçilen yöntemin gerçekten açık olduğu, sipariş oluşturulurken
 * sunucuda yeniden denetlenir. Arayüz bir seçeneği gizleyebilir; gizlenmiş bir
 * seçenek yetki kontrolü değildir.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type OrderOptions = {
  /** Dükkân şu an sipariş alıyor mu — "en kısa sürede" seçeneği buna bakar. */
  openNow: boolean;
  /** Ortalama hazırlık süresi (dk); en erken teslim saati buradan çıkar. */
  prepMinutes: number;
  /** İleri saatli sipariş için seçilebilir teslim saatleri. */
  slots: TimeSlot[];
  /**
   * Kapıda ödeme (nakit ve kapıda kart) açık mı.
   *
   * Tek anahtar iki yöntemi birden yönetir: ikisinin de işletme açısından
   * anlamı aynı — para teslim anında, personelin elinden alınıyor.
   */
  onSitePaymentEnabled: boolean;
};

export async function GET() {
  return withDatabase(async () => {
    const [settings, openNow, slots] = await Promise.all([
      getOrderSettings(),
      isOpenNow(),
      getSchedulableSlots(),
    ]);

    const options: OrderOptions = {
      openNow,
      prepMinutes: settings.prepMinutes,
      slots,
      onSitePaymentEnabled: settings.cashEnabled,
    };

    return NextResponse.json(options);
  });
}
