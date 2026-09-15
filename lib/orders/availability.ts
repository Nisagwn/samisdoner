import { prisma } from "@/lib/db";
import { CACHE_KEYS, cached } from "@/lib/cache";
import { buildTimeSlots, isSelectableSlot, type TimeSlot } from "./slots";

/**
 * Siparişin kabul edilip edilmeyeceğine dair kurallar.
 *
 * Hepsi sunucuda çalışır. Arayüz aynı kuralları önden gösterir (kapalıyken
 * "şu an kapalıyız" der), ama **karar burada verilir**: istemci tarafı kontrol
 * atlatılabilir, bu katman atlatılamaz.
 *
 * ÖNBELLEK
 *
 * Bu dosyanın okuduğu üç tablo (ayarlar, çalışma saatleri, tatil günleri,
 * teslimat bölgeleri) haftada bir bile değişmez, ama sepet çekmecesi her
 * açıldığında (`/api/menu/status`) ve her fiyat teklifinde okunur. Bu yüzden
 * **satırlar** önbelleklenir, karar değil: "açık mı" sorusunun cevabı dakikadan
 * dakikaya değişir, oysa saat tablosu değişmez. Kararı hep taze saatle yerelde
 * hesaplamak, hem doğru hem bedava.
 *
 * Panelden yapılan yazmalar (`lib/orders/business.ts`, `lib/orders/zones.ts`)
 * ilgili anahtarı düşürür.
 */

/** Nadiren değişen işletme verisinin önbellekte kalma süresi. */
const BUSINESS_MAX_AGE_SECONDS = 300;

const TIME_ZONE = "Europe/Berlin";

/**
 * Geliştirme kaçamağı: çalışma saati kontrolünü atlar.
 *
 * Sipariş akışını dükkân kapalıyken de deneyebilmek için var. Bilerek
 * NODE_ENV'e bağlanmadı — Vercel önizleme dağıtımları da `production` olarak
 * çalışır ve orada da test edilebilmesi gerekiyor.
 *
 * DİKKAT: canlıya çıkmadan önce bu değişken ortamdan **silinmeli**. Açık
 * kaldığı sürece müşteri gece 03:00'te sipariş verebilir ve ödeme alınır.
 * Bu yüzden her atlamada sunucu günlüğüne uyarı düşer.
 */
function openingHoursBypassed(): boolean {
  if (process.env.ORDERS_IGNORE_OPENING_HOURS !== "true") return false;
  console.warn(
    "[siparis] ORDERS_IGNORE_OPENING_HOURS acik: calisma saati kontrolu atlandi. " +
      "Canliya cikmadan once bu degiskeni kaldirin.",
  );
  return true;
}

/**
 * İşletmenin yerel saatiyle "şimdi".
 *
 * Sunucu UTC'de çalışabilir (Vercel, Docker); `new Date().getDay()` bu yüzden
 * yanlış gün verebilir. Gün ve saat her zaman Europe/Berlin'e göre okunur —
 * yaz saati geçişleri de dahil.
 */
function berlinNow(now: Date = new Date()): {
  weekday: number;
  minutes: number;
  isoDate: string;
} {
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

/**
 * Haftalık çalışma saatleri — yedi günün tamamı, önbellekten.
 *
 * Dışarı açık: ileri saatli sipariş (Vorbestellung) için seçilebilir zaman
 * aralıkları da aynı tablodan üretiliyor (bkz. lib/orders/slots.ts). İkinci bir
 * okuma yolu açmak, "açık mıyız" ile "hangi saatler seçilebilir" sorularının
 * farklı tablolardan cevaplanması demek olurdu.
 */
export function weeklyHours(): Promise<{ weekday: number; openMinute: number; closeMinute: number }[]> {
  return cached(CACHE_KEYS.openingHours, BUSINESS_MAX_AGE_SECONDS, () =>
    prisma.openingHour.findMany({
      select: { weekday: true, openMinute: true, closeMinute: true },
    })
  );
}

/**
 * Bugünden itibaren kapalı günler ("2026-12-24" biçiminde).
 *
 * Tek bir güne bakmak yerine tüm liste önbelleklenir: tatil günleri bir avuç
 * satırdır ve günlük anahtar kullanmak, panelden tatil eklendiğinde hangi
 * günün anahtarının düşürüleceğini takip etmeyi gerektirirdi.
 */
export function upcomingClosures(): Promise<string[]> {
  return cached(CACHE_KEYS.closures, BUSINESS_MAX_AGE_SECONDS, async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const rows = await prisma.specialClosure.findMany({
      where: { date: { gte: today } },
      select: { date: true },
    });
    return rows.map((row) => row.date.toISOString().slice(0, 10));
  });
}

/**
 * Verilen anda dükkân açık mı.
 *
 * Gece yarısını aşan aralıklar (18:00–02:00) desteklenir: kapanış saati açılış
 * saatinden küçükse aralık ertesi güne sarkıyor demektir.
 */
export async function isOpenNow(now: Date = new Date()): Promise<boolean> {
  if (openingHoursBypassed()) return true;

  const { weekday, minutes, isoDate } = berlinNow(now);

  const [closedDays, allHours] = await Promise.all([upcomingClosures(), weeklyHours()]);

  if (closedDays.includes(isoDate)) return false;

  // Dünün gece yarısını aşan aralığı bugüne sarkabilir; iki gün birden bakılır.
  const hours = allHours.filter(
    (h) => h.weekday === weekday || h.weekday === (weekday + 6) % 7
  );

  return hours.some((h) => {
    const wraps = h.closeMinute <= h.openMinute;
    if (h.weekday === weekday) {
      return wraps ? minutes >= h.openMinute : minutes >= h.openMinute && minutes < h.closeMinute;
    }
    // Bir önceki günün gece yarısını aşan aralığı bugüne sarkıyor mu.
    return wraps && minutes < h.closeMinute;
  });
}

/* ------------------------------------------- ileri saatli sipariş (Vorbestellung) */

/**
 * Seçilebilir teslim saatleri — çalışma saatleri ve tatil günlerinden.
 *
 * Hazırlık payı ayarlardan gelir: mutfak 30 dakikada yetiştiriyorsa en erken
 * kutu 30 dakika sonrasıdır. Aynı veriyle hem liste üretilir hem de gelen
 * seçim doğrulanır; iki ayrı kaynak olsaydı listede olmayan bir saatin kabul
 * edilmesi an meselesiydi.
 */
export async function getSchedulableSlots(now: Date = new Date()): Promise<TimeSlot[]> {
  const [hours, closedDays, settings] = await Promise.all([
    weeklyHours(),
    upcomingClosures(),
    getOrderSettings(),
  ]);

  return buildTimeSlots({ hours, closedDays, now, leadMinutes: settings.prepMinutes });
}

/**
 * İstemciden gelen teslim saatinin kabul edilebilirliği.
 *
 * `ORDERS_IGNORE_OPENING_HOURS` burada da geçerlidir: akışı kapalıyken
 * denemenin tek yolu bu değişken ve ön siparişin kapıyı kapatması anlamsız
 * olurdu.
 */
export async function isSchedulableAt(
  requestedAt: Date,
  now: Date = new Date()
): Promise<boolean> {
  if (openingHoursBypassed()) return requestedAt.getTime() > now.getTime();

  const [hours, closedDays, settings] = await Promise.all([
    weeklyHours(),
    upcomingClosures(),
    getOrderSettings(),
  ]);

  return isSelectableSlot(requestedAt, {
    hours,
    closedDays,
    now,
    leadMinutes: settings.prepMinutes,
  });
}

export type DeliveryZoneInfo = {
  postalCode: string;
  city: string;
  minOrderCents: number;
  feeCents: number;
  freeOverCents: number;
  etaMinutes: number;
};

/**
 * Posta kodu teslimat bölgesinde mi; değilse null.
 *
 * Bölge listesi bir avuç satırdır (dükkânın dağıtım yaptığı mahalleler) ve
 * tamamı tek anahtarda önbelleklenir. Posta kodu başına ayrı anahtar tutmak,
 * bölge silindiğinde hangi anahtarın düşeceğini izlemeyi gerektirir — üstelik
 * bölgede **olmayan** posta kodları önbelleği sonsuz büyütürdü.
 */
export async function findDeliveryZone(zip: string): Promise<DeliveryZoneInfo | null> {
  const zones = await cached(CACHE_KEYS.zones, BUSINESS_MAX_AGE_SECONDS, () =>
    prisma.deliveryZone.findMany({
      where: { active: true },
      select: {
        postalCode: true,
        city: true,
        minOrderCents: true,
        feeCents: true,
        freeOverCents: true,
        etaMinutes: true,
      },
    })
  );

  return zones.find((zone) => zone.postalCode === zip.trim()) ?? null;
}

/**
 * Bölgenin teslimat ücreti.
 *
 * Eşik varsa ve sepet eşiği geçtiyse ücret alınmaz. PAngV § 6 gereği bu tutar
 * müşteriye **sipariş verilmeden önce** gösterilmek zorunda; bu yüzden aynı
 * fonksiyon hem fiyat teklifinde hem sipariş oluşturmada kullanılır.
 */
export function deliveryFeeFor(zone: DeliveryZoneInfo, subtotalCents: number): number {
  if (zone.freeOverCents > 0 && subtotalCents >= zone.freeOverCents) return 0;
  return zone.feeCents;
}

/** İşletme ayarlarının sipariş akışını ilgilendiren kısmı. */
export async function getOrderSettings() {
  return cached(CACHE_KEYS.orderSettings, BUSINESS_MAX_AGE_SECONDS, async () => {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    return {
      orderingEnabled: settings?.orderingEnabled ?? true,
      deliveryEnabled: settings?.deliveryEnabled ?? true,
      pickupEnabled: settings?.pickupEnabled ?? false,
      cashEnabled: settings?.cashEnabled ?? false,
      prepMinutes: settings?.prepMinutes ?? 30,
    };
  });
}

/** Sipariş reddedilme sebepleri — arayüz bunları kendi diline çevirir. */
export type RejectionReason =
  | { code: "ordering_paused" }
  | { code: "closed" }
  | { code: "fulfillment_disabled"; fulfillment: "DELIVERY" | "PICKUP" }
  | { code: "out_of_delivery_area"; zip: string }
  | { code: "below_minimum"; minOrderCents: number; subtotalCents: number }
  /**
   * İleri saatli siparişte seçilen teslim saati artık geçerli değil.
   *
   * Müşteri sayfayı açtıktan sonra saat ilerlemiş, panelden kapanış saati
   * değişmiş ya da o güne tatil girilmiş olabilir. "Kapalıyız" demek yanlış
   * olurdu — dükkân açık, seçilen saat geçersiz.
   */
  | { code: "slot_unavailable" };

export type OrderabilityResult =
  | { ok: true; zone: DeliveryZoneInfo | null; etaMinutes: number }
  /**
   * Ret hâlinde de bölge taşınır (bulunabildiyse).
   *
   * Sepet eşiğinin altında kalan müşteriye "buraya teslimat 2,50 €, minimum
   * 15 €" demek gerekiyor; bunun için bölgeyi ikinci kez sorgulamak, kararın
   * verildiği yerle gösterimin ayrışması riskini doğururdu.
   */
  | { ok: false; reason: RejectionReason; zone: DeliveryZoneInfo | null };

/**
 * Siparişin kabul edilebilirliği — tek karar noktası.
 *
 * Sıra önemlidir: önce dükkân hiç sipariş alıyor mu, sonra açık mı, sonra bu
 * teslim biçimi açık mı, sonra adres bölgede mi, en sonda sepet eşiği. Böylece
 * müşteriye gösterilen ilk hata en temel olanıdır.
 */
export async function checkOrderability(input: {
  fulfillment: "DELIVERY" | "PICKUP";
  zip?: string;
  subtotalCents: number;
  now?: Date;
  /**
   * İleri saatli siparişte istenen teslim saati; "en kısa sürede"de boş.
   *
   * Dolu olduğunda **"şu an açık mıyız" kontrolünün yerini alır**: ön
   * siparişin bütün anlamı, dükkân kapalıyken akşamki servise sipariş
   * verebilmektir. Yerine geçen kontrol daha dar: seçilen saat gerçekten
   * açılış saatleri içinde, hazırlık payından sonra ve kapalı bir güne
   * denk gelmiyor olmalı (bkz. `isSelectableSlot`).
   */
  requestedAt?: Date | null;
}): Promise<OrderabilityResult> {
  const settings = await getOrderSettings();
  if (!settings.orderingEnabled) {
    return { ok: false, reason: { code: "ordering_paused" }, zone: null };
  }

  if (input.requestedAt) {
    const selectable = await isSchedulableAt(input.requestedAt, input.now);
    if (!selectable) return { ok: false, reason: { code: "slot_unavailable" }, zone: null };
  } else if (!(await isOpenNow(input.now))) {
    return { ok: false, reason: { code: "closed" }, zone: null };
  }

  if (input.fulfillment === "DELIVERY" && !settings.deliveryEnabled) {
    return {
      ok: false,
      reason: { code: "fulfillment_disabled", fulfillment: "DELIVERY" },
      zone: null,
    };
  }
  if (input.fulfillment === "PICKUP" && !settings.pickupEnabled) {
    return {
      ok: false,
      reason: { code: "fulfillment_disabled", fulfillment: "PICKUP" },
      zone: null,
    };
  }

  if (input.fulfillment === "PICKUP") {
    return { ok: true, zone: null, etaMinutes: settings.prepMinutes };
  }

  const zip = input.zip?.trim() ?? "";
  const zone = await findDeliveryZone(zip);
  if (!zone) return { ok: false, reason: { code: "out_of_delivery_area", zip }, zone: null };

  if (input.subtotalCents < zone.minOrderCents) {
    return {
      ok: false,
      reason: {
        code: "below_minimum",
        minOrderCents: zone.minOrderCents,
        subtotalCents: input.subtotalCents,
      },
      zone,
    };
  }

  return { ok: true, zone, etaMinutes: zone.etaMinutes };
}
