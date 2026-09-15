import { NextResponse } from "next/server";
import { badRequest, notFound, requirePermission, storeWrite } from "@/lib/admin/guard";
import { staffUpdateSchema, updateStaff } from "@/lib/admin/staff";

/**
 * Tek bir panel kullanıcısı: ad, rol, parola ve aktiflik.
 *
 * Silme ucu **yoktur** ve olmayacak. Kullanıcıyı silmek, onun yaptığı
 * işlemlerin failini kayıtta boşa düşürür: sipariş geçmişindeki "kim iptal
 * etti" sorusunun cevabı bir e-posta adresidir ve o adresin kime ait olduğu
 * ancak bu tabloda duruyorsa bilinir. `active: false` erişimi anında keser,
 * geçmişi korur ve gerekirse geri alınır.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export async function PATCH(request: Request, { params }: Params) {
  const session = await requirePermission("staff");
  if (session instanceof NextResponse) return session;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("Geçersiz istek gövdesi.");
  }

  const parsed = staffUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Geçersiz istek.");
  }

  const result = await storeWrite(() => updateStaff(params.id, parsed.data, session.userId));
  if (result instanceof NextResponse) return result;

  if (!result.ok) {
    if (result.reason === "not_found") return notFound("Kullanıcı bulunamadı.");
    if (result.reason === "self") {
      return NextResponse.json(
        {
          error:
            "Kendi rolünüzü değiştiremez ya da kendi hesabınızı kapatamazsınız. Başka bir sahibe yaptırın.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error:
          "Panelde en az bir aktif sahip kalmalı. Önce başka birini sahip yapın, sonra bunu değiştirin.",
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, staff: result.staff });
}
