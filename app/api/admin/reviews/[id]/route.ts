import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, notFound, requirePermission, storeWrite } from "@/lib/admin/guard";
import { replyToReview, setReviewVisibility } from "@/lib/reviews/repository";
import { reviewReplySchema, reviewVisibilitySchema } from "@/lib/reviews/schema";

/**
 * Bir değerlendirmeye cevap yazmak ya da onu gizlemek.
 *
 * Silme ucu yok ve olmayacak (bkz. lib/reviews/repository.ts): silinebilir bir
 * yorum listesi, UWG § 5b Abs. 3'ün istediği "bu yorumlar gerçek müşterilerden
 * geliyor" teminatını anlamsız kılar. Gizlemek sebep ister ve sebep kayda
 * yazılır.
 *
 * Cevap yazmak STAFF'a da açık: kötü bir yoruma verilen hızlı ve iyi bir
 * cevap, o yorumu okuyan için yorumun kendisinden daha bilgilendiricidir ve
 * bunun için müdür beklemek onu geciktirmekten başka bir şey yapmaz.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.union([
  z.object({ action: z.literal("reply") }).and(reviewReplySchema),
  z.object({ action: z.literal("visibility") }).and(reviewVisibilitySchema),
]);

type Params = { params: { id: string } };

export async function PATCH(request: Request, { params }: Params) {
  const session = await requirePermission("reviews");
  if (session instanceof NextResponse) return session;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("Geçersiz istek gövdesi.");
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Geçersiz istek.");
  }

  // Cevabın kimden geldiği kayda yazılır: "bu cevabı kim yazdı" sorusu,
  // müşteri cevaptan şikâyet ettiğinde sorulur.
  const actor = session.userId === "env" ? "admin:recovery" : `admin:${session.userId}`;

  const result = await storeWrite(() =>
    parsed.data.action === "reply"
      ? replyToReview(params.id, parsed.data.reply, actor)
      : setReviewVisibility(params.id, parsed.data.published, parsed.data.hiddenReason)
  );
  if (result instanceof NextResponse) return result;
  if (!result) return notFound("Değerlendirme bulunamadı.");

  return NextResponse.json({ ok: true, review: result });
}
