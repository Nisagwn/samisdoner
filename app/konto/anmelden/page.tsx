import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import AuthForm from "@/components/account/AuthForm";
import { getCurrentCustomer } from "@/lib/account/guard";

/**
 * Anmelden.
 *
 * Oturumu açık olan kullanıcı buraya gelmemeli: geri düğmesiyle giriş formuna
 * dönmek kafa karıştırıcıdır, panele yönlendiririz.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Anmelden — Sami´s Döner",
  robots: { index: false, follow: false },
};

export default async function AnmeldenPage() {
  if (await getCurrentCustomer()) redirect("/konto");

  return (
    <main className="min-h-dvh bg-void text-bone">
      <Navbar />
      {/* useSearchParams istemci tarafında askıya alınabilir; Next bu sınırı ister. */}
      <Suspense fallback={null}>
        <AuthForm mode="login" />
      </Suspense>
      <Footer />
    </main>
  );
}
