"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Admin kabuğu: sidebar + içerik alanı.
 *
 * Giriş sayfası kabuğun dışında kalır (henüz oturum yok, menü gösterilmemeli).
 * Masaüstünde sabit sidebar, mobil/tablette açılır-kapanır çekmece.
 *
 * Kenar çubuğu ayrıca bir **nöbetçidir**: akıştaki sipariş sayısı "Siparişler"
 * satırının yanında durur. İşletmeci gün boyu ürün/fiyat ekranlarında
 * dolaşıyor; sipariş geldiğini öğrenmek için sipariş panosuna gitmiş olması
 * gerekmemeli.
 */

/**
 * Sayaç yoklama aralığı.
 *
 * Sipariş panosunun kendi yoklaması beş saniyede bir (orada gecikme pahalı).
 * Buradaki rozet yalnızca "bir şey var" der; on beş saniye, panelin her
 * sayfasında dönen bir istek için doğru denge.
 */
const ORDER_POLL_MS = 15_000;

/**
 * Menü iki öbekte.
 *
 * Sekiz satır eşit ağırlıkta dizildiğinde her açılışta baştan okunuyordu; oysa
 * bunların üçü **her gün**, beşi ayda bir açılır. Ayrım o: üstte vardiyanın
 * kendisi, altta kurulum. Bir başlık ve bir çizgi, sekiz seçeneği "üç şey artı
 * ayarlar"a indiriyor.
 */
const NAV_GROUPS: {
  label: string | null;
  items: { href: string; label: string; exact: boolean; pulse?: boolean }[];
}[] = [
  {
    label: null,
    items: [
      { href: "/admin", label: "Bugün", exact: true },
      { href: "/admin/orders", label: "Siparişler", exact: false, pulse: true },
      { href: "/admin/finanzen", label: "Ciro ve ödemeler", exact: false },
    ],
  },
  {
    label: "Ayarlar",
    items: [
      { href: "/admin/products", label: "Ürünler", exact: false },
      { href: "/admin/categories", label: "Kategoriler", exact: false },
      { href: "/admin/pricing", label: "Fiyat ayarları", exact: false },
      { href: "/admin/zones", label: "Teslimat bölgeleri", exact: false },
      { href: "/admin/betrieb", label: "İşletme", exact: false },
    ],
  },
];

type OrderPulse = { active: number; unacknowledged: number };

/**
 * Akıştaki sipariş sayısını yoklar.
 *
 * Hata sessizce yutulur: rozet bir bilgi kaynağıdır, bir alarm sistemi değil —
 * geçici bir ağ arızasında panelin her sayfasına kırmızı bir hata basmak,
 * çözdüğünden çok gürültü üretirdi. Sipariş panosu bağlantı kopmasını zaten
 * kendi başına bildiriyor.
 */
function useOrderPulse(enabled: boolean): OrderPulse | null {
  const [pulse, setPulse] = useState<OrderPulse | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await fetch("/api/admin/orders/count", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) return;
        setPulse((await response.json()) as OrderPulse);
      } catch {
        // Geçici arıza; rozet son bilinen sayıda kalır.
      }
    };

    void load();
    const id = setInterval(() => void load(), ORDER_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [enabled]);

  return pulse;
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Giriş ekranında oturum yok: yoklama 401 döndürürdü.
  const pulse = useOrderPulse(pathname !== "/admin/login");

  if (pathname === "/admin/login") return <>{children}</>;

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
      router.replace("/admin/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV_GROUPS.map((group, index) => (
        <div key={group.label ?? "main"} className={index > 0 ? "mt-5" : ""}>
          {group.label && (
            <p className="tag border-t border-line px-4 pb-2 pt-4 text-smoke/50">
              {group.label}
            </p>
          )}
          {group.items.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const badge = item.pulse ? pulse : null;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setNavOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`focus-ring tag flex items-center gap-3 px-4 py-3 border-l-2 transition-colors ${
                  active
                    ? "border-amber text-amber bg-amber/10"
                    : "border-transparent text-smoke hover:text-bone hover:bg-panel"
                }`}
              >
                <span className="min-w-0 flex-1">{item.label}</span>
                {badge && badge.active > 0 && <OrderBadge pulse={badge} />}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-void text-bone flex flex-col lg:flex-row">
      {/* mobil üst çubuk */}
      <header className="lg:hidden flex items-center justify-between gap-4 px-5 py-4 border-b border-line bg-char sticky top-0 z-40">
        <Link href="/admin" className="focus-ring font-display font-extrabold text-base">
          SAMİ´S <span className="text-flame">// PANEL</span>
        </Link>
        <div className="flex items-center gap-3">
          {/* Menü kapalıyken rozet de kapalı kalmasın: mobilde tek görünen
              satır bu çubuk. */}
          {!navOpen && pulse && pulse.active > 0 && <OrderBadge pulse={pulse} />}
          <button
            onClick={() => setNavOpen((v) => !v)}
            aria-expanded={navOpen}
            className="focus-ring tag border border-line px-3 py-2 hover:border-amber"
          >
            {navOpen ? "KAPAT ✕" : "MENÜ ☰"}
          </button>
        </div>
      </header>

      {navOpen && (
        <div className="lg:hidden border-b border-line bg-char px-2 py-3">
          {nav}
          <SidebarFooter onLogout={logout} loggingOut={loggingOut} />
        </div>
      )}

      {/* masaüstü sidebar */}
      <aside className="hidden lg:flex w-[248px] shrink-0 flex-col border-r border-line bg-char sticky top-0 h-screen">
        <div className="px-6 py-7 border-b border-line">
          <Link href="/admin" className="focus-ring font-display font-extrabold text-lg leading-tight block">
            SAMİ´S
            <br />
            <span className="text-flame">// PANEL</span>
          </Link>
        </div>
        <div className="flex-1 py-5 px-2 overflow-y-auto">{nav}</div>
        <SidebarFooter onLogout={logout} loggingOut={loggingOut} />
      </aside>

      <main className="flex-1 min-w-0 px-5 md:px-8 lg:px-10 py-8 md:py-10">{children}</main>
    </div>
  );
}

/**
 * Akıştaki sipariş rozeti.
 *
 * İki kademe var ve ayrımları önemli: **kırmızı ve yanıp sönen** rozet henüz
 * "Görüldü" denmemiş sipariş demektir — birinin şimdi bakması gerekir. Sarı
 * rozet ise mutfakta işlenen siparişleri sayar; bilgi verir, acele istemez.
 * Tek renk kullanmak ikisini eşitler ve bir süre sonra ikisi de görmezden
 * gelinirdi.
 */
function OrderBadge({ pulse }: { pulse: OrderPulse }) {
  const fresh = pulse.unacknowledged > 0;
  return (
    <span
      aria-label={
        fresh
          ? `${pulse.unacknowledged} yeni sipariş, toplam ${pulse.active} aktif`
          : `${pulse.active} aktif sipariş`
      }
      className={`tag shrink-0 border px-2 py-0.5 tabular-nums ${
        fresh
          ? "animate-pulse border-flame bg-flame text-void"
          : "border-amber/60 bg-amber/15 text-amber"
      }`}
    >
      {pulse.active}
    </span>
  );
}

function SidebarFooter({
  onLogout,
  loggingOut,
}: {
  onLogout: () => void;
  loggingOut: boolean;
}) {
  return (
    <div className="border-t border-line p-4 mt-3 lg:mt-0 space-y-2">
      <Link
        href="/"
        className="focus-ring tag block px-4 py-3 text-smoke hover:text-bone hover:bg-panel transition-colors"
      >
        ← Siteyi görüntüle
      </Link>
      <button
        onClick={onLogout}
        disabled={loggingOut}
        className="focus-ring tag w-full text-left px-4 py-3 text-smoke hover:text-flame hover:bg-panel transition-colors disabled:opacity-40"
      >
        {loggingOut ? "Çıkılıyor…" : "Çıkış"}
      </button>
    </div>
  );
}
