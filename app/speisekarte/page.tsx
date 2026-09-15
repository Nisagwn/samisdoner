import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Products from "@/components/Products";
import MenuGrid from "@/components/MenuGrid";
import CampaignStrip from "@/components/CampaignStrip";
import Footer from "@/components/Footer";
import { getFeaturedProducts, getMenuSections } from "@/lib/admin/store";
import { getMenuCampaigns } from "@/lib/orders/coupons";

/**
 * Karta sayfası — sitenin sipariş yüzeyi.
 *
 * En üstte "öne çıkanlar" vitrini durur: çoğu müşteri zaten aynı birkaç ürünü
 * söyler, onları altmış satırlık listede aratmanın anlamı yok. Vitrinin altında
 * tam menü, kategori şeridi ve arama gelir.
 *
 * Vitrindeki ürünler admin panelinden seçilir ("Öne çıkar" anahtarı); menü ise
 * katalogtaki görünür ürünlerin tamamıdır. Sayfa her istekte yeniden üretilir:
 * panelde bir ürün "tükendi"/"pasif" yapıldığı anda burada da kaybolur.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Speisekarte — Sami´s Döner // Straßkirchen",
  description:
    "Die komplette Speisekarte von Sami´s Döner in Straßkirchen: Drehspieß, Pide, Lahmacun, Pizza, Salate und Getränke mit aktuellen Preisen — direkt online bestellen.",
};

export default async function SpeisekartePage() {
  const [featured, sections, campaigns] = await Promise.all([
    getFeaturedProducts(3),
    getMenuSections(),
    getMenuCampaigns(),
  ]);

  return (
    <main className="bg-void">
      <Navbar />
      {/* Sabit navbarın altında kalmasın: bu sayfada vitrin en üstteki bölüm. */}
      <div className="pt-[var(--nav-h)]">
        <Products products={featured} showMenuLink={false} lead />
      </div>
      {/* Açık otomatik kampanya yoksa şerit hiç çıkmaz. */}
      <CampaignStrip campaigns={campaigns} />
      <MenuGrid sections={sections} />
      <Footer />
    </main>
  );
}
