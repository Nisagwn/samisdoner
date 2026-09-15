import { describe, expect, it } from "vitest";
import { readRecoveryFlag, sharedPasswordMode } from "@/lib/admin/recovery";

/**
 * Ortak parolanın ne zaman çalıştığı.
 *
 * Buradaki asıl iddia olumsuz olanı: sahip hesabı açıldıktan sonra ortak
 * parola **kapanır**. Bu kural unutulursa panelde kimliği olmayan kalıcı bir
 * OWNER girişi kalır ve kimse fark etmez — testin varlık sebebi bu.
 */
describe("ortak parola kipi", () => {
  const base = { activeOwners: 0, recoveryFlag: false, passwordConfigured: true };

  it("hiç sahip hesabı yokken ilk kurulum kipindedir", () => {
    expect(sharedPasswordMode(base)).toBe("setup");
  });

  it("sahip hesabı açılınca kendiliğinden kapanır", () => {
    expect(sharedPasswordMode({ ...base, activeOwners: 1 })).toBe("closed");
  });

  it("birden çok sahip olsa da kapalıdır", () => {
    expect(sharedPasswordMode({ ...base, activeOwners: 3 })).toBe("closed");
  });

  it("kurtarma bayrağı açıkken geçici olarak yeniden açılır", () => {
    expect(sharedPasswordMode({ ...base, activeOwners: 1, recoveryFlag: true })).toBe(
      "recovery"
    );
  });

  it("parola sunucuda tanımlı değilse hiçbir koşulda açılmaz", () => {
    expect(sharedPasswordMode({ ...base, passwordConfigured: false })).toBe("closed");
    expect(
      sharedPasswordMode({
        activeOwners: 0,
        recoveryFlag: true,
        passwordConfigured: false,
      })
    ).toBe("closed");
  });

  it("kurtarma bayrağı, sahip hesabı yokken kipi değiştirmez", () => {
    // İlk kurulum zaten açık; bayrak burada bir şey eklemiyor.
    expect(sharedPasswordMode({ ...base, recoveryFlag: true })).toBe("setup");
  });
});

describe("kurtarma bayrağının okunması", () => {
  it("açık sayılan değerleri tanır", () => {
    for (const value of ["1", "true", "TRUE", " yes ", "Yes"]) {
      expect(readRecoveryFlag(value)).toBe(true);
    }
  });

  it("tanımsız ve kapalı değerleri kapalı sayar", () => {
    for (const value of [undefined, "", " ", "0", "false", "no", "off", "hayır"]) {
      expect(readRecoveryFlag(value)).toBe(false);
    }
  });
});
