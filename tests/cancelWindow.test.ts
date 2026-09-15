import { describe, expect, it } from "vitest";
import {
  CUSTOMER_CANCEL_MINUTES,
  customerCancelWindow,
  type CancelWindowOrder,
} from "@/lib/orders/cancelWindow";
import { ORDER_STATUSES } from "@/lib/orders/status";

/**
 * Müşterinin iptal penceresi.
 *
 * Asıl sınav: pencerenin **kapandığı** durumlar. Açık kalan bir pencere en
 * kötü ihtimalle işletmeye bir telefon ettirir; yanlışlıkla açık kalan bir
 * pencere ise hazırlanmış bir yemeğin parasını iade ettirir.
 */

const PAID_AT = new Date("2026-09-15T18:00:00.000Z");

function order(overrides: Partial<CancelWindowOrder> = {}): CancelWindowOrder {
  return {
    status: "PAID",
    paidAt: PAID_AT,
    requestedAt: null,
    etaMinutes: 40,
    expiresAt: null,
    ...overrides,
  };
}

/** `PAID_AT` üstüne dakika ekler. */
const at = (minutes: number) => new Date(PAID_AT.getTime() + minutes * 60_000);

describe("ödenmemiş sipariş", () => {
  it("ödeme penceresi açıkken iptal edilebilir", () => {
    const result = customerCancelWindow(
      order({ status: "PENDING_PAYMENT", paidAt: null, expiresAt: at(31) }),
      at(5)
    );
    expect(result).toEqual({ ok: true, until: at(31) });
  });

  it("ödeme penceresi kapandıysa iptal edilemez", () => {
    const result = customerCancelWindow(
      order({ status: "PENDING_PAYMENT", paidAt: null, expiresAt: at(31) }),
      at(40)
    );
    expect(result).toEqual({ ok: false, reason: "window_closed" });
  });
});

describe("ödenmiş, henüz onaylanmamış sipariş", () => {
  it("sabit pencere içinde iptal edilebilir", () => {
    const result = customerCancelWindow(order(), at(CUSTOMER_CANCEL_MINUTES - 1));
    expect(result.ok).toBe(true);
  });

  it("pencere dolduktan sonra iptal edilemez", () => {
    const result = customerCancelWindow(order(), at(CUSTOMER_CANCEL_MINUTES + 1));
    expect(result).toEqual({ ok: false, reason: "window_closed" });
  });

  it("pencerenin bitiş anı dahil değildir", () => {
    const result = customerCancelWindow(order(), at(CUSTOMER_CANCEL_MINUTES));
    expect(result).toEqual({ ok: false, reason: "window_closed" });
  });

  it("ödeme anı bilinmiyorsa pencere kapatılmaz", () => {
    const result = customerCancelWindow(order({ paidAt: null }), at(600));
    expect(result).toEqual({ ok: true, until: null });
  });
});

describe("ileri saatli sipariş (Vorbestellung)", () => {
  /** Ödemeden 5 saat sonrasına verilmiş sipariş, 40 dk hazırlık payı. */
  const preOrder = order({ requestedAt: at(300), etaMinutes: 40 });

  it("hazırlık başlamadan çok önce iptal edilebilir", () => {
    const result = customerCancelWindow(preOrder, at(120));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.until).toEqual(at(260)); // 300 − 40
  });

  it("hazırlık başladıktan sonra iptal edilemez", () => {
    const result = customerCancelWindow(preOrder, at(270));
    expect(result).toEqual({ ok: false, reason: "window_closed" });
  });

  it("yakın saatli ön siparişte sabit pencere korunur", () => {
    // Teslim 15 dk sonrasına istenmiş; 15 − 40 geçmişte kalır, ama müşteri
    // yine de sabit 10 dakikalık hakkını kullanabilmeli.
    const result = customerCancelWindow(order({ requestedAt: at(15), etaMinutes: 40 }), at(5));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.until).toEqual(at(CUSTOMER_CANCEL_MINUTES));
  });

  it("tahmini süre yoksa varsayılan hazırlık payı kullanılır", () => {
    const result = customerCancelWindow(order({ requestedAt: at(300), etaMinutes: null }), at(120));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.until).toEqual(at(270)); // 300 − 30
  });
});

describe("mutfağın üstlendiği sipariş", () => {
  for (const status of ["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] as const) {
    it(`${status}: iptal müşteriden değil işletmeden geçer`, () => {
      const result = customerCancelWindow(order({ status }), at(1));
      expect(result).toEqual({ ok: false, reason: "already_accepted" });
    });
  }
});

describe("kapanmış sipariş", () => {
  for (const status of ["DELIVERED", "PICKED_UP", "CANCELLED", "REJECTED", "EXPIRED"] as const) {
    it(`${status}: iptal edilecek bir şey yok`, () => {
      expect(customerCancelWindow(order({ status }), at(1))).toEqual({
        ok: false,
        reason: "terminal",
      });
    });
  }

  /*
   * Şemaya yeni bir durum eklendiğinde bu test konuşur: kapsanmamış durum
   * varsayılan dala düşer ve orada "iptal edilemez" der. Sessiz kalan bir
   * varsayılan, bir gün iptal edilebilir olması gereken bir durumu kilitler.
   */
  it("her sipariş durumu bilinçli olarak ele alınmıştır", () => {
    const handled = new Set([
      "PENDING_PAYMENT",
      "PAID",
      "ACCEPTED",
      "PREPARING",
      "READY",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "PICKED_UP",
      "CANCELLED",
      "REJECTED",
      "EXPIRED",
    ]);
    for (const status of ORDER_STATUSES) expect(handled.has(status)).toBe(true);
    expect(handled.size).toBe(ORDER_STATUSES.length);
  });
});
