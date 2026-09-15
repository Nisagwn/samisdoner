import type { Metadata } from "next";
import ReviewManager from "@/components/admin/ReviewManager";
import { requirePanel } from "@/lib/admin/page";
import { listReviewsForAdmin } from "@/lib/reviews/repository";

/**
 * Değerlendirme ekranı.
 *
 * Liste sunucuda bir kez çekilir ve istemcide yaşamaya devam eder: sipariş
 * panosunun aksine burada saniyelik tazelik gerekmiyor — bir yorum saniyeler
 * içinde cevaplanması gereken bir iş değil, gün içinde bakılacak bir liste.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Değerlendirmeler // Panel",
  robots: { index: false, follow: false },
};

export default async function AdminReviewsPage() {
  await requirePanel("reviews");

  return <ReviewManager initial={await listReviewsForAdmin()} />;
}
