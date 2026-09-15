import { describe, expect, it } from "vitest";
import {
  formatMinute,
  formatRange,
  hoursForWeekday,
  nextOpening,
  type LocalNow,
  type OpeningHour,
} from "@/lib/menu/opening";

/**
 * Kapalıyken gösterilen "ne zaman açılıyoruz" bilgisi.
 *
 * Yanlış bir saat, müşterinin boşuna beklemesi ya da boşuna yola çıkması
 * demek — bu yüzden gün sınırı, tatil günü ve "bugün artık geçti" halleri
 * ayrı ayrı sınanıyor.
 */

/** Pzt–Cmt 11:00–21:00, Pazar 12:00–21:00. */
const HOURS: OpeningHour[] = [
  ...[1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, openMinute: 660, closeMinute: 1260 })),
  { weekday: 0, openMinute: 720, closeMinute: 1260 },
];

/** 2026-09-15 bir Salı. */
const tuesday = (minutes: number): LocalNow => ({ weekday: 2, minutes, isoDate: "2026-09-15" });

describe("saat biçimi", () => {
  it("dakikayı saat:dakika yazar", () => {
    expect(formatMinute(660)).toBe("11:00");
    expect(formatMinute(1275)).toBe("21:15");
    expect(formatMinute(0)).toBe("00:00");
  });

  it("aralığı tire ile yazar", () => {
    expect(formatRange({ weekday: 2, openMinute: 660, closeMinute: 1260 })).toBe("11:00 – 21:00");
  });
});

describe("günün aralıkları", () => {
  it("yalnızca o günü verir", () => {
    expect(hoursForWeekday(HOURS, 0)).toEqual([{ weekday: 0, openMinute: 720, closeMinute: 1260 }]);
  });

  it("öğle arası olan günde aralıkları açılışa göre sıralar", () => {
    const split: OpeningHour[] = [
      { weekday: 3, openMinute: 990, closeMinute: 1365 },
      { weekday: 3, openMinute: 660, closeMinute: 840 },
    ];
    expect(hoursForWeekday(split, 3).map((h) => h.openMinute)).toEqual([660, 990]);
  });

  it("kapalı günde boş liste döner", () => {
    expect(hoursForWeekday([], 4)).toEqual([]);
  });
});

describe("bir sonraki açılış", () => {
  it("sabah erkenken bugünü gösterir", () => {
    // Salı 09:00 — bugünün 11:00 açılışı henüz gelmedi.
    expect(nextOpening(HOURS, [], tuesday(540))).toEqual({
      weekday: 2,
      minute: 660,
      daysAhead: 0,
    });
  });

  it("gün içinde açılış geçtiyse yarına atlar", () => {
    // Salı 22:00 — bugünün açılışı geçti, sıradaki Çarşamba.
    expect(nextOpening(HOURS, [], tuesday(1320))).toEqual({
      weekday: 3,
      minute: 660,
      daysAhead: 1,
    });
  });

  it("tam açılış dakikasında bugünü değil sonrakini verir", () => {
    // 11:00'de zaten açığız; "bugün 11:00'de açılıyoruz" demek yanlış olurdu.
    expect(nextOpening(HOURS, [], tuesday(660))?.daysAhead).toBe(1);
  });

  it("tatil gününü atlar", () => {
    // Çarşamba (2026-09-16) kapalı → Perşembe.
    const result = nextOpening(HOURS, ["2026-09-16"], tuesday(1320));
    expect(result).toEqual({ weekday: 4, minute: 660, daysAhead: 2 });
  });

  it("ay sınırını doğru aşar", () => {
    // 30 Eylül 2026 Çarşamba, saat 23:00 → 1 Ekim Perşembe.
    const result = nextOpening(HOURS, [], { weekday: 3, minutes: 1380, isoDate: "2026-09-30" });
    expect(result).toEqual({ weekday: 4, minute: 660, daysAhead: 1 });
  });

  it("hiç çalışma saati yoksa null döner", () => {
    expect(nextOpening([], [], tuesday(540))).toBeNull();
  });

  it("iki hafta boyunca kapalıysa null döner", () => {
    const allClosed = Array.from({ length: 14 }, (_, i) =>
      new Date(Date.UTC(2026, 8, 15 + i)).toISOString().slice(0, 10)
    );
    expect(nextOpening(HOURS, allClosed, tuesday(540))).toBeNull();
  });
});
