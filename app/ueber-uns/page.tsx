import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import AboutUs from "@/components/AboutUs";
import FinalStack from "@/components/FinalStack";
import Franchise from "@/components/Franchise";
import Reviews from "@/components/Reviews";
import News from "@/components/News";
import SocialMedia from "@/components/SocialMedia";
import Footer from "@/components/Footer";

/**
 * "Hakkımızda" sayfası.
 *
 * Ana sayfada sipariş akışının önünü kapatan tanıtım bölümlerinin yeni evi.
 * Hiçbiri silinmedi, hepsi eskisi gibi ve aynı sırada duruyor — yalnızca
 * sipariş vermek isteyen müşterinin yolundan çekildi.
 *
 * Katmanlı döner sahnesi (`AssemblyLog`) burada değil: ana sayfaya geri
 * döndü. Sabitlenen (pin) uzun bir bölüm olduğu için iki sayfada birden
 * durması aynı sahneyi iki kez izletiyordu.
 *
 * Bölüm kimlikleri (`#unternehmen`, `#franchise`, `#blog`) korundu: navigasyon
 * ve altbilgideki bağlantılar bu sayfaya yönlendirildiğinde doğru bölüme
 * iner, eski yer imleri de kırılmaz.
 */

export const metadata: Metadata = {
  title: "Über uns — Sami´s Döner // Straßkirchen",
  description:
    "Die Geschichte, die Zubereitung und die Qualitätsversprechen von Sami´s Döner in Straßkirchen — plus Bewertungen und aktuelle News.",
};

export default function UeberUnsPage() {
  return (
    <main className="bg-void">
      <Navbar />
      {/* Sabit navbarın altında kalmasın. */}
      <div className="pt-[var(--nav-h)]">
        <AboutUs />
      </div>
      <FinalStack />
      <Franchise />
      <Reviews />
      <News />
      <SocialMedia />
      <Footer />
    </main>
  );
}
