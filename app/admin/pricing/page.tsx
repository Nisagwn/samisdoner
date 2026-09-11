import { redirect } from "next/navigation";

/**
 * Eski fiyat ayarları adresi.
 *
 * Sayfada iki blok vardı: servis ücreti ve kaldırılan "Kendin Seç"
 * yapılandırıcısının ek ücretleri. İkincisi gidince tek başına bir sayfayı
 * hak etmeyen iki alan kaldı; ikisi de teslimat ekranına taşındı — ücretlerin
 * tamamı artık tek yerde.
 */
export default function AdminPricingRedirect() {
  redirect("/admin/zones");
}
