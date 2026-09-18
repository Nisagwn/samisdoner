import { NextResponse } from "next/server";
import { badRequest, requirePermission } from "@/lib/admin/guard";
import { MAX_UPLOAD_BYTES } from "@/lib/admin/imagePath";
import { processImage, saveUpload } from "@/lib/admin/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ürün görseli yükleme.
 *
 * Yalnızca dosyayı işler ve yolunu döner; ürüne bağlamak ayrı bir adımdır
 * (ürün formu kaydedilince). Böylece yükleme yarıda kalırsa ya da form
 * vazgeçilirse ürün kaydı hiç değişmez.
 */

function tooLarge() {
  return NextResponse.json(
    { error: `Görsel en fazla ${MAX_UPLOAD_BYTES / 1024 / 1024} MB olabilir.` },
    { status: 413 }
  );
}

export async function POST(request: Request) {
  const session = await requirePermission("catalog");
  if (session instanceof NextResponse) return session;

  // Gövde okunmadan önce: bildirilen boyut sınırı aşıyorsa belleğe hiç alınmaz.
  // Çok parçalı gövdenin sınır satırları için küçük bir pay bırakılır.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return tooLarge();

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return badRequest("Geçersiz istek gövdesi.");
  }
  if (!(file instanceof Blob) || file.size === 0) return badRequest("Dosya seçilmedi.");
  if (file.size > MAX_UPLOAD_BYTES) return tooLarge();

  const processed = await processImage(Buffer.from(await file.arrayBuffer()));
  if (!processed.ok) return badRequest(processed.error);

  const image = await saveUpload(processed.name, processed.data);
  return NextResponse.json({ image }, { status: 201 });
}
