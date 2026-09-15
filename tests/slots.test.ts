import { describe, expect, it } from "vitest";
import { buildTimeSlots, isSelectableSlot, type OpeningInterval } from "@/lib/orders/slots";

/**
 * Vorbestellung zaman aralıkları.
 *
 * Üretim ve doğrulama **aynı fonksiyondan** geçtiği için testlerin çoğu tek
 * bir soruyu soruyor: listede görünen bir saat sunucuda kabul ediliyor mu, ve
 * listede olmayan bir saat reddediliyor mu. Ayrışırlarsa ya müşteri kendi
 * seçtiği saatte hata alır ya da kapalı bir saate sipariş geçer.
 *
 * Saatler Europe/Berlin'e göre okunur; testler bilinçli olarak yaz saati
 * (CEST, UTC+2) ve kış saati (CET, UTC+1) dönemlerinin ikisinde de çalışıyor.
 */

/** Her gün 11:00–22:00 açık. */
const daily: OpeningInterval[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  openMinute: 11 * 60,
  closeMinute: 22 * 60,
}));

/** 15 Eylül 2026, Salı. Berlin yaz saati (UTC+2) → yerel 14:00. */
const TUESDAY_NOON = new Date("2026-09-15T12:00:00.000Z");

const labels = (slots: { label: string }[]) => slots.map((s) => s.label);

describe("buildTimeSlots — ızgara", () => {
  it("hazırlık payından sonraki ilk çeyrek saatten başlar", () => {
    // Yerel 14:00 + 30 dk pay = 14:30 → ilk kutu 14:30.
    const slots = buildTimeSlots({ hours: daily, now: TUESDAY_NOON, leadMinutes: 30 });
    expect(labels(slots)[0]).toBe("14:30");
    expect(labels(slots)[1]).toBe("14:45");
  });

  it("kutular gün başına hizalıdır, 'şimdi'ye göre kaymaz", () => {
    // Yerel 14:07 + 30 dk = 14:37 → yukarı yuvarlanıp 14:45.
    const slots = buildTimeSlots({
      hours: daily,
      now: new Date("2026-09-15T12:07:00.000Z"),
      leadMinutes: 30,
    });
    expect(labels(slots)[0]).toBe("14:45");
  });

  it("kapanış saatinden sonrasını önermez", () => {
    const slots = buildTimeSlots({ hours: daily, now: TUESDAY_NOON, leadMinutes: 30, maxSlots: 999 });
    expect(labels(slots).at(-1)).toBe("22:00");
    expect(labels(slots)).not.toContain("22:15");
  });

  it("kapalı gün hiç aralık üretmez", () => {
    const slots = buildTimeSlots({
      hours: daily,
      closedDays: ["2026-09-15"],
      now: TUESDAY_NOON,
      leadMinutes: 30,
    });
    expect(slots).toHaveLength(0);
  });

  it("kapanıştan sonra bugün için aralık kalmaz", () => {
    // Yerel 23:00 — dükkân 22:00'de kapandı, sarkan aralık da yok.
    const slots = buildTimeSlots({
      hours: daily,
      now: new Date("2026-09-15T21:00:00.000Z"),
      leadMinutes: 30,
    });
    expect(slots).toHaveLength(0);
  });

  it("açılıştan önce sipariş verilirse ilk kutu açılış saatidir", () => {
    // Yerel 09:00; dükkân 11:00'de açılıyor.
    const slots = buildTimeSlots({
      hours: daily,
      now: new Date("2026-09-15T07:00:00.000Z"),
      leadMinutes: 30,
    });
    expect(labels(slots)[0]).toBe("11:00");
  });

  it("kış saatinde de yerel saate göre çalışır", () => {
    // 15 Aralık 2026, Salı. Berlin kış saati (UTC+1) → yerel 14:00.
    const slots = buildTimeSlots({
      hours: daily,
      now: new Date("2026-12-15T13:00:00.000Z"),
      leadMinutes: 30,
    });
    expect(labels(slots)[0]).toBe("14:30");
  });

  it("maxSlots listeyi sınırlar", () => {
    const slots = buildTimeSlots({ hours: daily, now: TUESDAY_NOON, leadMinutes: 30, maxSlots: 4 });
    expect(slots).toHaveLength(4);
  });
});

describe("buildTimeSlots — gece yarısını aşan servis", () => {
  /** Salı 18:00 → Çarşamba 02:00. */
  const lateNight: OpeningInterval[] = [
    { weekday: 2, openMinute: 18 * 60, closeMinute: 2 * 60 },
  ];

  it("kapanış ertesi güne sarkar", () => {
    const slots = buildTimeSlots({
      hours: lateNight,
      now: new Date("2026-09-15T19:00:00.000Z"), // yerel Salı 21:00
      leadMinutes: 30,
      maxSlots: 999,
    });
    expect(labels(slots)[0]).toBe("21:30");
    expect(labels(slots).at(-1)).toBe("02:00");
  });

  it("gece yarısından sonra hâlâ dünün penceresinden sipariş alınır", () => {
    // Yerel Çarşamba 00:30; açık olan aralık Salı'nın sarkan penceresi.
    const slots = buildTimeSlots({
      hours: lateNight,
      now: new Date("2026-09-15T22:30:00.000Z"),
      leadMinutes: 30,
      maxSlots: 999,
    });
    expect(labels(slots)[0]).toBe("01:00");
    expect(labels(slots).at(-1)).toBe("02:00");
  });
});

describe("isSelectableSlot", () => {
  it("listedeki her saati kabul eder", () => {
    const slots = buildTimeSlots({ hours: daily, now: TUESDAY_NOON, leadMinutes: 30 });
    for (const slot of slots) {
      expect(
        isSelectableSlot(new Date(slot.iso), { hours: daily, now: TUESDAY_NOON, leadMinutes: 30 })
      ).toBe(true);
    }
  });

  it("ızgaraya oturmayan saati reddeder", () => {
    expect(
      isSelectableSlot(new Date("2026-09-15T12:37:00.000Z"), {
        hours: daily,
        now: TUESDAY_NOON,
        leadMinutes: 30,
      })
    ).toBe(false);
  });

  it("kapalı saate verilen siparişi reddeder", () => {
    // Yerel 23:30 — ızgarada ama dükkân kapalı.
    expect(
      isSelectableSlot(new Date("2026-09-15T21:30:00.000Z"), {
        hours: daily,
        now: TUESDAY_NOON,
        leadMinutes: 30,
      })
    ).toBe(false);
  });

  it("geçmiş saati reddeder", () => {
    expect(
      isSelectableSlot(new Date("2026-09-15T10:00:00.000Z"), {
        hours: daily,
        now: TUESDAY_NOON,
        leadMinutes: 30,
      })
    ).toBe(false);
  });

  it("kapalı güne verilen siparişi reddeder", () => {
    expect(
      isSelectableSlot(new Date("2026-09-15T16:00:00.000Z"), {
        hours: daily,
        closedDays: ["2026-09-15"],
        now: TUESDAY_NOON,
        leadMinutes: 30,
      })
    ).toBe(false);
  });

  /*
   * Bir kutuluk pay: müşteri listeyi gördükten sonra formu doldururken
   * dakikalar geçiyor ve en erken kutu ileri kayıyor. Ekranda gördüğü ilk
   * saati seçen müşteri, hiçbir şey yanlış yapmamışken hata almamalı.
   */
  it("müşteri formu doldururken kayan ilk kutuyu yine de kabul eder", () => {
    const listedAt = TUESDAY_NOON;
    const first = buildTimeSlots({ hours: daily, now: listedAt, leadMinutes: 30 })[0];

    // Müşteri 10 dakika sonra gönderiyor; artık en erken kutu 14:45 olurdu.
    const submittedAt = new Date(listedAt.getTime() + 10 * 60_000);
    expect(
      isSelectableSlot(new Date(first.iso), { hours: daily, now: submittedAt, leadMinutes: 30 })
    ).toBe(true);
  });
});
