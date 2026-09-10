import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, canTransition, isTerminal, needsRefund } from "@/lib/orders/status";

/**
 * İade durum makinesi.
 *
 * `needsRefund` bu dosyadan önce yazılıydı ama **hiçbir yerden
 * çağrılmıyordu**: panelden iptal edilen siparişte durum değişiyor, müşteri
 * yemeğini alamıyor ve parası işletmede kalıyordu. Artık iptal/ret geçişinde
 * çağrılıyor, dolayısıyla ölçütünün doğruluğu para meselesi.
 *
 * Ölçüt geçişin **kaynağıdır**, hedefi değil: iade edilip edilmeyeceğine
 * siparişin iptal edilmeden önceki durumu karar verir. `PENDING_PAYMENT` ve
 * `EXPIRED` dışındaki her durumda ödeme alınmıştır.
 */

describe("needsRefund", () => {
  it("ödeme alınmamış durumlarda iade istemez", () => {
    // Bu ikisinde Stripe'a gitmenin karşılığı yok: ortada tahsilat yok.
    expect(needsRefund("PENDING_PAYMENT")).toBe(false);
    expect(needsRefund("EXPIRED")).toBe(false);
  });

  it("ödeme alınmış her durumda iade ister", () => {
    for (const status of ["PAID", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] as const) {
      expect(needsRefund(status)).toBe(true);
    }
  });

  it("PENDING_PAYMENT ve EXPIRED dışında istisna yoktur", () => {
    // Yeni bir durum eklendiğinde bu test onu görünür kılar: varsayılan
    // "iade et" tarafındadır ve sessizce para tutmaya kaymaz.
    const noRefund = ORDER_STATUSES.filter((status) => !needsRefund(status));
    expect([...noRefund].sort()).toEqual(["EXPIRED", "PENDING_PAYMENT"]);
  });
});

describe("iptal geçişleri", () => {
  it("ödeme beklerken iptal edilebilir ama iade yapılmaz", () => {
    expect(canTransition("PENDING_PAYMENT", "CANCELLED", "DELIVERY")).toBe(true);
    expect(needsRefund("PENDING_PAYMENT")).toBe(false);
  });

  it("mutfaktaki sipariş iptal edilirse iade gerekir", () => {
    expect(canTransition("PREPARING", "CANCELLED", "DELIVERY")).toBe(true);
    expect(needsRefund("PREPARING")).toBe(true);
  });

  it("teslim edilmiş sipariş iptal edilemez", () => {
    // İade akışının hiç tetiklenmemesi gereken yer: yemek gitti.
    expect(canTransition("DELIVERED", "CANCELLED", "DELIVERY")).toBe(false);
    expect(isTerminal("DELIVERED")).toBe(true);
  });

  it("iptal edilmiş sipariş yeniden iptal edilemez", () => {
    // Panelde iki kez tıklanan düğme ikinci bir iade tetiklemesin diye ilk
    // savunma budur; ikincisi `refundOrder` içindeki idempotency kontrolü.
    expect(canTransition("CANCELLED", "CANCELLED", "DELIVERY")).toBe(false);
    expect(canTransition("CANCELLED", "REJECTED", "DELIVERY")).toBe(false);
  });

  it("süresi dolan sipariş nihaidir", () => {
    expect(isTerminal("EXPIRED")).toBe(true);
  });
});
