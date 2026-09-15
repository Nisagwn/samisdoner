import type { Metadata } from "next";
import { requirePanel } from "@/lib/admin/page";
import CouponManager from "@/components/admin/CouponManager";
import { listCoupons } from "@/lib/orders/coupons";

/**
 * İndirim kuponları.
 *
 * YETKİ: `catalog`.
 *
 * Kupon doğrudan fiyat belirler — bir kampanyayı açmak, menüdeki bir fiyatı
 * değiştirmekle aynı sınıf bir karar ve aynı sınıf bir hatayı taşıyor: yanlış
 * girilmiş bir kupon günlerce fark edilmeden her siparişte para kaybettirir.
 * Bu yüzden vardiyadaki herkesin değil, menü ve fiyat yetkisi olanın işi.
 *
 * Sayfa kendi verisini sunucuda çeker ve bileşene verir; bileşen yazma
 * işlemlerinden sonra `router.refresh()` ile bu okumayı tekrarlatır. Panelin
 * geri kalanındaki düzenin aynısı (bkz. app/admin/zones/page.tsx).
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "İndirim kuponları // Panel",
  robots: { index: false, follow: false },
};

export default async function AdminCouponsPage() {
  await requirePanel("catalog");

  const coupons = await listCoupons();

  return (
    <div className="min-w-0 max-w-[1000px]">
      <header className="mb-8">
        <p className="tag mb-2 text-flame">Sipariş</p>
        <h1 className="font-display text-3xl font-extrabold text-bone md:text-4xl">
          İndirim kuponları
        </h1>
      </header>

      <CouponManager coupons={coupons} />
    </div>
  );
}
