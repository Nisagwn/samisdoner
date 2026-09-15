import { NextResponse } from "next/server";
import { requirePermission, badRequest, notFound, storeWrite } from "@/lib/admin/guard";
import { parseDeliveryZoneBody } from "@/lib/admin/validate";
import { deleteDeliveryZone, updateDeliveryZone } from "@/lib/orders/zones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export async function PATCH(request: Request, { params }: Params) {
  const denied = await requirePermission("business");
  if (denied instanceof NextResponse) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Geçersiz istek gövdesi.");
  }

  const parsed = parseDeliveryZoneBody(body, true);
  if (!parsed.ok) return badRequest(parsed.error);

  const updated = await storeWrite(() => updateDeliveryZone(params.id, parsed.value));
  if (updated instanceof NextResponse) return updated;
  if (!updated) return notFound("Teslimat bölgesi bulunamadı.");
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: Params) {
  const denied = await requirePermission("business");
  if (denied instanceof NextResponse) return denied;

  const removed = await storeWrite(() => deleteDeliveryZone(params.id));
  if (removed instanceof NextResponse) return removed;
  if (!removed) return notFound("Teslimat bölgesi bulunamadı.");
  return NextResponse.json({ ok: true });
}
