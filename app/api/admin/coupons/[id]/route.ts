import { NextResponse } from "next/server";
import { badRequest, notFound, requirePermission, storeWrite } from "@/lib/admin/guard";
import {
  couponInputFromBody,
  retireCoupon,
  updateCoupon,
  validateCampaignItems,
} from "@/lib/orders/coupons";
import { couponSchema } from "@/lib/orders/schema";

/**
 * Tek kampanyanın düzenlenmesi ve kaldırılması.
 *
 * YETKİ: `catalog` — gerekçesi kardeş dosyada (../route.ts).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

/**
 * Düzenleme **bütün alanları** ister (bkz. `couponSchema` notu): alanların
 * anlamı türe bağlı ve kısmi bir yama türü değiştirip değeri eski bırakabilir.
 */
export async function PATCH(request: Request, { params }: Params) {
  const denied = await requirePermission("catalog");
  if (denied instanceof NextResponse) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Geçersiz istek gövdesi.");
  }

  const parsed = couponSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Geçersiz kampanya.");
  }

  const input = couponInputFromBody(parsed.data);
  const itemProblem = await validateCampaignItems(input.items);
  if (itemProblem) return badRequest(itemProblem);

  const updated = await storeWrite(() => updateCoupon(params.id, input));
  if (updated instanceof NextResponse) return updated;
  if (!updated) return notFound("Kampanya bulunamadı.");
  return NextResponse.json(updated);
}

/**
 * Kampanyayı kaldırır.
 *
 * Kullanılmışsa silinmez, **pasifleştirilir**: sipariş geçmişi kaydına
 * bakıyor ve silmek o bağı koparırdı. İşletmeci açısından ikisi de aynı sonucu
 * verir — kampanya artık çalışmaz — ama hangi yolun seçildiği yanıtta
 * bildirilir ki panel doğru mesajı gösterebilsin.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const denied = await requirePermission("catalog");
  if (denied instanceof NextResponse) return denied;

  const result = await storeWrite(() => retireCoupon(params.id));
  if (result instanceof NextResponse) return result;
  if (!result) return notFound("Kampanya bulunamadı.");

  return NextResponse.json({ ok: true, outcome: result.kind });
}
