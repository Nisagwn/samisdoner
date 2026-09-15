import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrderSettings, isOpenNow } from "@/lib/orders/availability";
import { withDatabase } from "@/lib/security/dbGuard";
import type { LocalNow, OpeningHour } from "@/lib/menu/opening";

/**
 * İşletmenin sipariş durumu.
 *
 * Sepet boşken de gerekli: müşteri yarım saat menü gezip sepet doldurduktan
 * sonra "şu an kapalıyız" duvarına toslamamalı. Bu uç, çekmece açılır açılmaz
 * (sepet boş olsa bile) durumu söyler ve teslimat/gel-al seçeneklerinden
 * hangilerinin açık olduğunu bildirir.
 *
 * Karar burada verilmez, yalnızca okunur: siparişin kabul edilip edilmeyeceğine
 * her zaman sunucudaki `checkOrderability` karar verir. Buradaki bilgi arayüzün
 * önden uyarı verebilmesi içindir.
 *
 * ÇALIŞMA SAATLERİ VE EŞİKLER NEDEN BURADA
 *
 * Yanıt "açık mı" sorusunun ötesine geçip haftalık saatleri, tatil günlerini ve
 * teslimat eşiklerinin **en düşüğünü** de taşıyor. Sebebi tek: kapalıyken
 * "yarın 11:00'de açılıyoruz" diyebilmek ve sepette posta kodu seçilmeden önce
 * "minimum sepet 15 €'dan başlıyor" diyebilmek için arayüzün bu üç veriye
 * ihtiyacı var. Her biri için ayrı uç açmak, sayfa başına üç istek demekti;
 * hepsi birlikte değişmeyen, önbelleklenebilir veriler.
 *
 * `now` alanı da sunucudan gelir: ziyaretçinin cihaz saati yanlış olabilir ve
 * "bugün açık mı" kararı işletmenin saatine (Europe/Berlin) göre verilmeli.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type MenuStatus = {
  orderingEnabled: boolean;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  open: boolean;
  prepMinutes: number;

  /** Haftalık çalışma saatleri; arayüz "bugün 11:00–21:00" satırını bundan kurar. */
  hours: OpeningHour[];
  /** Bugünden itibaren kapalı günler ("2026-12-24"). */
  closedDates: string[];
  /** İşletmenin yerel saatiyle "şimdi". */
  now: LocalNow;

  /**
   * Teslimat bölgelerinin **en düşük** minimum sepet tutarı (cent); bölge yoksa 0.
   *
   * Gerçek eşik posta koduna bağlı ve onu ödeme adımı belirliyor. Burada en
   * düşüğü veriliyor ki sepette "minimum 15 €'dan başlar" denebilsin —
   * müşteriye söz verilen en iyimser sayıdır, dolayısıyla ödeme adımında tutar
   * yükselebilir ama "sipariş verebilirdin" yalanı kurulmaz.
   */
  minOrderFromCents: number;
  /** Ücretsiz teslimatın başladığı en düşük eşik (cent); eşik yoksa 0. */
  freeDeliveryFromCents: number;
};

const TIME_ZONE = "Europe/Berlin";

/**
 * İşletmenin yerel saatiyle "şimdi".
 *
 * `lib/orders/availability.ts` içinde aynı hesabın bir kopyası var ve orada
 * kalmalı: orası kararı verir, burası ekrana yazar. İkisini paylaştırmak, bir
 * gösterim ihtiyacı yüzünden karar katmanının dışarı açılması olurdu.
 */
function berlinNow(now: Date = new Date()): LocalNow {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const weekdays: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  // 24:00 gece yarısını gösterir; dakika hesabında 0 olmalı.
  const hour = Number(get("hour")) % 24;

  return {
    weekday: weekdays[get("weekday")] ?? 0,
    minutes: hour * 60 + Number(get("minute")),
    isoDate: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

export async function GET() {
  return withDatabase(async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const [settings, open, hours, closures, zones] = await Promise.all([
      getOrderSettings(),
      isOpenNow(),
      prisma.openingHour.findMany({
        select: { weekday: true, openMinute: true, closeMinute: true },
      }),
      prisma.specialClosure.findMany({ where: { date: { gte: today } }, select: { date: true } }),
      prisma.deliveryZone.findMany({
        where: { active: true },
        select: { minOrderCents: true, freeOverCents: true },
      }),
    ]);

    // Eşiği olmayan bölgeler (0) hesaba katılmaz: "0 €'dan itibaren ücretsiz"
    // demek, eşiksiz bir bölgeyi tüm şehrin sözü gibi göstermek olurdu.
    const minimums = zones.map((z) => z.minOrderCents).filter((c) => c > 0);
    const freeThresholds = zones.map((z) => z.freeOverCents).filter((c) => c > 0);

    const status: MenuStatus = {
      orderingEnabled: settings.orderingEnabled,
      deliveryEnabled: settings.deliveryEnabled,
      pickupEnabled: settings.pickupEnabled,
      open,
      prepMinutes: settings.prepMinutes,
      hours,
      closedDates: closures.map((row) => row.date.toISOString().slice(0, 10)),
      now: berlinNow(),
      minOrderFromCents: minimums.length > 0 ? Math.min(...minimums) : 0,
      freeDeliveryFromCents: freeThresholds.length > 0 ? Math.min(...freeThresholds) : 0,
    };

    return NextResponse.json(status);
  });
}
