import { NextResponse } from "next/server";
import { requirePermission, badRequest, storeWrite } from "@/lib/admin/guard";
import { parseDeliveryZoneBody } from "@/lib/admin/validate";
import { createDeliveryZone, listDeliveryZones } from "@/lib/orders/zones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Teslimat bölgeleri.
 *
 * Sipariş akışı bir posta koduna teslimat yapılıp yapılmayacağını yalnızca bu
 * tablodan okur; buraya eklenmemiş bir posta kodu müşteriye "bu bölgeye
 * teslimat yapılmıyor" olarak döner.
 */

export async function GET() {
  const denied = await requirePermission("business");
  if (denied instanceof NextResponse) return denied;

  return NextResponse.json(await listDeliveryZones());
}

export async function POST(request: Request) {
  const denied = await requirePermission("business");
  if (denied instanceof NextResponse) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Geçersiz istek gövdesi.");
  }

  const parsed = parseDeliveryZoneBody(body, false);
  if (!parsed.ok) return badRequest(parsed.error);
  const value = parsed.value;

  // Aynı posta kodu iki kez eklenemez; benzersizlik ihlalini storeWrite 409'a çevirir.
  const zone = await storeWrite(() =>
    createDeliveryZone({
      postalCode: value.postalCode ?? "",
      city: value.city ?? "",
      minOrderCents: value.minOrderCents ?? 0,
      feeCents: value.feeCents ?? 0,
      freeOverCents: value.freeOverCents ?? 0,
      etaMinutes: value.etaMinutes ?? 45,
      active: value.active ?? true,
    })
  );
  if (zone instanceof NextResponse) return zone;

  return NextResponse.json(zone, { status: 201 });
}
