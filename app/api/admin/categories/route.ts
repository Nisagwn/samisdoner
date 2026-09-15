import { NextResponse } from "next/server";
import { requirePermission, badRequest, storeWrite } from "@/lib/admin/guard";
import { createCategory, getCatalog } from "@/lib/admin/store";
import { slugify } from "@/lib/admin/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requirePermission("catalog");
  if (denied instanceof NextResponse) return denied;

  const { categories } = await getCatalog();
  return NextResponse.json(categories);
}

export async function POST(request: Request) {
  const denied = await requirePermission("catalog");
  if (denied instanceof NextResponse) return denied;

  let name = "";
  try {
    const body = (await request.json()) as { name?: unknown };
    if (typeof body.name === "string") name = body.name.trim();
  } catch {
    return badRequest("Geçersiz istek gövdesi.");
  }

  if (!name) return badRequest("Kategori adı boş olamaz.");
  if (name.length > 80) return badRequest("Kategori adı en fazla 80 karakter olabilir.");

  const category = await storeWrite(() => createCategory(name, slugify(name) || "kategori"));
  if (category instanceof NextResponse) return category;
  return NextResponse.json(category, { status: 201 });
}
