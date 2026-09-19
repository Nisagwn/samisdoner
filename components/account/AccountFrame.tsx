import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { getAccountSummary } from "@/lib/account/view";
import AccountShell, { type AccountNavKey } from "./AccountShell";

/**
 * Hesap ekranlarının ortak çerçevesi (sunucu bileşeni).
 *
 * Beş sayfanın da yaptığı ilk iş aynı: navbar, kabuk, sayaçlar, footer. Bunu
 * her sayfada tekrarlamak, gezinme çubuğundaki sayıların bir ekranda
 * güncellenip diğerinde unutulmasıyla biterdi.
 *
 * Neden `app/konto/layout.tsx` değil: o dosya `/konto/anmelden` ve
 * `/konto/registrieren` sayfalarını da sarardı — henüz oturumu olmayan birine
 * hesap menüsü göstermek anlamsız.
 */
export default async function AccountFrame({
  active,
  customerId,
  name,
  email,
  children,
}: {
  active: AccountNavKey;
  customerId: string;
  name: string;
  email: string;
  children: React.ReactNode;
}) {
  const summary = await getAccountSummary(customerId);

  return (
    <main className="min-h-dvh bg-void text-bone">
      <Navbar />
      <AccountShell active={active} name={name} email={email} summary={summary}>
        {children}
      </AccountShell>
      <Footer />
    </main>
  );
}
