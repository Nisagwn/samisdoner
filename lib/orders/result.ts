import type { RejectionReason } from "./availability";
import type { CouponRejection } from "./coupon";

/**
 * Sipariş oluşturmanın sonucu.
 *
 * Hatalar **fırlatılmaz, döndürülür**: müşteriye gösterilecek her durum
 * (kapalıyız, bölge dışı, sepet eşiği) normal bir akıştır, istisna değil.
 * Böylece arayüz tarafında her durum tip düzeyinde ele alınmak zorunda kalır.
 */

export type OrderError =
  /** Zod doğrulaması düştü; `field` formda hangi alanın işaretleneceğini söyler. */
  | { code: "invalid_input"; field?: string; message: string }
  | { code: "empty_cart" }
  /** Ürün sipariş sırasında menüden kalkmış. */
  | { code: "unavailable_items"; items: string[] }
  /** Ödeme oturumu açılamadı (sağlayıcı hatası, eksik anahtar). */
  | { code: "payment_unavailable" }
  /** Seçilen ödeme yöntemi şu an kapalı (ör. kapıda ödeme kapatılmış). */
  | { code: "payment_method_unavailable"; paymentMethod: "CASH" | "CARD_ON_DELIVERY" | "ONLINE" }
  /**
   * Kupon sipariş yazılırken elden kaçtı: müşteri kodu girdiğinde geçerliydi,
   * son kullanım hakkı aradan geçen saniyelerde başkasına gitti.
   */
  | { code: "coupon_gone" }
  /** Aynı kaynaktan çok sayıda sipariş denemesi; `retryAfterSeconds` sonra tekrar. */
  | { code: "too_many_requests"; retryAfterSeconds: number }
  | RejectionReason
  | CouponRejection;

export type CreateOrderResult =
  | { ok: true; orderNo: string; checkoutUrl: string }
  | { ok: false; error: OrderError };
