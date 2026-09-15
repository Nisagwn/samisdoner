import { describe, expect, it } from "vitest";
import {
  closureWarning,
  formatMinute,
  validateOpeningHours,
  type HourRow,
} from "@/lib/admin/schedule";

/**
 * Çalışma saatleri ve özel kapanış günleri.
 *
 * Bu ekrandaki hata **sessizdir**: yanlış girilmiş bir aralık sipariş almayı
 * durdurur ve kimse "bugün neden sipariş gelmedi" diye çalışma saatlerine
 * bakmaz. Testler bu yüzden kabul edilen hâllere değil, kaydedilmemesi
 * gereken hâllere odaklanıyor.
 */

/** Salı (2) 11:00–15:00. */
const noon: HourRow = { weekday: 2, openMinute: 11 * 60, closeMinute: 15 * 60 };
/** Salı 17:00–22:00 — öğle arası veren bir dükkânın ikinci aralığı. */
const evening: HourRow = { weekday: 2, openMinute: 17 * 60, closeMinute: 22 * 60 };

describe("çalışma saati doğrulaması", () => {
  it("boş tabloyu kabul eder", () => {
    // Hiç saat girilmemiş olması geçerli bir durum: işletme "şimdilik kapalı".
    expect(validateOpeningHours([])).toEqual([]);
  });

  it("aynı gündeki ayrık iki aralığı kabul eder", () => {
    expect(validateOpeningHours([noon, evening])).toEqual([]);
  });

  it("uç uca eklenen aralıkları çakışma saymaz", () => {
    // 11:00–15:00 ile 15:00–21:00 geçerlidir; tam olarak böyle girilir.
    const back = { weekday: 2, openMinute: 15 * 60, closeMinute: 21 * 60 };
    expect(validateOpeningHours([noon, back])).toEqual([]);
  });

  it("aynı gündeki çakışan aralıkları reddeder", () => {
    const overlapping = { weekday: 2, openMinute: 14 * 60, closeMinute: 20 * 60 };
    const problems = validateOpeningHours([noon, overlapping]);
    expect(problems).toHaveLength(1);
    expect(problems[0].index).toBe(1);
    expect(problems[0].message).toContain("Salı");
    expect(problems[0].message).toContain("çakışıyor");
  });

  it("farklı günlerdeki aynı saatleri çakışma saymaz", () => {
    const wednesday = { ...noon, weekday: 3 };
    expect(validateOpeningHours([noon, wednesday])).toEqual([]);
  });

  it("açılış ile kapanışın aynı olmasını reddeder", () => {
    // "Sıfır dakika açık" demek; kullanıcı neredeyse her zaman 24 saat açık
    // kastediyordu ve sonuç tam tersi oluyordu.
    const zero = { weekday: 1, openMinute: 12 * 60, closeMinute: 12 * 60 };
    const problems = validateOpeningHours([zero]);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("Pazartesi");
  });

  it("gece yarısını aşan aralığı kabul eder", () => {
    // 18:00–02:00 geçerlidir ve isOpenNow bunu destekliyor.
    const late = { weekday: 5, openMinute: 18 * 60, closeMinute: 2 * 60 };
    expect(validateOpeningHours([late])).toEqual([]);
  });

  it("gece yarısını aşan aralığın gecedeki kısmındaki çakışmayı yakalar", () => {
    // 18:00–02:00 ile 01:00–03:00 çakışır. Aralık tek parça sayılsaydı bu
    // çakışma görünmezdi — asıl sınanan şey bu.
    const late = { weekday: 5, openMinute: 18 * 60, closeMinute: 2 * 60 };
    const earlyMorning = { weekday: 5, openMinute: 60, closeMinute: 3 * 60 };
    const problems = validateOpeningHours([late, earlyMorning]);
    expect(problems).toHaveLength(1);
    expect(problems[0].index).toBe(1);
  });

  it("geçersiz günü reddeder", () => {
    const problems = validateOpeningHours([{ weekday: 7, openMinute: 600, closeMinute: 1200 }]);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("gün");
  });

  it("gün sınırını aşan dakikayı reddeder", () => {
    const problems = validateOpeningHours([
      { weekday: 1, openMinute: 600, closeMinute: 24 * 60 },
    ]);
    expect(problems).toHaveLength(1);
  });

  it("hatalı satır için ikinci kez çakışma hatası üretmez", () => {
    // Zaten reddedilmiş bir satır için ek hata üretmek listeyi uzatmaktan
    // başka bir işe yaramaz.
    const zero = { weekday: 2, openMinute: 12 * 60, closeMinute: 12 * 60 };
    const problems = validateOpeningHours([zero, noon]);
    expect(problems).toHaveLength(1);
    expect(problems[0].index).toBe(0);
  });
});

describe("özel kapanış çakışması", () => {
  // 2026-09-15 bir Salı.
  const TUESDAY = "2026-09-15";

  it("o gün için girilmiş saatler varsa uyarır", () => {
    const warning = closureWarning(TUESDAY, [noon, evening]);
    expect(warning).not.toBeNull();
    expect(warning!.weekday).toBe(2);
    expect(warning!.ranges).toEqual(["11:00–15:00", "17:00–22:00"]);
  });

  it("o gün zaten kapalıysa uyarmaz", () => {
    // Pazartesi (1) için hiç saat yok; tatil ilan etmek çelişki değil.
    const monday = "2026-09-14";
    expect(closureWarning(monday, [noon, evening])).toBeNull();
  });

  it("hiç saat girilmemişse uyarmaz", () => {
    expect(closureWarning(TUESDAY, [])).toBeNull();
  });

  it("geçersiz tarihte sessizce null döner", () => {
    // Uyarı bir kolaylık; bozuk girdide hata fırlatıp kaydı düşürmesi yanlış
    // olurdu — tarihin kendisini şema zaten doğruluyor.
    expect(closureWarning("bozuk-tarih", [noon])).toBeNull();
  });
});

describe("dakika biçimlendirmesi", () => {
  it("gün başından itibaren dakikayı saate çevirir", () => {
    expect(formatMinute(0)).toBe("00:00");
    expect(formatMinute(11 * 60)).toBe("11:00");
    expect(formatMinute(23 * 60 + 59)).toBe("23:59");
  });

  it("gün sınırını aşan değeri güne indirger", () => {
    expect(formatMinute(24 * 60)).toBe("00:00");
    expect(formatMinute(25 * 60)).toBe("01:00");
  });
});
