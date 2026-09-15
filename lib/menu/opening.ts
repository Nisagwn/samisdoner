/**
 * Açılış saatlerinin **gösterim** tarafı — saf hesap.
 *
 * `lib/orders/availability.ts` "şu an açık mı" sorusunun tek yetkili cevabını
 * verir ve karar orada kalır. Burada bambaşka bir soru cevaplanıyor: dükkân
 * kapalıyken müşteriye **ne yazacağız**. "Geschlossen" demek yetmez; kapalı
 * olduğunu görüp sekmeyi kapatan müşteri geri gelmez. "Bugün 11:00'de açılıyor"
 * diyen bir bant ise sepeti doldurmaya devam etmesi için sebep verir.
 *
 * Bu yüzden karar değil metin üretiyoruz ve modül saf: veritabanı, saat dilimi
 * dönüşümü ve önbellek çağıranın işi. Böylece test edilebiliyor.
 */

export type OpeningHour = {
  /** 0 = Pazar … 6 = Cumartesi (JS getDay ile aynı). */
  weekday: number;
  /** Gün başından itibaren dakika (11:00 → 660). */
  openMinute: number;
  closeMinute: number;
};

/** İşletmenin yerel saatiyle "şimdi"; çağıran Europe/Berlin'e göre üretir. */
export type LocalNow = {
  weekday: number;
  minutes: number;
  /** "2026-09-14" */
  isoDate: string;
};

/** Bir sonraki açılış anı. `daysAhead` 0 ise bugün, 1 ise yarın. */
export type NextOpening = {
  weekday: number;
  minute: number;
  daysAhead: number;
};

/** En fazla iki hafta ileri bakılır: daha uzağı "kapalı" demekle aynı şey. */
const SEARCH_DAYS = 14;

/** 660 → "11:00". */
export function formatMinute(minute: number): string {
  const safe = Math.max(0, Math.min(24 * 60, Math.round(minute)));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "11:00 – 21:00" */
export function formatRange(hour: OpeningHour): string {
  return `${formatMinute(hour.openMinute)} – ${formatMinute(hour.closeMinute)}`;
}

/** Günün aralıkları, açılış saatine göre sıralı (öğle arası olan dükkânlar). */
export function hoursForWeekday(hours: OpeningHour[], weekday: number): OpeningHour[] {
  return hours
    .filter((h) => h.weekday === weekday)
    .slice()
    .sort((a, b) => a.openMinute - b.openMinute);
}

/** "2026-09-14" + 3 gün → "2026-09-17". Ay/yıl taşmasını Date halleder. */
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const base = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Bir sonraki açılış.
 *
 * Bugün için yalnızca **henüz gelmemiş** aralıklar sayılır: saat 22:00'de
 * "bugün 11:00'de açılıyoruz" demek bilgi değil, yanlış bilgi. Tatil günleri
 * (`closedDates`) atlanır; iki hafta boyunca hiç açılış bulunamazsa null döner
 * ve arayüz saat yerine telefon numarasını gösterir.
 */
export function nextOpening(
  hours: OpeningHour[],
  closedDates: readonly string[],
  now: LocalNow
): NextOpening | null {
  const closed = new Set(closedDates);

  for (let offset = 0; offset < SEARCH_DAYS; offset += 1) {
    const isoDate = addDays(now.isoDate, offset);
    if (closed.has(isoDate)) continue;

    const weekday = (now.weekday + offset) % 7;
    for (const hour of hoursForWeekday(hours, weekday)) {
      if (offset === 0 && hour.openMinute <= now.minutes) continue;
      return { weekday, minute: hour.openMinute, daysAhead: offset };
    }
  }
  return null;
}
