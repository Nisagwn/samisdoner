import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendOrderStatusUpdate } from "@/lib/mail/orders";
import { customerCancelWindow } from "./cancelWindow";
import { refundOrder, type RefundOutcome } from "./refund";
import { getOrderByNo, transitionOrder, type OrderWithDetails } from "./repository";
import { needsRefund } from "./status";

/**
 * Siparişin durumunu ilerleten **tek** yol.
 *
 * `transitionOrder` yalnızca kaydı yazar; bir durum değişiminin gerçek hayatta
 * üç sonucu var ve üçü de her zaman birlikte olmalı:
 *
 *   1. Kayıt (durum + OrderEvent) — `transitionOrder`.
 *   2. Müşteriye bildirim — "siparişiniz alındı", "kurye yolda", "teslim edildi".
 *   3. İptal/ret hâlinde paranın iadesi.
 *
 * Bu üçü çağıran tarafa bırakılırsa, panelden iptal eden mutfak iadeyi
 * tetikler ama müşterinin kendi iptali tetiklemez; ya da tersi. Tek kapı
 * olması, "hangi yoldan iptal edildi" sorusunun davranışı değiştirmemesini
 * sağlıyor.
 *
 * SIRA
 *
 * Durum **önce** yazılır, iade **sonra** yapılır. Gerekçe `lib/orders/refund.ts`
 * içinde uzun uzun yazılı; özeti, "iptal edildi ama para dönmedi" geri
 * döndürülebilir bir hatadır, "para döndü ama yemek yola çıktı" değildir.
 */

export type AdvanceResult = {
  order: OrderWithDetails;
  /** İade denendiyse sonucu; denenmediyse null. */
  refund: RefundOutcome | null;
};

export async function advanceOrder(
  orderId: string,
  to: OrderStatus,
  actor: string,
  options: { reason?: string } = {}
): Promise<AdvanceResult> {
  const before = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true },
  });
  if (!before) throw new Error("Sipariş bulunamadı.");

  const order = await transitionOrder(orderId, to, actor, {
    ...(options.reason ? { reason: options.reason, meta: { cancelReason: options.reason } } : {}),
  });

  /*
   * Bildirim akışı bloke etmez: durum zaten yazıldı, e-posta gecikmesi geri
   * döndürülebilir bir sorun. Hata `sendOrderStatusUpdate` içinde yutuluyor.
   */
  await sendOrderStatusUpdate(order);

  const cancelling = to === "CANCELLED" || to === "REJECTED";
  if (!cancelling) return { order, refund: null };

  /*
   * `needsRefund` ödeme alınmamış durumları eler ve ölçüt geçişin
   * **kaynağıdır**, hedefi değil: PENDING_PAYMENT ya da EXPIRED'dan iptale
   * gidiliyorsa ortada tahsil edilmiş para yok.
   *
   * Kapıda ödemeli sipariş de buraya düşer ama sağlayıcıya hiç gitmez:
   * `refundOrder` ödenmiş bir `Payment` satırı bulamaz ve "iade edilecek para
   * yok" der — doğru cevap, çünkü para hiç alınmadı.
   */
  if (!needsRefund(before.status)) return { order, refund: { kind: "nothing_to_refund" } };

  const refund = await refundOrder(order, options.reason ?? "", actor);
  return { order, refund };
}

/* ------------------------------------------------- müşterinin kendi iptali */

export type CustomerCancelResult =
  | { ok: true; status: OrderStatus; refund: RefundOutcome | null }
  | { ok: false; reason: "not_found" | "already_accepted" | "window_closed" | "terminal" }
  /** İptal oldu ama para dönmedi; müşteri bunu görmeli, işletme de. */
  | { ok: false; reason: "refund_failed"; message: string };

/**
 * Müşterinin kendi siparişini iptal etmesi.
 *
 * Pencerenin ne zaman açık olduğu `lib/orders/cancelWindow.ts` içinde ve saf
 * mantık olarak yazılı. Burada yalnızca o karara uyulur — arayüz düğmeyi
 * gizlese bile karar sunucuda verilmeli, gizlenmiş bir düğme yetki kontrolü
 * değildir.
 *
 * İptal sebebi sabit: `CUSTOMER_REQUEST`. Müşteriye gösterilecek cümle
 * `describeCancelReason` üzerinden kendi dilinde üretilir, dolayısıyla burada
 * serbest metin yazmaya gerek yok.
 */
export async function cancelOrderByCustomer(orderNo: string): Promise<CustomerCancelResult> {
  const order = await getOrderByNo(orderNo);
  if (!order) return { ok: false, reason: "not_found" };

  const window = customerCancelWindow(order);
  if (!window.ok) return { ok: false, reason: window.reason };

  const { order: cancelled, refund } = await advanceOrder(
    order.id,
    "CANCELLED",
    "customer",
    { reason: "CUSTOMER_REQUEST" }
  );

  if (refund?.kind === "failed") {
    /*
     * Sipariş iptal edildi ama iade sağlayıcıya iletilemedi. Müşteriye "oldu"
     * demek yanlış olurdu: parası dönmedi ve bunu bilmeli. Kayıt panelde
     * iade satırı olmadan duruyor, elle tekrar denenebilir.
     */
    return { ok: false, reason: "refund_failed", message: refund.message };
  }

  return { ok: true, status: cancelled.status, refund };
}
