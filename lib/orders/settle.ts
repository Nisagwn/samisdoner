import type { Prisma } from "@prisma/client";
import { sendNewOrderNotification, sendOrderConfirmation } from "@/lib/mail/orders";
import { markOrderPaid, type OrderWithDetails } from "./repository";

/**
 * Ödemesi doğrulanmış siparişi kapatan **tek** yol.
 *
 * İki farklı kaynak aynı sonuca varır: Stripe webhook'u ve müşteri ödeme
 * sayfasından döndüğünde yapılan mutabakat (bkz. `reconcileOrderPayment`).
 * İkisi de buradan geçer; aksi hâlde "webhook'la gelen sipariş mail atıyor,
 * mutabakatla gelen atmıyor" gibi kaynağa göre değişen davranışlar doğardı.
 *
 * İdempotency `markOrderPaid` içinde, veritabanı işlemi seviyesinde çözülür:
 * sipariş zaten PENDING_PAYMENT değilse hiçbir şey yazılmaz. Bildirimler de bu
 * yüzden yalnızca ilk kapanışta gider — mutfak aynı siparişi iki kez basmaz,
 * müşteri iki onay maili almaz.
 */
export async function settleOrderPayment(input: {
  orderNo: string;
  provider: string;
  providerRef: string;
  amountCents: number;
  method: string | null;
  email?: string;
  raw?: Prisma.InputJsonValue;
  /** Olay geçmişine yazılacak kaynak: "stripe" (webhook) veya "stripe:sync". */
  source: string;
}): Promise<{ order: OrderWithDetails; alreadyPaid: boolean }> {
  const { order, alreadyPaid } = await markOrderPaid({
    orderNo: input.orderNo,
    provider: input.provider,
    providerRef: input.providerRef,
    amountCents: input.amountCents,
    method: input.method,
    email: input.email,
    raw: input.raw,
    // Kaynak denetim izine yazılır; günlükte kalması yetmiyordu.
    actor: input.source,
  });

  if (alreadyPaid) {
    console.info(`[${input.source}] ${order.orderNo} zaten ödenmiş, bildirim atlandı.`);
    return { order, alreadyPaid };
  }

  console.info(
    `[order] ${order.orderNo} ödendi (${input.source}) — ${order.lines.length} satır, ${order.totalCents} cent`
  );

  // E-posta gönderimi siparişi bloke etmez; hatası içeride yutulur.
  await Promise.all([sendNewOrderNotification(order), sendOrderConfirmation(order)]);
  return { order, alreadyPaid };
}
