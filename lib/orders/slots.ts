/**
 * Vorbestellung — ileri saatli sipariş için seçilebilir zaman aralıkları.
 *
 * Referans (Lieferando): müşteri tahmini varış saatine dokununca bir liste
 * açılıyor ve istediği teslim saatini seçiyor. Kural seti üç maddeyle
 * özetleniyor: **aynı gün**, **açılış saatleri içinde**, **sipariş verildikten
 * sonra değiştirilemez**. Üçünü de burada uyguluyoruz; üçüncüsü zaten kayıt
 * append-only olduğu için kendiliğinden doğru.
 *
 * SAF MANTIK
 *
 * Bu dosya veritabanına dokunmaz: çalışma saatleri, kapalı günler ve "şimdi"
 * parametre olarak girer. Sebebi test edilebilirlik değil sadece — aynı
 * fonksiyon hem listeyi üretmek (arayüz) hem de gelen seçimi **doğrulamak**
 * (sunucu) için kullanılıyor. İki ayrı uygulama olsaydı, listede olmayan bir
 * saatin kabul edilmesi an meselesiydi.
 *
 * YENİ BİR TARİH KÜTÜPHANESİ YOK
 *
 * Europe/Berlin yaz saatiyle birlikte `Intl` üzerinden çözülüyor: yerel duvar
 * saatinden UTC'ye çevirim, tahmin edilen anın gerçek ofsetiyle iki geçişte
 * düzeltiliyor (geçiş gecelerinde bir saatlik sapmayı kapatan kısım budur).
 * Bir sipariş sayfası için 30 KB'lık bir bağımlılık eklemeye değmez.
 */

const TIME_ZONE = "Europe/Berlin";

/** Haftalık çalışma aralığı; `OpeningHour` satırının saf mantığı ilgilendiren kısmı. */
export type OpeningInterval = {
  /** 0 = Pazar … 6 = Cumartesi (JS getDay ile aynı). */
  weekday: number;
  /** Gün başından itibaren dakika (11:00 → 660). */
  openMinute: number;
  /** Açılıştan küçük veya eşitse aralık gece yarısını aşıyor demektir. */
  closeMinute: number;
};

export type TimeSlot = {
  /** Seçimin sunucuya gideceği biçim. */
  iso: string;
  /** "18:45" — işletmenin yerel saatiyle. */
  label: string;
};

export type SlotOptions = {
  hours: OpeningInterval[];
  /** Kapalı günler, "YYYY-MM-DD" (Berlin takvimi). */
  closedDays?: string[];
  now?: Date;
  /**
   * En erken seçilebilir saate kadar bırakılacak süre (dk) — hazırlık payı.
   * Doğrulama tarafı bunu bir kutu küçültür (bkz. `SLOT_MINUTES` notu).
   */
  leadMinutes: number;
  /** Kutu genişliği (dk). */
  slotMinutes?: number;
  /** En fazla kaç kutu üretilsin. */
  maxSlots?: number;
};

/** Varsayılan kutu genişliği: çeyrek saat. */
export const SLOT_MINUTES = 15;

/** Listede gösterilecek en fazla kutu sayısı (bir günlük akşam servisi için fazlasıyla yeterli). */
const MAX_SLOTS = 48;

/* ------------------------------------------------------------ zaman dilimi */

type BerlinParts = { year: number; month: number; day: number; minutes: number; weekday: number };

const WEEKDAYS: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function berlinParts(date: Date): BerlinParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  // 24:00 gece yarısını gösterir; dakika hesabında 0 olmalı.
  const hour = Number(get("hour")) % 24;

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    minutes: hour * 60 + Number(get("minute")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

/** Verilen anda Berlin'in UTC'ye göre ofseti (ms). */
function offsetMs(date: Date): number {
  const p = berlinParts(date);
  const seconds = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, second: "2-digit" })
      .formatToParts(date)
      .find((part) => part.type === "second")?.value ?? "0"
  );
  return Date.UTC(p.year, p.month - 1, p.day, 0, p.minutes, seconds) - date.getTime();
}

/**
 * Berlin duvar saatini gerçek ana (UTC) çevirir.
 *
 * `minutes` 1440'ı aşabilir: gece yarısını aşan bir aralık ertesi günün
 * saatlerini gün başından itibaren dakika olarak taşır ve `Date.UTC` bunu
 * kendiliğinden ertesi güne taşır.
 *
 * İki geçiş: ilk tahminin ofseti yaz saati geçişinin hangi tarafına düştüğüne
 * göre yanlış olabilir; düzeltilmiş anın ofseti farklıysa hesap onunla
 * tekrarlanır.
 */
function berlinToUtc(year: number, month: number, day: number, minutes: number): Date {
  const naive = Date.UTC(year, month - 1, day, 0, minutes);
  const first = new Date(naive - offsetMs(new Date(naive)));
  const corrected = new Date(naive - offsetMs(first));
  return corrected;
}

/** "YYYY-MM-DD" (Berlin takvimi) — kapalı gün karşılaştırması için. */
function isoDate(parts: { year: number; month: number; day: number }): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Bir anın Berlin saatiyle "18:45" gösterimi. */
export function formatSlotLabel(date: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/* ------------------------------------------------------------------ üretim */

type Window = { start: Date; end: Date };

/**
 * Bugünün seçilebilir açılış pencereleri.
 *
 * İki gün taranır: bugünün aralıkları ve **dünden sarkan** aralık. İkincisi
 * gerçek bir durum — 18:00–02:00 çalışan bir dükkânda saat 00:30'da müşteri
 * 01:15'e sipariş verebilmeli; o pencere takvim olarak dünün satırıdır.
 *
 * Kapalı gün kontrolü pencerenin **başladığı** güne bakar: 24 Aralık kapalıysa
 * o akşam başlayan servis hiç açılmaz.
 */
function openWindows(hours: OpeningInterval[], closedDays: string[], now: Date): Window[] {
  const today = berlinParts(now);
  const windows: Window[] = [];

  for (const dayOffset of [-1, 0]) {
    // Dünün takvim tarihini bulmak için gün başına göre 24 saat geri gidilir;
    // ofset farkı `berlinToUtc` tarafından zaten düzeltiliyor.
    const dayStart = berlinToUtc(today.year, today.month, today.day, dayOffset * 1440);
    const day = berlinParts(dayStart);
    if (closedDays.includes(isoDate(day))) continue;

    for (const hour of hours) {
      if (hour.weekday !== day.weekday) continue;

      const wraps = hour.closeMinute <= hour.openMinute;
      // Dünün aralığı yalnızca gece yarısını aşıyorsa bugüne sarkar.
      if (dayOffset === -1 && !wraps) continue;

      const closeMinute = wraps ? hour.closeMinute + 1440 : hour.closeMinute;
      windows.push({
        start: berlinToUtc(day.year, day.month, day.day, hour.openMinute),
        end: berlinToUtc(day.year, day.month, day.day, closeMinute),
      });
    }
  }

  return windows.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Seçilebilir teslim saatleri.
 *
 * Kutular **gün başına göre** hizalanır (…18:00, 18:15, 18:30…), "şimdi"ye
 * göre değil: iki müşterinin iki dakika arayla gördüğü liste aynı saatleri
 * göstermeli, yoksa aynı siparişin doğrulaması sunucuda başka bir ızgaraya
 * düşerdi.
 */
export function buildTimeSlots(options: SlotOptions): TimeSlot[] {
  const now = options.now ?? new Date();
  const slotMinutes = options.slotMinutes ?? SLOT_MINUTES;
  const maxSlots = options.maxSlots ?? MAX_SLOTS;
  const closedDays = options.closedDays ?? [];

  if (slotMinutes <= 0) return [];

  const earliest = now.getTime() + Math.max(0, options.leadMinutes) * 60_000;
  const slots: TimeSlot[] = [];
  const seen = new Set<number>();

  for (const window of openWindows(options.hours, closedDays, now)) {
    const from = Math.max(window.start.getTime(), earliest);
    if (from > window.end.getTime()) continue;

    // Gün başına hizalı ızgarada `from`'dan sonraki ilk kutu.
    const step = slotMinutes * 60_000;
    let cursor = Math.ceil(from / step) * step;

    while (cursor <= window.end.getTime() && slots.length < maxSlots) {
      if (!seen.has(cursor)) {
        seen.add(cursor);
        const date = new Date(cursor);
        slots.push({ iso: date.toISOString(), label: formatSlotLabel(date) });
      }
      cursor += step;
    }

    if (slots.length >= maxSlots) break;
  }

  return slots;
}

/**
 * İstemciden gelen teslim saatinin geçerliliği.
 *
 * Liste sunucuda üretilip istemciye gönderiliyor, ama gelen değer yine de
 * **yeniden üretilen** listeye karşı sınanır: istemciye güvenilmez ve müşteri
 * sayfayı açtıktan sonra kapanış saati panelden değişmiş olabilir.
 *
 * Doğrulamada hazırlık payı bir kutu küçültülür. Sebep somut: müşteri listeyi
 * gördükten sonra formu doldururken birkaç dakika geçiyor ve o sırada en erken
 * kutu ileri kayıyor. Payı kısmadan, ekranda gördüğü ilk saati seçen müşteri
 * "geçersiz saat" hatası alırdı — hiçbir şey yanlış yapmamışken.
 */
export function isSelectableSlot(
  requestedAt: Date,
  options: Omit<SlotOptions, "leadMinutes"> & { leadMinutes: number }
): boolean {
  const slotMinutes = options.slotMinutes ?? SLOT_MINUTES;
  const grace = Math.max(0, options.leadMinutes - slotMinutes);

  const slots = buildTimeSlots({ ...options, leadMinutes: grace });
  const target = requestedAt.getTime();
  return slots.some((slot) => Date.parse(slot.iso) === target);
}
