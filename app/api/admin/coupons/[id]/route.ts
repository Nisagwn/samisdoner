import { NextResponse } from "next/server";
import { badRequest, notFound, requirePermission, storeWrite } from "@/lib/admin/guard";
import { retireCoupon, updateCoupon, type CouponInput } from "@/lib/orders/coupons";
import { couponPatchSchema } from "@/lib/orders/schema";

/**
 * Tek kuponun düzenlenmesi ve kaldırılması.
 *
 * YETKİ: `catalog` — gerekçesi kardeş dosyada (../route.ts).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export async function PATCH(request: Request, { params }: Params) {
  const denied = await requirePermission("catalog");
  if (denied instanceof NextResponse) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Geçersiz istek gövdesi.");
  }

  const parsed = couponPatchSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Geçersiz kupon.");
  }

  /*
   * Zod çıktısı tarihleri metin olarak taşıyor; veri katmanı `Date` bekliyor.
   * Alan **gönderilmediyse** yamaya hiç konmaz (`undefined`), gönderilip null
   * ise temizlenir — ikisi farklı şey: "bu alana dokunma" ile "bu alanı boşalt".
   */
  const { startsAt, expiresAt, ...rest } = parsed.data;
  const patch: Partial<CouponInput> = {
    ...rest,
    ...(startsAt !== undefined ? { startsAt: startsAt ? new Date(startsAt) : null } : {}),
    ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
  };

  const updated = await storeWrite(() => updateCoupon(params.id, patch));
  if (updated instanceof NextResponse) return updated;
  if (!updated) return notFound("Kupon bulunamadı.");
  return NextResponse.json(updated);
}

/**
 * Kuponu kaldırır.
 *
 * Kullanılmışsa silinmez, **pasifleştirilir**: sipariş geçmişi kuponun kaydına
 * bakıyor ve silmek o bağı koparırdı. İşletmeci açısından ikisi de aynı sonucu
 * verir — kod artık çalışmaz — ama hangi yolun seçildiği yanıtta bildirilir ki
 * panel doğru mesajı gösterebilsin.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const denied = await requirePermission("catalog");
  if (denied instanceof NextResponse) return denied;

  const result = await storeWrite(() => retireCoupon(params.id));
  if (result instanceof NextResponse) return result;
  if (!result) return notFound("Kupon bulunamadı.");

  return NextResponse.json({ ok: true, outcome: result.kind });
}
