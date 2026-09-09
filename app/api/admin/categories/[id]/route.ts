import { NextResponse } from "next/server";
import { requireAdmin, badRequest, notFound, storeWrite } from "@/lib/admin/guard";
import { deleteCategory, updateCategory } from "@/lib/admin/store";
import { parseCategoryPatch } from "@/lib/admin/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

/**
 * Kategori güncelleme.
 *
 * Gövde önceden yalnızca `name` okuyordu; `nameTr`, `note`, `noteTr` ve
 * `sortOrder` şemada olmasına ve menüde gösterilmesine rağmen girilemiyordu.
 * Doğrulama artık `parseCategoryPatch` içinde ve **kısmi**: sıralama
 * düğmeleri yalnızca `sortOrder`, düzenleme formu yalnızca metin alanlarını
 * gönderir; gönderilmeyen alan olduğu gibi kalır.
 */
export async function PATCH(request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Geçersiz istek gövdesi.");
  }

  const parsed = parseCategoryPatch(body);
  if (!parsed.ok) return badRequest(parsed.error);
  if (Object.keys(parsed.value).length === 0) {
    return badRequest("Değiştirilecek alan gönderilmedi.");
  }

  const updated = await storeWrite(() => updateCategory(params.id, parsed.value));
  if (updated instanceof NextResponse) return updated;
  if (!updated) return notFound("Kategori bulunamadı.");
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const result = await storeWrite(() => deleteCategory(params.id));
  if (result instanceof NextResponse) return result;
  if (result.ok) return NextResponse.json({ ok: true });
  if (result.reason === "not_found") return notFound("Kategori bulunamadı.");
  return badRequest(
    `Bu kategoride ${result.count} ürün var. Önce ürünleri başka kategoriye taşıyın veya silin.`
  );
}
