import { NextResponse } from "next/server";
import { badRequest, requirePermission, storeWrite } from "@/lib/admin/guard";
import { createStaff, listStaff, staffCreateSchema } from "@/lib/admin/staff";

/**
 * Panel kullanıcıları.
 *
 * Yalnızca OWNER. Personel listesi erişimin kendisidir: onu değiştirebilen
 * biri kendine istediği yetkiyi verebilir, dolayısıyla "personel" izni her
 * zaman en üst rolde kalmalı.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requirePermission("staff");
  if (session instanceof NextResponse) return session;

  return NextResponse.json({ staff: await listStaff() });
}

export async function POST(request: Request) {
  const session = await requirePermission("staff");
  if (session instanceof NextResponse) return session;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("Geçersiz istek gövdesi.");
  }

  const parsed = staffCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Geçersiz istek.");
  }

  const result = await storeWrite(() => createStaff(parsed.data));
  if (result instanceof NextResponse) return result;

  if (!result.ok) {
    // 409: kullanıcı hatası, sunucu hatası değil — aynı e-postayla ikinci
    // kullanıcı açılamaz.
    return NextResponse.json(
      { error: "Bu e-posta ile bir kullanıcı zaten var." },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, staff: result.staff }, { status: 201 });
}
