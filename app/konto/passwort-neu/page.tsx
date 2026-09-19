import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import PasswordResetForm from "@/components/account/PasswordResetForm";

/**
 * Yeni parola — sıfırlama bağlantısının indiği sayfa.
 *
 * Jeton `searchParams`'tan **sunucuda** okunup prop olarak geçilir; istemcide
 * `useSearchParams` ile okunsaydı sayfanın `Suspense` sınırına ihtiyacı olurdu
 * ve jeton kısa bir an için boş görünüp form "bağlantı eksik" derdi.
 *
 * Oturum kontrolü yok, bilinçli: bağlantıya tıklayan kişi genellikle giriş
 * yapamayan kişidir, ama başka bir hesapla açık oturumu olabilir (ortak
 * bilgisayar). Jeton hangi hesabı sıfırlayacağını kendisi taşıyor.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Neues Passwort — Sami´s Döner",
  robots: { index: false, follow: false },
};

export default function PasswortNeuPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  return (
    <main className="min-h-dvh bg-void text-bone">
      <Navbar />
      <PasswordResetForm mode="confirm" token={searchParams.token ?? ""} />
      <Footer />
    </main>
  );
}
