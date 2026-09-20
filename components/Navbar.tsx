"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/lib/cart";
import { useLanguage } from "@/lib/i18n/LanguageContext";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { count, openCart } = useCart();
  const { lang, setLang, t } = useLanguage();
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = () => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    window.scrollTo({ top: 0, behavior });
  };

  /*
   * Gezinme.
   *
   * İki tür bağlantı var ve ayrımı `exact` alanı taşır:
   *  - **Sayfa** bağlantıları (`/`, `/speisekarte`, `/ueber-uns`) aktif
   *    işaretlenebilir; hangi sayfada olduğunuzu gösterirler.
   *  - **Çapa** bağlantısı (`/#filialen`) ana sayfanın bir bölümüdür, sayfa
   *    değil — hiçbir zaman aktif işaretlenmez.
   *
   * Tanıtım bölümleri `/ueber-uns` sayfasına taşındığı için "Hakkımızda" artık
   * ana sayfanın bir çapasına değil o sayfaya gider. Franchise bağlantısı
   * navigasyondan çıkarıldı; bölüm `/ueber-uns` içinde duruyor ve altbilgide
   * bağlantısı var, dolayısıyla erişilebilirliği kaybolmadı.
   */
  const LINKS: { href: string; label: string; exact?: boolean }[] = [
    { href: "/", label: t.nav.home, exact: true },
    { href: "/speisekarte", label: t.nav.menu },
    { href: "/#filialen", label: t.nav.filialen },
    { href: "/ueber-uns", label: t.nav.unternehmen },
  ];

  /**
   * Bağlantı bulunduğumuz sayfayı mı gösteriyor.
   *
   * Çapa bağlantıları (`#` içerenler) her zaman pasiftir: ana sayfadayken
   * "Konum"u da işaretlemek iki bağlantıyı aynı anda vurgulardı ve işaret
   * hiçbir şey anlatmazdı.
   *
   * "Ana Sayfa" tam eşleşme ister; `startsWith` kullanılsaydı "/" her yolun
   * ön eki olduğu için her sayfada aktif görünürdü.
   */
  const isActive = (link: { href: string; exact?: boolean }): boolean => {
    if (link.href.includes("#")) return false;
    return link.exact ? pathname === link.href : pathname.startsWith(link.href);
  };

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
        scrolled ? "bg-void/90 backdrop-blur-md border-b border-line shadow-[0_14px_50px_rgba(0,0,0,0.4)]" : "bg-transparent"
      }`}
    >
      {/* Buradaki turuncu adres/telefon şeridi kaldırıldı: her sayfanın en
          üstünde duran parlak bir bant, sayfaya bakan gözün ilk gördüğü şey
          oluyordu. Aynı bilgi Konum bölümünde ve altbilgide duruyor. */}

      <nav className="max-w-[1400px] mx-auto flex items-center justify-between gap-2 px-4 sm:px-6 md:px-10 py-3">
        <Link href="/" className="focus-ring font-display font-extrabold text-base sm:text-lg md:text-xl tracking-tight text-bone shrink-0">
          SAMİ´S <span className="text-amber">//</span> DÖNER
        </Link>

        {/* Desktop Links */}
        <ul className="hidden lg:flex items-center gap-6 tag text-smoke">
          {LINKS.map((l) => {
            const active = isActive(l);
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  // Aktif işaret dolgu değil ince alt çizgi: dolgu bir düğme
                  // gibi görünüp "tıkla" diyordu, oysa zaten oradasınız.
                  className={`focus-ring block border-b-2 pb-0.5 transition-colors ${
                    active
                      ? "border-amber text-amber"
                      : "border-transparent hover:text-amber"
                  }`}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          {/* Language Switcher */}
          <div className="flex items-center border border-line bg-char rounded-none">
            <button
              onClick={() => setLang("tr")}
              className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 text-xs font-mono tracking-wider transition-colors ${
                lang === "tr" ? "bg-amber text-void font-bold" : "text-smoke hover:text-bone"
              }`}
              aria-label="Türkçe"
            >
              TR
            </button>
            <button
              onClick={() => setLang("de")}
              className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 text-xs font-mono tracking-wider transition-colors ${
                lang === "de" ? "bg-amber text-void font-bold" : "text-smoke hover:text-bone"
              }`}
              aria-label="Deutsch"
            >
              DE
            </button>
          </div>

          {/* Hesap.
              Bağlantı her zaman /konto'yu gösterir; oturum yoksa o sayfa
              girişe yönlendirir. Navbar istemci bileşeni olduğu için oturumu
              burada okumak, her sayfada ek bir istek anlamına gelirdi —
              yönlendirme kararı zaten sunucuda veriliyor. */}
          <Link
            href="/konto"
            aria-label={t.nav.account}
            className="focus-ring tag hidden min-h-[44px] items-center border border-line px-3 text-smoke transition-colors hover:border-amber hover:text-amber sm:inline-flex"
          >
            {t.nav.account}
          </Link>

          {/* Cart Button */}
          <button
            onClick={openCart}
            aria-label={`${t.nav.cart} — ${t.nav.cartItemCount.replace("{count}", String(count))}`}
            className="focus-ring relative tag inline-flex min-h-[44px] items-center justify-center border border-amber px-2.5 text-amber transition-colors hover:bg-amber hover:text-void sm:px-3 md:px-4"
          >
            {t.nav.cart}
            {count > 0 && (
              <span className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 bg-herb text-void font-mono text-[11px] leading-5 text-center shadow-[0_0_20px_rgba(123,214,111,0.75)] font-bold">
                {count}
              </span>
            )}
          </button>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="lg:hidden focus-ring tag inline-flex min-h-[44px] min-w-[44px] items-center justify-center border border-line text-smoke transition-colors hover:border-amber"
            aria-label={t.nav.menu}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? "✕" : "☰"}
          </button>
        </div>
      </nav>

      {/* Mobile Drawer Navigation */}
      {mobileOpen && (
        <div className="lg:hidden bg-char/95 backdrop-blur-lg border-b border-line px-6 py-6 space-y-4">
          <ul className="space-y-3 tag text-smoke">
            {LINKS.map((l) => {
              const active = isActive(l);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    onClick={() => setMobileOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-[44px] items-center border-l-2 pl-3 text-sm transition-colors ${
                      active
                        ? "border-amber text-amber"
                        : "border-transparent text-bone hover:text-amber"
                    }`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="pt-4 border-t border-line flex items-center justify-between">
            <span className="tag text-smoke">SPRACHE:</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setLang("tr");
                  setMobileOpen(false);
                }}
                className={`inline-flex min-h-[44px] items-center justify-center px-3 text-xs font-mono border ${
                  lang === "tr" ? "border-amber text-amber bg-amber/10" : "border-line text-smoke"
                }`}
              >
                TÜRKÇE (TR)
              </button>
              <button
                onClick={() => {
                  setLang("de");
                  setMobileOpen(false);
                }}
                className={`inline-flex min-h-[44px] items-center justify-center px-3 text-xs font-mono border ${
                  lang === "de" ? "border-amber text-amber bg-amber/10" : "border-line text-smoke"
                }`}
              >
                DEUTSCH (DE)
              </button>
            </div>
          </div>
        </div>
      )}

      {scrolled && (
        <button
          type="button"
          onClick={scrollToTop}
          aria-label={t.nav.backToTop}
          className="focus-ring fixed bottom-5 right-4 z-50 inline-flex min-h-[44px] min-w-[44px] items-center justify-center border border-amber bg-void/90 px-3 text-lg text-amber shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-colors hover:bg-amber hover:text-void sm:bottom-6 sm:right-6"
        >
          ↑
        </button>
      )}
    </header>
  );
}
