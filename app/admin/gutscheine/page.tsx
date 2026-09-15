import type { Metadata } from "next";
import { requirePanel } from "@/lib/admin/page";
import CampaignManager, { type CampaignProductOption } from "@/components/admin/CampaignManager";
import { getCatalog, isVisible } from "@/lib/admin/store";
import { toCents } from "@/lib/money";
import { listCoupons } from "@/lib/orders/coupons";

/**
 * Kampanyalar (adres tarihsel olarak `/admin/gutscheine`).
 *
 * YETKİ: `catalog`.
 *
 * Kampanya doğrudan fiyat belirler — bir kampanyayı açmak, menüdeki bir fiyatı
 * değiştirmekle aynı sınıf bir karar ve aynı sınıf bir hatayı taşıyor: yanlış
 * girilmiş bir kampanya günlerce fark edilmeden her siparişte para
 * kaybettirir. Bu yüzden vardiyadaki herkesin değil, menü ve fiyat yetkisi
 * olanın işi.
 *
 * Sayfa kendi verisini sunucuda çeker ve bileşene verir; bileşen yazma
 * işlemlerinden sonra `router.refresh()` ile bu okumayı tekrarlatır. Panelin
 * geri kalanındaki düzenin aynısı (bkz. app/admin/zones/page.tsx).
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kampanyalar // Panel",
  robots: { index: false, follow: false },
};

export default async function AdminCampaignsPage() {
  await requirePanel("catalog");

  const [coupons, catalog] = await Promise.all([listCoupons(), getCatalog()]);

  // Ürün seçicisi menü sırasıyla; menüde görünmeyen ürün de seçilebilir
  // (kampanya önceden hazırlanıp ürün sonra açılabilir) ama işaretlenir.
  const products: CampaignProductOption[] = catalog.products
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((product) => ({
      id: product.id,
      label: `${product.no ? `${product.no} · ` : ""}${product.name}`,
      hidden: !isVisible(product),
      priceCents: toCents(product.discountPrice ?? product.price),
      variants: product.variants.map((variant) => ({
        size: variant.size,
        priceCents: toCents(variant.price),
      })),
    }));

  return (
    <div className="min-w-0 max-w-[1000px]">
      <header className="mb-8">
        <p className="tag mb-2 text-flame">Sipariş</p>
        <h1 className="font-display text-3xl font-extrabold text-bone md:text-4xl">Kampanyalar</h1>
      </header>

      <CampaignManager coupons={coupons} products={products} />
    </div>
  );
}
