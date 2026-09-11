import type { Metadata } from "next";
import ServiceFeeCard from "@/components/admin/ServiceFeeCard";
import ZoneManager from "@/components/admin/ZoneManager";
import { getSettings } from "@/lib/admin/store";
import { listDeliveryZones } from "@/lib/orders/zones";

/**
 * Teslimat ve ücretler.
 *
 * Müşterinin ödediği iki ek kalem burada: her siparişe binen servis ücreti ve
 * posta koduna göre değişen kurye ücreti. İkincisi baştan buradaydı, ilki
 * "Fiyat ayarları" adında ayrı bir sayfada duruyordu — o sayfanın geri kalanı
 * kaldırılan "Kendin Seç" bölümüne aitti. Tek ekran, sırayla: sabit ücret,
 * sonra bölge bölge ücret.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Teslimat ve ücretler // Panel",
  robots: { index: false, follow: false },
};

export default async function AdminZonesPage() {
  const [zones, settings] = await Promise.all([listDeliveryZones(), getSettings()]);

  return (
    <div className="min-w-0 max-w-[1000px]">
      <header className="mb-8">
        <p className="tag mb-2 text-flame">Sipariş</p>
        <h1 className="font-display text-3xl font-extrabold text-bone md:text-4xl">
          Teslimat ve ücretler
        </h1>
      </header>

      <ServiceFeeCard settings={settings} />
      <ZoneManager zones={zones} />
    </div>
  );
}
