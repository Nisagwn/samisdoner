import { prisma } from "@/lib/db";

/**
 * Siparişi kabul ederken hazırlık süresini seçmek.
 *
 * Söz verilen teslim saati (`Order.promisedAt`) ödeme onaylandığı an
 * `paidAt + etaMinutes` ile dondurulur. Bu iyi bir varsayılan ama bir
 * **tahmindir**: mutfak siparişi gördüğünde gerçeği bilir — tezgâh boşsa on
 * beş dakika, cumartesi akşamı kırk beş.
 *
 * Panelde bunu söylemenin tek yolu şimdiye kadar "gecikme bildir" idi ve o
 * yalnızca ileri iter (+5/+10/+15). Erken biteceği belli olan bir siparişi
 * öne çekmek ya da baştan doğru saati vermek mümkün değildi; sonuç, müşterinin
 * takip sayfasında hiçbir zaman doğru olmayan bir saat görmesiydi.
 *
 * Burada saat **şu andan itibaren** kurulur, mevcut sözün üstüne eklenmez:
 * "yirmi dakikaya hazır" cümlesinin başlangıcı siparişin alındığı an değil,
 * kabul edildiği andır.
 *
 * Değişiklik `OrderEvent`'e yazılır. Sipariş kayıtları append-only: müşteriye
 * verilen sözün ne zaman ve kim tarafından değiştirildiği sorusunun cevabı
 * kayıtta durmak zorunda — "saat neden kaydı?" sorusu er geç sorulur.
 */

/** Panelde tek dokunuşla seçilebilen hazırlık süreleri (dakika). */
export const PREP_CHOICES = [15, 20, 30, 45, 60] as const;

export type PrepChoice = (typeof PREP_CHOICES)[number];

export function isPrepChoice(value: unknown): value is PrepChoice {
  return typeof value === "number" && (PREP_CHOICES as readonly number[]).includes(value);
}

/**
 * Teslim saatini şu andan itibaren `minutes` dakikaya kurar.
 *
 * Sipariş bulunamazsa `null` döner; çağıran taraf 404 ile karşılar. Durum
 * değiştirmez — bunu yapan `transitionOrder`'dır ve iki işi tek fonksiyona
 * yığmak, "kabul et" ile "saati düzelt" eylemlerini birbirine bağlardı.
 */
export async function setPromiseFromNow(
  orderId: string,
  minutes: number,
  actor: string
): Promise<Date | null> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, promisedAt: true },
    });
    if (!order) return null;

    const promisedAt = new Date(Date.now() + minutes * 60_000);

    await tx.order.update({ where: { id: orderId }, data: { promisedAt } });
    await tx.orderEvent.create({
      data: {
        orderId,
        // Durum değişmiyor: olay bir geçiş değil, bir kayıt düşme.
        from: order.status,
        to: order.status,
        actor,
        meta: {
          prepMinutes: minutes,
          promisedAt: promisedAt.toISOString(),
          previousPromisedAt: order.promisedAt?.toISOString() ?? null,
        },
      },
    });

    return promisedAt;
  });
}
