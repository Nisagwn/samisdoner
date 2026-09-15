"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AdminRole } from "@prisma/client";
import { ROLE_LABELS, can, type AdminPermission } from "@/lib/admin/roles";

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
 * Dokuz satır eşit ağırlıkta dizildiğinde her açılışta baştan okunuyordu; oysa
 * bunların üçü **her gün**, kalanı ayda bir açılır. Ayrım o: üstte vardiyanın
 * kendisi, altta kurulum.
 *
 * Kurulum tarafı altı satırdan üçe indi ve her satırın altına ne yaptığı
 * yazıldı. İkisi bir arada bir şikâyeti çözüyor: "Ürünler" ile "Kategoriler"
 * yan yana iki eşit satırken kategorinin buradan düzenlenebildiği
 * anlaşılmıyordu, "Fiyat ayarları" ile "Teslimat bölgeleri" ise ikisi de ücret
 * tuttuğu için hangisinin arandığı belirsizdi. Şimdi menü satırının kendisi
 * "burada ne var" sorusunu cevaplıyor; başlık tek başına cevaplamıyordu.
 */
const NAV_GROUPS: {
  label: string | null;
  items: {
    href: string;
    label: string;
    hint?: string;
    exact: boolean;
    pulse?: boolean;
    /**
     * Satırın görünmesi için gereken izin. Verilmezse herkese görünür.
     *
     * Menüyü gizlemek **koruma değildir** — adresi doğrudan yazan biri sayfayı
     * açabilir; koruma sayfanın ve ucun kendisinde (bkz. lib/admin/guard.ts).
     * Buradaki amaç, personelin hiç açamayacağı ekranlara bakıp "bende neden
     * çalışmıyor" diye uğraşmasını önlemek.
     */
    permission?: AdminPermission;
  }[];
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
    label: "Kurulum",
    items: [
      {
        href: "/admin/bewertungen",
        label: "Değerlendirmeler",
        hint: "Yorumlar, puanlar, cevaplar",
        exact: false,
        permission: "reviews" as const,
      },
      {
        href: "/admin/menu",
        label: "Menü",
        hint: "Ürünler, kategoriler, fiyatlar",
        exact: false,
      },
      {
        href: "/admin/zones",
        label: "Teslimat ve ücretler",
        hint: "Posta kodu, servis ücreti",
        exact: false,
      },
      {
        /*
         * Kupon, menünün hemen altında ve `catalog` yetkisinde: kampanya açmak
         * fiyat belirlemenin bir biçimi ve hatasının bedeli de aynı — yanlış
         * girilmiş bir kupon günlerce fark edilmeden her siparişte para
         * kaybettirir.
         */
        href: "/admin/gutscheine",
        label: "İndirim kuponları",
        hint: "Kampanya kodları, geçerlilik",
        exact: false,
        permission: "catalog" as const,
      },
      {
        href: "/admin/betrieb",
        label: "İşletme",
        hint: "Çalışma saati, sipariş anahtarı",
        exact: false,
        permission: "business" as const,
      },
      {
        href: "/admin/personal",
        label: "Personel",
        hint: "Panele kim girebilir, ne yapabilir",
        exact: false,
        permission: "staff" as const,
      },
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

export default function AdminShell({
  role,
  children,
}: {
  /**
   * Oturumdaki rol. Sunucu düzeninden geçer; istemci onu yalnızca menüyü
   * kısaltmak için kullanır, yetki kararı için değil.
   */
  role: AdminRole;
  children: React.ReactNode;
}) {
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
          {group.items
            .filter((item) => !item.permission || can(role, item.permission))
            .map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const badge = item.pulse ? pulse : null;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setNavOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`focus-ring flex items-center gap-3 border-l-2 px-4 py-3 transition-colors ${
                  active
                    ? "border-amber bg-amber/10 text-amber"
                    : "border-transparent text-smoke hover:bg-panel hover:text-bone"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="tag block">{item.label}</span>
                  {item.hint && (
                    <span className="mt-1 block text-[11px] leading-snug text-smoke/60">
                      {item.hint}
                    </span>
                  )}
                </span>
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
          <SidebarFooter role={role} onLogout={logout} loggingOut={loggingOut} />
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
        <SidebarFooter role={role} onLogout={logout} loggingOut={loggingOut} />
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
  role,
  onLogout,
  loggingOut,
}: {
  role: AdminRole;
  onLogout: () => void;
  loggingOut: boolean;
}) {
  return (
    <div className="border-t border-line p-4 mt-3 lg:mt-0 space-y-2">
      {/* Hangi rolle bakıldığı yazılı dursun: eksik bir menü satırı, yetkinin
          dar olmasından mı yoksa bir arızadan mı kaynaklandığı bilinmeden
          bakıldığında hep arıza sanılır. */}
      <p className="tag px-4 pb-1 text-smoke/50">{ROLE_LABELS[role]} olarak girildi</p>
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
