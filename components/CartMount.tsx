"use client";

import { usePathname } from "next/navigation";
import CartDrawer from "@/components/CartDrawer";

/**
 * Sepet çekmecesinin nerede çizileceğine karar veren tek yer.
 *
 * Çekmece kök düzende duruyor, yani panel dahil **her** rotada monte
 * ediliyordu. Bunun iki bedeli vardı: mutfaktaki tabletin ekranında müşteri
 * sepetinin açılabilmesi (çalışan yanlışlıkla açtığında sipariş akışını
 * kapatıyor), ve sepette satır varken `CartProvider`'ın panel açıkken de
 * `/api/menu/quote` yoklaması — mutfak ekranı zaten 5 sn'de bir sipariş
 * çekiyor, üstüne fiyat isteği eklemenin hiçbir karşılığı yok.
 *
 * Sağlayıcı kaldırılmaz, yalnızca yüzey kaldırılır: `useCart()` panel altındaki
 * bileşenler için de çalışmaya devam eder, sadece görünür çekmece çizilmez.
 */
export default function CartMount() {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;
  return <CartDrawer />;
}
