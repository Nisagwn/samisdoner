import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AccountFrame from "@/components/account/AccountFrame";
import ReviewsPanel from "@/components/account/ReviewsPanel";
import { getCurrentCustomer } from "@/lib/account/guard";
import { listOwnReviews, listPendingReviews } from "@/lib/reviews/repository";

/**
 * Değerlendirme ekranı.
 *
 * Hangi siparişin değerlendirilebileceği kararı **sunucuda** verilir
 * (bkz. lib/reviews/eligibility.ts): listeye giren her satır gerçekten
 * yazılabilir durumda olan bir siparişe aittir. Aynı kural yazma ucunda da
 * geçerli; buradaki liste kolaylık, oradaki kontrol kural.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Meine Bewertungen — Sami´s Döner",
  robots: { index: false, follow: false },
};

export default async function AccountReviewsPage() {
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/konto/anmelden?next=/konto/bewertungen");

  const [pending, own] = await Promise.all([
    listPendingReviews(customer.id),
    listOwnReviews(customer.id),
  ]);

  return (
    <AccountFrame
      active="reviews"
      customerId={customer.id}
      name={customer.name}
      email={customer.email}
    >
      <ReviewsPanel
        pending={pending}
        own={own.map((review) => ({
          orderNo: review.orderNo,
          items: review.items,
          foodRating: review.foodRating,
          deliveryRating: review.deliveryRating,
          comment: review.comment,
          reply: review.reply,
          published: review.published,
          createdAt: review.createdAt.toISOString(),
        }))}
      />
    </AccountFrame>
  );
}
