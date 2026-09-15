import { NextResponse } from "next/server";
import { badRequest, requirePermission, storeWrite } from "@/lib/admin/guard";
import { createCoupon, listCoupons } from "@/lib/orders/coupons";
import { couponSchema } from "@/lib/orders/schema";

/**
 * İndirim kuponları.
 *
 * YETKİ: `catalog`.
 *
 * Kupon doğrudan fiyat belirler — bir kampanyayı açmak, menüdeki bir fiyatı
 * değiştirmekle aynı sınıf bir karar ve aynı sınıf bir hatayı taşıyor: yanlış
 * girilmiş bir kupon günlerce fark edilmeden her siparişte para kaybettirir.
 * Bu yüzden `orders` (vardiyadaki herkes) değil, menü ve fiyat yetkisiyle aynı
 * kapıdan geçiyor. `finance` de değil: ciroyu *okumak* ile fiyatı *belirlemek*
 * ayrı işler.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requirePermission("catalog");
  if (denied instanceof NextResponse) return denied;

  return NextResponse.json(await listCoupons());
}

export async function POST(request: Request) {
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
    return badRequest(parsed.error.issues[0]?.message ?? "Geçersiz kupon.");
  }
  const value = parsed.data;

  // Aynı kod iki kez eklenemez; benzersizlik ihlalini storeWrite 409'a çevirir.
  const coupon = await storeWrite(() =>
    createCoupon({
      code: value.code,
      kind: value.kind,
      value: value.value,
      minOrderCents: value.minOrderCents,
      // Tavan yalnızca yüzde kuponunda anlamlı; sabit tutarlı kuponda
      // saklanmaz ki panelde "hem 5 € indirim hem 3 € tavan" gibi okunamayan
      // bir kayıt oluşmasın.
      maxDiscountCents: value.kind === "PERCENT" ? value.maxDiscountCents : 0,
      fulfillment: value.fulfillment,
      startsAt: value.startsAt ? new Date(value.startsAt) : null,
      expiresAt: value.expiresAt ? new Date(value.expiresAt) : null,
      maxRedemptions: value.maxRedemptions,
      active: value.active,
    })
  );
  if (coupon instanceof NextResponse) return coupon;

  return NextResponse.json(coupon, { status: 201 });
}
