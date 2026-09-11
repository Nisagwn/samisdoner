import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Products from "@/components/Products";
import AssemblyLog from "@/components/AssemblyLog";
import Locations from "@/components/Locations";
import Footer from "@/components/Footer";
import { getFeaturedProducts } from "@/lib/admin/store";

/**
 * Ana sayfa.
 *
 * Dört bölüm: tanıtım, öne çıkanlar, katman katman, konum. Eskiden burada on
 * bir bölüm vardı ve menüye giden yol bu yığının içinde kayboluyordu.
 *
 * "Katman katman" (`AssemblyLog`) sayfanın imzası olan katmanlı döner
 * sahnesidir; vitrinin hemen altında durur ve malzemeleri gösterir. Yalnızca
 * bu sayfada yaşar, `/ueber-uns` artık onu tekrar etmez.
 *
 * "Kendin Seç" yapılandırıcısı **kaldırıldı**. Müşteri dönerini malzeme
 * malzeme kurmak yerine menüden sipariş ediyor, özel istek sipariş notuna
 * yazılıyor. Bölümün kendine ait bir sepet satır türü, bir API ucu ve panelde
 * seçenek başına ek ücret tablosu vardı; üçü de gitti.
 *
 * Kalan hikâye, kalite, yorumlar ve duyuru bölümleri **silinmedi**,
 * `/ueber-uns` sayfasına taşındı; navigasyondan ve altbilgiden erişilebilir.
 * Böylece ana sayfa sipariş vermeye odaklanır, okumak isteyen ayrı sayfaya
 * geçer.
 *
 * Tam menü burada değildir: menü kendi sayfasında (`/speisekarte`) yaşar,
 * buradaki vitrin oraya açılan kapıdır.
 *
 * Vitrin katalogtan geldiği için sayfa her istekte yeniden üretilir: panelde
 * "Öne çıkar" işaretlendiği anda burada da değişir.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const featured = await getFeaturedProducts(3);

  return (
    <main className="bg-void">
      <Navbar />
      <Hero />
      <Products products={featured} />
      <AssemblyLog />
      <Locations />
      <Footer />
    </main>
  );
}
