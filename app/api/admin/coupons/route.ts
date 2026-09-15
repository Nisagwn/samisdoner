import { NextResponse } from "next/server";
import { badRequest, requirePermission, storeWrite } from "@/lib/admin/guard";
import {
  couponInputFromBody,
  createCoupon,
  listCoupons,
  validateCampaignItems,
} from "@/lib/orders/coupons";
import { couponSchema } from "@/lib/orders/schema";

/**
 * Kampanyalar (ayın ürünü, menü fiyatı, sepet indirimi, indirim kodu).
 *
 * YETKİ: `catalog`.
 *
 * Kampanya doğrudan fiyat belirler — bir kampanyayı açmak, menüdeki bir fiyatı
 * değiştirmekle aynı sınıf bir karar ve aynı sınıf bir hatayı taşıyor: yanlış
 * girilmiş bir kampanya günlerce fark edilmeden her siparişte para
 * kaybettirir. Bu yüzden `orders` (vardiyadaki herkes) değil, menü ve fiyat
 * yetkisiyle aynı kapıdan geçiyor. `finance` de değil: ciroyu *okumak* ile
 * fiyatı *belirlemek* ayrı işler.
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
    return badRequest(parsed.error.issues[0]?.message ?? "Geçersiz kampanya.");
  }

  const input = couponInputFromBody(parsed.data);
  const itemProblem = await validateCampaignItems(input.items);
  if (itemProblem) return badRequest(itemProblem);

  // Aynı kod iki kez eklenemez; benzersizlik ihlalini storeWrite 409'a çevirir.
  const coupon = await storeWrite(() => createCoupon(input));
  if (coupon instanceof NextResponse) return coupon;

  return NextResponse.json(coupon, { status: 201 });
}
