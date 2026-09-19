import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import LegalDocument from "@/components/legal/LegalDocument";
import { datenschutzData } from "@/lib/legal/content";

/**
 * Datenschutz.
 *
 * Sunucu bileşeni: işletmeye özel alanlar ortam değişkeninden okunur, bu yüzden
 * sayfa statik olarak önceden üretilemez. Değişken canlıda sonradan doldurulunca
 * yeniden dağıtım beklemeden yansısın diye her istekte yeniden çalışır.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Datenschutzerklärung — Sami´s Döner",
  robots: { index: true, follow: true },
};

export default function datenschutzPage() {
  return (
    <main className="min-h-dvh bg-void text-bone">
      <Navbar />
      <LegalDocument data={datenschutzData()} />
      <Footer />
    </main>
  );
}
