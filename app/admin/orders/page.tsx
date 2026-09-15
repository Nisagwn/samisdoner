import type { Metadata } from "next";
import OrderFeed from "@/components/admin/OrderFeed";
import ShiftControls from "@/components/admin/ShiftControls";
import RewardRedeem from "@/components/admin/RewardRedeem";

/**
 * Sipariş takibi.
 *
 * Sayfanın kendisi veri çekmez: liste sürekli tazelendiği için tamamı istemci
 * tarafındaki `OrderFeed` içinde yaşar. Sunucuda bir kez render edilip
 * beş saniye sonra eskiyecek bir liste üretmenin anlamı yok.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Siparişler // Panel",
  robots: { index: false, follow: false },
};

export default function AdminOrdersPage() {
  return (
    <div className="space-y-6">
      <header>
        <p className="tag text-flame">Sipariş takibi</p>
        <h1 className="mt-2 font-display text-2xl font-extrabold text-bone">Siparişler</h1>
        <p className="mt-2 text-sm text-smoke">
          Sesli uyarı, siparişe &quot;Görüldü&quot; denene kadar sürer.
        </p>
      </header>

      {/* Vardiya şeridi panonun ÜSTÜNDE: yoğunluk cevabı sipariş listesine
          bakarken verilir, ayarlar ekranına gidilerek değil. */}
      <ShiftControls />

      {/* Ödül kodu panonun içinde: müşteri kodu telefonda ya da kapıda
          söylüyor, yani bu iş tam olarak panoya bakılırken yapılıyor. */}
      <div className="flex flex-wrap gap-3">
        <RewardRedeem />
      </div>

      <OrderFeed />
    </div>
  );
}
