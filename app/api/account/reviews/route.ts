import { NextResponse } from "next/server";
import { requireCustomer } from "@/lib/account/guard";
import { withDatabase } from "@/lib/security/dbGuard";
import { listPendingReviews, submitReview } from "@/lib/reviews/repository";
import { reviewSubmitSchema } from "@/lib/reviews/schema";

/**
 * Müşterinin değerlendirme ucu.
 *
 * GET: henüz değerlendirilmemiş, değerlendirilebilir siparişler.
 * POST: değerlendirmeyi yazar.
 *
 * Yetki kontrolü **oturumdan**: gövdedeki sipariş numarası bir kimlik kanıtı
 * değildir, numaralar gün içinde sıralı ve tahmin edilebilir. Sipariş her
 * zaman `orderNo + customerId` çiftiyle aranır (bkz. lib/reviews/repository.ts).
 *
 * Ayrı bir oran sınırlaması konmadı ve sebebi var: yazma hakkı zaten teslim
 * edilmiş bir siparişe bağlı ve sipariş başına tek. Bir saldırganın
 * yazabileceği yorum sayısı, verdiği sipariş sayısı kadardır — bu, hiçbir
 * sayacın veremeyeceği kadar sert bir sınır.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withDatabase(async () => {
    const customer = await requireCustomer();
    if (customer instanceof NextResponse) return customer;

    return NextResponse.json({ pending: await listPendingReviews(customer.id) });
  });
}

/** Uygunluk reddinin müşteriye gösterilecek karşılığı — Almanca. */
const MESSAGES: Record<string, string> = {
  not_found: "Diese Bestellung wurde nicht gefunden.",
  not_completed: "Diese Bestellung wurde noch nicht geliefert.",
  too_early:
    "Bitte bewerten Sie kurz nach dem Essen — die Bewertung öffnet sich in Kürze.",
  window_closed:
    "Der Bewertungszeitraum für diese Bestellung ist abgelaufen (14 Tage nach der Lieferung).",
  already_reviewed: "Diese Bestellung wurde bereits bewertet.",
};

export async function POST(request: Request) {
  return withDatabase(async () => {
    const customer = await requireCustomer();
    if (customer instanceof NextResponse) return customer;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
    }

    const parsed = reviewSubmitSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Ungültige Anfrage." },
        { status: 400 }
      );
    }

    const result = await submitReview(customer.id, customer.name, parsed.data);
    if (!result.ok) {
      return NextResponse.json(
        { error: MESSAGES[result.reason], code: result.reason, opensAt: result.opensAt },
        // 404 yalnızca "sipariş yok"; gerisi kural gereği reddedilmiş bir
        // istektir ve 409 ile ayrılır — istemci ikisini farklı karşılar.
        { status: result.reason === "not_found" ? 404 : 409 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  });
}
