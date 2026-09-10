import { prisma } from "@/lib/db";
import { paymentProvider } from "@/lib/payments/stripe";
import { sendRefundNotice } from "@/lib/mail/orders";
import type { OrderWithDetails } from "./repository";

/**
 * İade — paranın müşteriye geri döndüğü tek yol.
 *
 * Bu dosyadan önce `stripeProvider.refund()` yazılmıştı ama **hiçbir yerden
 * çağrılmıyordu**: panelden bir sipariş iptal edildiğinde durum `CANCELLED`
 * oluyor, müşteri yemeğini alamıyor ve parası da işletmede kalıyordu. Yasal
 * olarak da savunulamaz, ticari olarak da.
 *
 * Sıra bilinçlidir ve **iade önce yapılır, durum sonra değişir** kuralının
 * tersidir: durum değişimi `transitionOrder` ile ayrı yapılır, iade ondan
 * sonra çağrılır. Sebebi, iki hatanın karşılaştırılması:
 *
 *  - Durum değişti, iade başarısız → sipariş iptal görünür, para dönmemiştir.
 *    Kayıt vardır, `Refund` satırı yoktur, panel bunu gösterir ve elle
 *    tekrar denenebilir.
 *  - İade yapıldı, durum değişmedi → para dönmüştür ama sipariş hâlâ mutfakta
 *    "hazırlanıyor" görünür. Yemek çıkar, parası alınmamıştır.
 *
 * İlki geri döndürülebilir, ikincisi değil.
 *
 * İdempotency: aynı ödeme için `Refund` satırı varsa hiçbir şey yapılmaz.
 * Panelde iki kez tıklanan bir düğme ikinci bir iade tetiklemez.
 */

export type RefundOutcome =
  | { kind: "refunded"; amountCents: number }
  /** Ödeme hiç alınmamış (PENDING_PAYMENT / EXPIRED) — iade edilecek para yok. */
  | { kind: "nothing_to_refund" }
  /** Bu ödeme zaten iade edilmiş. */
  | { kind: "already_refunded"; amountCents: number }
  | { kind: "failed"; message: string };

/**
 * Siparişin ödemesini iade eder.
 *
 * Tutar veritabanındaki `Payment.amountCents`'ten okunur, siparişin
 * toplamından değil: müşteriden gerçekte tahsil edilen tutar budur ve ikisi
 * teorik olarak ayrışabilir (kısmi ödeme, kur farkı, sağlayıcı düzeltmesi).
 * İade edilen para her zaman alınan paradır.
 */
export async function refundOrder(
  order: OrderWithDetails,
  reason: string,
  actor: string
): Promise<RefundOutcome> {
  const payment = await prisma.payment.findFirst({
    where: { orderId: order.id, status: { in: ["PAID", "REFUNDED"] } },
    orderBy: { createdAt: "desc" },
    include: { refunds: { select: { id: true, amountCents: true } } },
  });

  if (!payment) return { kind: "nothing_to_refund" };

  if (payment.refunds.length > 0) {
    const total = payment.refunds.reduce((sum, r) => sum + r.amountCents, 0);
    return { kind: "already_refunded", amountCents: total };
  }

  let result: { providerRef: string; amountCents: number };
  try {
    result = await paymentProvider.refund(payment.providerRef, payment.amountCents);
  } catch (error) {
    /*
     * Sağlayıcı hatası yutulmaz ve yeniden fırlatılmaz: çağıran taraf (panel)
     * bunu kullanıcıya gösterebilmeli ama sipariş iptalinin kendisi geri
     * alınmamalı. Hata metni günlüğe tam, arayüze kısa gider.
     */
    console.error(`[iade] ${order.orderNo} iade edilemedi`, error);
    return {
      kind: "failed",
      message: error instanceof Error ? error.message : "İade sağlayıcıya iletilemedi.",
    };
  }

  /*
   * Kayıt tek işlemde: iade satırı ile ödemenin durumu birlikte yazılır.
   * Yarısı yazılmış bir iade, "para döndü mü?" sorusunu cevapsız bırakır.
   */
  await prisma.$transaction([
    prisma.refund.create({
      data: {
        paymentId: payment.id,
        amountCents: result.amountCents,
        providerRef: result.providerRef,
        reason,
      },
    }),
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: "REFUNDED" },
    }),
    /*
     * Denetim izi. Durum değişimi kendi `OrderEvent` satırını yazıyor; bu ayrı
     * satır "para hareketi" olayıdır — ikisi aynı şey değil ve muhasebe
     * tarafında aranan bu.
     */
    prisma.orderEvent.create({
      data: {
        orderId: order.id,
        from: order.status,
        to: order.status,
        actor,
        meta: {
          event: "refund",
          amountCents: result.amountCents,
          providerRef: result.providerRef,
          reason,
        },
      },
    }),
  ]);

  console.info(`[iade] ${order.orderNo} — ${result.amountCents} cent iade edildi (${actor})`);

  // E-posta akışı bloke etmez: para zaten döndü, bildirim gecikmesi geri
  // döndürülebilir bir sorun.
  await sendRefundNotice(order, result.amountCents, reason);

  return { kind: "refunded", amountCents: result.amountCents };
}
