import Link from "next/link";
import { getCatalog, getStats, isVisible } from "@/lib/admin/store";
import { getOrderStats } from "@/lib/orders/stats";
import { getBusinessSettings } from "@/lib/orders/business";
import { isOpenNow } from "@/lib/orders/availability";
import { formatCents } from "@/lib/money";

/**
 * Panelin açılış ekranı.
 *
 * Tek bir soruya cevap verir: **şu an neye bakmam gerek?**
 *
 * Eskiden burası bir katalog raporuydu — altı sayaç kutusu, kategori dağılımı,
 * gizli ürün listesi. Hepsi doğru sayılardı ama hiçbiri "şimdi" ile ilgili
 * değildi; işletmeci güne baktığında sipariş sayısını bulmak için ekranın
 * yarısını geçmek zorundaydı ve kategori başına ürün sayısı hiçbir gün
 * kimsenin işine yaramadı.
 *
 * Şimdiki sıra bir vardiyanın sırası: sipariş alımı açık mı → bugün ne oldu →
 * bekleyen iş var mı → düzeltilmesi gereken bir şey var mı. Katalogun tamamı
 * kendi ekranında duruyor; buraya yalnızca **eylem gerektiren** artığı düşer.
 */

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const [stats, catalog, orders, business, openNow] = await Promise.all([
    getStats(),
    getCatalog(),
    getOrderStats(),
    getBusinessSettings(),
    isOpenNow(),
  ]);

  /*
   * Eylem gerektirenler.
   *
   * Sıfır olan satır listeye girmez: "0 tükenen ürün" bir bilgi değil, göz
   * yorgunluğudur. Liste tamamen boşsa bu da bir cevaptır ve öyle söylenir.
   */
  const attention = [
    {
      count: stats.missingLegalInfo,
      label: "üründe alerjen bilgisi eksik",
      hint: "Yasal zorunluluk (LMIV Art. 14).",
      tone: "text-flame",
    },
    {
      count: stats.outOfStock,
      label: "ürün tükendi olarak işaretli",
      hint: "Menüde görünmüyor.",
      tone: "text-amber",
    },
    {
      count: stats.hiddenFromMenu,
      label: "ürün menüde gizli",
      hint: "Aktif ama listelenmiyor.",
      tone: "text-amber",
    },
    {
      count: stats.passiveProducts,
      label: "ürün pasif",
      hint: "Sitede hiç görünmüyor.",
      tone: "text-smoke",
    },
  ].filter((row) => row.count > 0);

  // Menüde çıkmayan ürünlerin adları: sayı "hangisi?" sorusunu doğurur.
  const hidden = catalog.products.filter((product) => !isVisible(product));

  return (
    <div className="max-w-[1000px]">
      <header className="mb-8">
        <p className="tag mb-2 text-flame">Genel bakış</p>
        <h1 className="font-display text-3xl font-extrabold text-bone md:text-4xl">Bugün</h1>
      </header>

      {/*
        Durum şeridi.

        Panelin en pahalı sessiz arızası, kapalı kalmış bir sipariş anahtarıdır:
        site açık görünür, sipariş gelmez, kimse sebebini fark etmez. Bu yüzden
        ilk satır o.
      */}
      <section className="mb-8 flex flex-wrap items-center gap-3 border border-line bg-char px-5 py-4">
        <span
          className={`tag border px-3 py-1.5 ${
            business.orderingEnabled
              ? "border-herb/60 bg-herb/10 text-herb"
              : "border-flame bg-flame/15 text-flame"
          }`}
        >
          {business.orderingEnabled ? "● Sipariş alımı açık" : "● Sipariş alımı KAPALI"}
        </span>
        <span className="tag text-smoke">
          {openNow ? "Çalışma saati içinde" : "Çalışma saati dışında"}
        </span>
        <span className="tag text-smoke">
          {[business.deliveryEnabled && "Teslimat", business.pickupEnabled && "Gel-al"]
            .filter(Boolean)
            .join(" · ") || "Teslim biçimi seçili değil"}
        </span>
        <Link
          href="/admin/betrieb"
          className="focus-ring tag ml-auto text-smoke transition-colors hover:text-amber"
        >
          Değiştir →
        </Link>
      </section>

      {/* Bekleyen sipariş her şeyin önüne geçer. */}
      {orders.unacknowledged > 0 && (
        <Link
          href="/admin/orders"
          className="focus-ring tag mb-8 block animate-pulse border border-flame bg-flame/10 px-5 py-4 text-center text-flame transition-colors hover:bg-flame hover:text-void"
        >
          {orders.unacknowledged} YENİ SİPARİŞ BEKLİYOR →
        </Link>
      )}

      {/*
        Günün sayıları. "Bugün" işletmenin yerel günüdür (Europe/Berlin) ve
        ciroya yalnızca ödemesi alınmış siparişler girer — bkz. lib/orders/stats.ts.
      */}
      <section className="mb-3 grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        {[
          { value: String(orders.todayOrders), label: "Sipariş", tone: "text-bone" },
          { value: formatCents(orders.todayRevenueCents), label: "Ciro", tone: "text-herb" },
          {
            value: formatCents(orders.todayAverageCents),
            label: "Ortalama sepet",
            tone: "text-amber",
          },
          {
            value: String(orders.activeOrders),
            label: "Akışta",
            tone: orders.activeOrders > 0 ? "text-bone" : "text-smoke",
          },
        ].map((tile) => (
          <div key={tile.label} className="bg-char p-6">
            <p className={`font-display text-3xl font-extrabold tabular-nums ${tile.tone}`}>
              {tile.value}
            </p>
            <p className="tag mt-2 text-smoke">{tile.label}</p>
          </div>
        ))}
      </section>

      <div className="mb-10 flex flex-wrap items-center justify-between gap-3">
        <p className="tag text-smoke/70">
          Son 7 gün: {orders.weekOrders} sipariş · {formatCents(orders.weekRevenueCents)}
        </p>
        <Link
          href="/admin/finanzen"
          className="focus-ring tag border border-line px-4 py-2.5 text-smoke transition-colors hover:border-amber hover:text-amber"
        >
          CİRO VE ÖDEMELER →
        </Link>
      </div>

      {/* --- eylem gerektirenler --- */}
      <section className="mb-10">
        <h2 className="mb-4 font-display text-xl font-extrabold text-bone">Bakılacaklar</h2>

        {attention.length === 0 ? (
          <p className="border border-line bg-char px-5 py-6 text-sm text-smoke">
            Bekleyen bir şey yok — tüm ürünler yayında ve bilgileri tam.
          </p>
        ) : (
          <ul className="divide-y divide-line border border-line">
            {attention.map((row) => (
              <li key={row.label} className="flex items-center gap-4 bg-char px-5 py-4">
                <span className={`font-display text-2xl font-extrabold tabular-nums ${row.tone}`}>
                  {row.count}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-bone">{row.label}</span>
                  <span className="block text-xs text-smoke">{row.hint}</span>
                </span>
                <Link
                  href="/admin/products"
                  className="focus-ring tag shrink-0 text-smoke transition-colors hover:text-amber"
                >
                  Aç →
                </Link>
              </li>
            ))}
          </ul>
        )}

        {hidden.length > 0 && (
          <details className="mt-3 border border-line bg-char px-5 py-3">
            <summary className="focus-ring tag cursor-pointer text-smoke hover:text-amber">
              Sitede görünmeyen {hidden.length} ürün
            </summary>
            <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
              {hidden.map((product) => (
                <li key={product.id} className="flex items-center justify-between gap-4 text-sm">
                  <span className="min-w-0 truncate text-bone">{product.name}</span>
                  <span className="tag shrink-0 whitespace-nowrap text-smoke">
                    {!product.active ? "pasif" : !product.inStock ? "tükendi" : "menüde gizli"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* Katalogun tamamı kendi ekranında; buradaki tek satır yalnızca ölçek. */}
      <p className="tag text-smoke/70">
        Katalog: {stats.totalProducts} ürün · {stats.visibleProducts} menüde ·{" "}
        {stats.categories} kategori
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/admin/products"
          className="focus-ring tag border border-amber px-5 py-3 text-amber transition-colors hover:bg-amber hover:text-void"
        >
          ÜRÜNLERİ YÖNET →
        </Link>
        <Link
          href="/admin/categories"
          className="focus-ring tag border border-line px-5 py-3 text-bone transition-colors hover:border-amber hover:text-amber"
        >
          KATEGORİLER →
        </Link>
      </div>
    </div>
  );
}
