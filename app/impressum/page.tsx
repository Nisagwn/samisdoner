import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import LegalDocument from "@/components/legal/LegalDocument";
import { impressumData } from "@/lib/legal/content";

/**
 * Impressum.
 *
 * Sunucu bileşeni: işletmeye özel alanlar ortam değişkeninden okunur, bu yüzden
 * sayfa statik olarak önceden üretilemez. Değişken canlıda sonradan doldurulunca
 * yeniden dağıtım beklemeden yansısın diye her istekte yeniden çalışır.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Impressum — Sami´s Döner",
  robots: { index: true, follow: true },
};

export default function impressumPage() {
  return (
    <main className="min-h-dvh bg-void text-bone">
      <Navbar />
      <LegalDocument data={impressumData()} />
      <Footer />
    </main>
  );
}
