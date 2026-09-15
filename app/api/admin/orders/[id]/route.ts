import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, notFound, requireAdmin, storeWrite } from "@/lib/admin/guard";
import { InvalidTransitionError, needsRefund } from "@/lib/orders/status";
import { buildCancelReason } from "@/lib/orders/cancelReasons";
import { delayOrderPromise, transitionOrder } from "@/lib/orders/repository";
import { refundOrder } from "@/lib/orders/refund";
import { isPrepChoice, setPromiseFromNow } from "@/lib/admin/promise";

/**
 * Sipariş durumunu ilerletir, siparişi "görüldü" olarak işaretler, teslim
 * saatini öteler ya da iptal edip parayı iade eder.
 *
 * Durum değişimi doğrudan veritabanına yazılmaz: `transitionOrder` üzerinden
 * geçer, dolayısıyla izinsiz geçişler reddedilir ve her değişiklik geçmişe
 * (OrderEvent) yazılır.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.union([
  z.object({
    action: z.literal("acknowledge"),
  }),
  z.object({
    action: z.literal("transition"),
    status: z.enum([
      "ACCEPTED",
      "PREPARING",
      "READY",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "PICKED_UP",
      "CANCELLED",
      "REJECTED",
    ]),
    /*
     * İptal/ret sebebi. Serbest metin değil, `lib/orders/cancelReasons.ts`
     * içindeki listeden bir kimlik: müşteriye gösterilecek cümle kendi
     * dilinde üretilecek, mutfakta yazılmış bir not bunu yapamaz.
     */
    reasonId: z.string().trim().max(40).optional(),
    /** Yalnızca "OTHER" seçildiğinde anlamlı; müşteriye olduğu gibi gider. */
    reasonNote: z.string().trim().max(300).optional(),
    /*
     * Kabul ederken seçilen hazırlık süresi (dakika).
     *
     * Yalnızca "Kabul et" adımında anlamlı ve isteğe bağlı: seçilmezse
     * sipariş anındaki tahmin olduğu gibi kalır. Serbest sayı değil, listeden
     * bir değer — bkz. lib/admin/promise.ts.
     */
    prepMinutes: z
      .number()
      .int()
      .refine(isPrepChoice, "Geçersiz hazırlık süresi.")
      .optional(),
  }),
  /*
   * Gecikme bildirimi. Serbest dakika kabul edilmez, sabit basamaklar var:
   * yoğun mutfakta sayı yazdırmak yerine tek dokunuş gerekir, ayrıca
   * "+120 dk" gibi bir yanlış dokunuşun müşteriye gitmesi engellenir.
   */
  z.object({
    action: z.literal("delay"),
    minutes: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  }),
]);

type Params = { params: { id: string } };

export async function PATCH(request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("Geçersiz istek gövdesi.");
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Geçersiz istek.");
  }

  const exists = await prisma.order.findUnique({
    where: { id: params.id },
    select: { id: true, status: true },
  });
  if (!exists) return notFound("Sipariş bulunamadı.");

  // "Görüldü": durumu değiştirmez, yalnızca sesli uyarıyı susturur.
  if (parsed.data.action === "acknowledge") {
    const result = await storeWrite(() =>
      prisma.order.update({
        where: { id: params.id },
        data: { acknowledgedAt: new Date() },
        select: { id: true, acknowledgedAt: true },
      })
    );
    if (result instanceof NextResponse) return result;
    return NextResponse.json({ ok: true, acknowledgedAt: result.acknowledgedAt });
  }

  /*
   * Gecikme: durum değişmez, yalnızca söz verilen saat ötelenir. Müşteri bunu
   * takip sayfasının 20 saniyelik tazelemesiyle kendiliğinden görür.
   */
  if (parsed.data.action === "delay") {
    const minutes = parsed.data.minutes;
    const result = await storeWrite(() => delayOrderPromise(params.id, minutes, "admin"));
    if (result instanceof NextResponse) return result;
    if (result === null) {
      return NextResponse.json(
        { error: "Bu siparişte henüz teslim saati yok (ödeme onaylanmamış)." },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, promisedAt: result.promisedAt });
  }

  /*
   * Sebepsiz iptal yok.
   *
   * Müşteri parasının iade edileceğini ve yemeğinin gelmeyeceğini öğrenirken
   * bunun NEDEN olduğunu da öğrenmeli; sebep alanı boş bırakılabilir olsaydı
   * yoğun bir akşamda her zaman boş bırakılırdı. Kural sunucuda: paneldeki
   * pencerenin atlanması da mümkün olmasın.
   */
  const cancelling =
    parsed.data.status === "CANCELLED" || parsed.data.status === "REJECTED";
  let reason: string | undefined;
  if (cancelling) {
    const built = buildCancelReason(parsed.data.reasonId ?? "", parsed.data.reasonNote ?? "");
    if (!built) {
      return badRequest(
        "İptal sebebi seçilmeli; \"Diğer\" seçildiyse müşteriye gösterilecek açıklama yazılmalı."
      );
    }
    reason = built;
  }

  try {
    const order = await transitionOrder(params.id, parsed.data.status, "admin", {
      reason,
      ...(reason ? { meta: { cancelReason: reason } } : {}),
    });

    /*
     * Hazırlık süresi, durum geçişinden **sonra** yazılır.
     *
     * Sıra önemli: geçiş reddedilirse (eskimiş panel görünümü, iki kez
     * tıklanmış düğme) müşteriye yeni bir saat söz verilmiş olmaz. Ters
     * sırada olsaydı, kabul edilmemiş bir siparişin teslim saati değişirdi.
     */
    let promisedAt: Date | null = null;
    if (parsed.data.prepMinutes !== undefined && parsed.data.status === "ACCEPTED") {
      promisedAt = await setPromiseFromNow(params.id, parsed.data.prepMinutes, "admin");
    }

    /*
     * İade.
     *
     * Durum değişiminden **sonra** çağrılır, bilinçli olarak: iade başarısız
     * olursa sipariş iptal kalır ve panel bunu bildirir (elle tekrar
     * denenebilir). Ters sırada olsaydı iade edilmiş ama hâlâ "hazırlanıyor"
     * görünen bir sipariş oluşurdu — yemek çıkar, parası alınmamıştır.
     *
     * `needsRefund` ödeme alınmamış durumları eler: PENDING_PAYMENT ve
     * EXPIRED siparişte iade edilecek para yok, sağlayıcıya gitmeye de gerek
     * yok. Ölçüt geçişin **kaynağıdır**, hedefi değil.
     */
    if (cancelling && needsRefund(exists.status)) {
      const refund = await refundOrder(order, reason ?? "", "admin");
      if (refund.kind === "failed") {
        // 200 değil: iptal oldu ama para dönmedi ve bu görülmeli.
        return NextResponse.json(
          {
            error: `Sipariş iptal edildi ancak iade yapılamadı: ${refund.message}`,
            status: order.status,
            refunded: false,
          },
          { status: 502 }
        );
      }
      return NextResponse.json({
        ok: true,
        status: order.status,
        refunded: refund.kind !== "nothing_to_refund",
        refundedCents: "amountCents" in refund ? refund.amountCents : 0,
      });
    }

    return NextResponse.json({
      ok: true,
      status: order.status,
      promisedAt: (promisedAt ?? order.promisedAt)?.toISOString() ?? null,
    });
  } catch (error) {
    // İki kez tıklanan bir buton ya da eskimiş bir panel görünümü: kullanıcı
    // hatası, sunucu hatası değil.
    if (error instanceof InvalidTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
