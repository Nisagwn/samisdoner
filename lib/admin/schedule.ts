/**
 * Çalışma saati ve özel kapanış kurallarının doğrulanması.
 *
 * Panel bu ekranı "haftada birkaç kez bakılan bir ayar" gibi davranıyordu:
 * satırlar olduğu gibi kaydediliyor, tutarsızlıklar ancak bir müşteri sipariş
 * veremediğinde ortaya çıkıyordu. Oysa bu ekrandaki bir hata sessizdir —
 * kimse "bugün neden sipariş gelmedi" diye ekrana bakmaz.
 *
 * Bu dosyada veritabanı yok: kurallar saf ve sınanabilir. `isOpenNow` ile de
 * aynı zaman modelini paylaşır — gün başından itibaren dakika, gece yarısını
 * aşan aralık desteklenir (18:00–02:00 geçerlidir).
 */

export type HourRow = {
  /** 0 = Pazar … 6 = Cumartesi (JS getDay ile aynı). */
  weekday: number;
  openMinute: number;
  closeMinute: number;
};

const DAY_MINUTES = 24 * 60;

/** Panelde görünen gün adları; hata mesajı "3. gün" değil "Çarşamba" demeli. */
export const WEEKDAY_NAMES = [
  "Pazar",
  "Pazartesi",
  "Salı",
  "Çarşamba",
  "Perşembe",
  "Cuma",
  "Cumartesi",
] as const;

/** "660" → "11:00". */
export function formatMinute(minute: number): string {
  const normalized = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const h = String(Math.floor(normalized / 60)).padStart(2, "0");
  const m = String(normalized % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Bir aralığın kapladığı dakikalar.
 *
 * Gece yarısını aşan aralık (18:00–02:00) tek bir aralık olarak
 * temsil edilemez; iki parçaya ayrılır: [1080, 1440) ve [0, 120). Çakışma
 * kontrolü bu parçalar üzerinden yapılır, aksi hâlde "18:00–02:00" ile
 * "01:00–03:00" çakışmıyor görünürdü.
 */
function segments(row: HourRow): [number, number][] {
  if (row.closeMinute > row.openMinute) return [[row.openMinute, row.closeMinute]];
  // Gece yarısını aşıyor: gecenin kalanı ertesi güne taşar.
  return [
    [row.openMinute, DAY_MINUTES],
    [0, row.closeMinute],
  ];
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  // Uç uca eklenen aralıklar çakışmaz: 11:00–15:00 ile 15:00–21:00 geçerlidir
  // ve öğle arası veren bir dükkânda tam olarak böyle girilir.
  return a[0] < b[1] && b[0] < a[1];
}

export type ScheduleProblem = {
  /** Sorunun hangi satırla ilgili olduğu; arayüz satırı işaretleyebilsin. */
  index: number;
  message: string;
};

/**
 * Haftalık saat tablosunu doğrular.
 *
 * Üç şeye bakılır ve üçü de sessiz arıza üretebilecek türden:
 *
 *  1. **Geçersiz gün / dakika.** Elle düzenlenmiş bir istekten gelebilir.
 *  2. **Sıfır uzunlukta aralık** (açılış = kapanış). "Sıfır dakika açık"
 *     demek; kullanıcı neredeyse her zaman 24 saat açık kastediyordu ve
 *     sonuç tam tersi oluyordu.
 *  3. **Aynı gün içinde çakışan aralıklar.** Çakışan iki aralık
 *     `isOpenNow`'u bozmaz ama tabloyu okunamaz kılar ve "öğle arası
 *     koydum ama hâlâ açık görünüyor" şikâyetinin kaynağıdır.
 */
export function validateOpeningHours(rows: HourRow[]): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];

  rows.forEach((row, index) => {
    if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6) {
      problems.push({ index, message: "Geçersiz gün." });
      return;
    }
    const valid = (value: number) =>
      Number.isInteger(value) && value >= 0 && value < DAY_MINUTES;
    if (!valid(row.openMinute) || !valid(row.closeMinute)) {
      problems.push({ index, message: "Saat 00:00 ile 23:59 arasında olmalı." });
      return;
    }
    if (row.openMinute === row.closeMinute) {
      problems.push({
        index,
        message: `${WEEKDAY_NAMES[row.weekday]}: açılış ve kapanış saati aynı olamaz.`,
      });
    }
  });

  // Çakışma kontrolü yalnızca kendi içinde geçerli satırlar arasında yapılır:
  // zaten hatalı bir satır için ikinci bir hata üretmek kullanıcıya yardım
  // etmez, yalnızca listeyi uzatır.
  const usable = rows
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => !problems.some((problem) => problem.index === index));

  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const a = usable[i];
      const b = usable[j];
      if (a.row.weekday !== b.row.weekday) continue;

      const clash = segments(a.row).some((first) =>
        segments(b.row).some((second) => overlaps(first, second))
      );
      if (clash) {
        problems.push({
          index: b.index,
          message: `${WEEKDAY_NAMES[b.row.weekday]}: ${formatMinute(
            b.row.openMinute
          )}–${formatMinute(b.row.closeMinute)} aralığı ${formatMinute(
            a.row.openMinute
          )}–${formatMinute(a.row.closeMinute)} ile çakışıyor.`,
        });
      }
    }
  }

  return problems;
}

/**
 * Özel kapanış günü, o gün için girilmiş saatlerle çelişiyor mu.
 *
 * Teknik olarak çelişki değil — kapanış her zaman saatleri ezer
 * (bkz. isOpenNow). Ama işletmeci "Pazartesi 11:00–21:00" yazıp aynı günü
 * tatil ilan ettiyse ikisinden biri yanlıştır ve bunu **kaydetmeden önce**
 * söylemek, o günün siparişsiz geçmesinden iyidir.
 *
 * Uyarı döner, hata değil: kapanış bilinçli olabilir (bayram). Karar
 * kullanıcının.
 */
export function closureWarning(
  isoDate: string,
  rows: HourRow[]
): { weekday: number; ranges: string[] } | null {
  // "2026-12-25" → o günün haftagünü. UTC ile okunuyor: tarih zaten yerel gün
  // olarak seçildi, saat dilimi çevirimi burada bir gün kaydırma riski.
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  const weekday = parsed.getUTCDay();
  const ranges = rows
    .filter((row) => row.weekday === weekday)
    .map((row) => `${formatMinute(row.openMinute)}–${formatMinute(row.closeMinute)}`);

  return ranges.length > 0 ? { weekday, ranges } : null;
}
