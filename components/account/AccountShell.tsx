"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { accountTexts } from "./texts";

/**
 * Hesap alanının kabuğu: başlık, gezinme ve içerik.
 *
 * Hesap eskiden **tek bir sayfaydı**: adres formu, sipariş listesi, parola
 * değiştirme ve hesap silme alt alta diziliydi. Bir siparişi tekrar ısmarlamak
 * için hesabı silme kutusunun yanından geçmek gerekiyordu; "adresim nerede"
 * sorusunun cevabı da kaydırma çubuğuydu.
 *
 * Artık her iş kendi adresinde (`/konto/...`) duruyor. Bunun görünmeyen bir
 * faydası daha var: adres defteri açıkken parola bölümü hiç yüklenmiyor,
 * dolayısıyla yanlışlıkla dokunulabilecek bir şey de yok.
 *
 * Sayaçlar sunucudan gelir; gezinme çubuğunda "3 adres" yazması, o bölüme
 * girmeden ne bulacağını söyler.
 */

export type AccountNavKey =
  | "overview"
  | "orders"
  | "addresses"
  | "favorites"
  | "reviews"
  | "settings";

export type AccountSummary = {
  orderCount: number;
  activeOrderCount: number;
  addressCount: number;
  favoriteCount: number;
  /** Değerlendirilmeyi bekleyen sipariş sayısı. */
  pendingReviewCount: number;
};

export default function AccountShell({
  active,
  name,
  email,
  summary,
  children,
}: {
  active: AccountNavKey;
  name: string;
  email: string;
  summary: AccountSummary;
  children: React.ReactNode;
}) {
  const { lang } = useLanguage();
  const t = accountTexts(lang !== "tr");
  const router = useRouter();

  async function logout() {
    await fetch("/api/account/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/");
    router.refresh();
  }

  const items: { key: AccountNavKey; href: string; label: string; badge?: number }[] = [
    { key: "overview", href: "/konto", label: t.navOverview },
    { key: "orders", href: "/konto/bestellungen", label: t.navOrders, badge: summary.orderCount },
    {
      key: "addresses",
      href: "/konto/adressen",
      label: t.navAddresses,
      badge: summary.addressCount,
    },
    {
      key: "favorites",
      href: "/konto/favoriten",
      label: t.navFavorites,
      badge: summary.favoriteCount,
    },
    /* Rozet **bekleyen** değerlendirme sayısıdır, yazılmış olanların değil:
       satırın işaretli durması bir iş olduğunu söylemeli, bir arşivin
       büyüklüğünü değil. */
    {
      key: "reviews",
      href: "/konto/bewertungen",
      label: t.navReviews,
      badge: summary.pendingReviewCount,
    },
    { key: "settings", href: "/konto/einstellungen", label: t.navSettings },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-5 pb-24 pt-[calc(var(--nav-h)+2.5rem)]">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div className="min-w-0">
          <p className="tag text-flame">{t.account}</p>
          <h1 className="mt-2 font-display text-3xl font-extrabold text-bone [overflow-wrap:anywhere]">
            {name || email}
          </h1>
          <p className="mt-1 font-mono text-xs text-smoke [overflow-wrap:anywhere]">{email}</p>
        </div>
        <button
          onClick={logout}
          className="focus-ring tag border border-line px-4 py-2 text-smoke transition-colors hover:border-flame hover:text-flame"
        >
          {t.logout}
        </button>
      </header>

      <div className="grid gap-8 md:grid-cols-[200px_1fr] md:items-start">
        {/* Dar ekranda yatay kaydırılan şerit, geniş ekranda yapışkan sütun.
            Menü her iki hâlde de aynı sırada: alışkanlık bozulmasın. */}
        <nav
          aria-label={t.account}
          className="-mx-5 overflow-x-auto px-5 md:mx-0 md:overflow-visible md:px-0 md:sticky md:top-[calc(var(--nav-h)+1.5rem)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <ul className="flex gap-2 md:flex-col md:gap-1">
            {items.map((item) => {
              const current = item.key === active;
              return (
                <li key={item.key} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={`focus-ring tag flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 transition-colors md:border-b-0 md:border-l-2 md:px-4 ${
                      current
                        ? "border-amber text-amber md:bg-amber/10"
                        : "border-transparent text-smoke hover:text-bone md:hover:bg-char"
                    }`}
                  >
                    {item.label}
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="font-mono text-[10px] tabular-nums text-smoke/70">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          <Link
            href="/speisekarte"
            className="focus-ring tag mt-4 hidden px-4 py-2.5 text-smoke transition-colors hover:text-amber md:block"
          >
            {t.backToMenu} →
          </Link>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
