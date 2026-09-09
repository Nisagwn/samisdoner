import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import PasswordResetForm from "@/components/account/PasswordResetForm";
import { getCurrentCustomer } from "@/lib/account/guard";

/**
 * "Parolamı unuttum" — bağlantı isteme adımı.
 *
 * Oturumu açık kullanıcı buraya gelmemeli: parolasını biliyor ve değiştirmek
 * istiyorsa hesap ayarlarında mevcut parolayı soran doğru akış var.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Passwort vergessen — Sami´s Döner",
  robots: { index: false, follow: false },
};

export default async function PasswortVergessenPage() {
  if (await getCurrentCustomer()) redirect("/konto/einstellungen");

  return (
    <main className="min-h-screen bg-void text-bone">
      <Navbar />
      <PasswordResetForm mode="request" />
      <Footer />
    </main>
  );
}
