"use client";

import { useCart } from "@/lib/cart";
import { formatCents } from "@/lib/money";
import { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * Mobil sepet çubuğu — ekranın altında, menünün üstünde.
 *
 * Siparişlerin çoğu telefondan geliyor ve telefonda sepet düğmesi sayfanın en
 * üstünde, kaydırılıp gitmiş bir başlığın içinde duruyordu: müşteri altmış
 * satırlık menüde aşağı indikçe sepetine ne kadar tuttuğunu göremiyor,
 * görmek için yukarı kaydırmak zorunda kalıyordu. Çubuk bu yüzden yapışkan ve
 * bu yüzden **tutarı da** gösteriyor — sayaç tek başına "ne kadar tuttu"
 * sorusunu cevaplamıyor.
 *
 * Masaüstünde çizilmez (`md:hidden`): orada başlıktaki sepet düğmesi her zaman
 * görünür durumda ve ikinci bir çubuk yalnızca yer kaplardı.
 *
 * Çekmece açıkken de çizilmez: altında duran bir çubuk, çekmecenin kendi
 * "Zur Kasse" düğmesiyle yarışırdı.
 */
export default function CartBar() {
  const { t } = useLanguage();
  const { count, quote, pricing, isOpen, openCart, loaded } = useCart();

  // `loaded` beklenir: ilk render'da sepet her zaman boştur (SSR uyumu) ve
  // çubuğun bir anlığına belirip kaybolması, sayfanın zıplaması demek olurdu.
  if (!loaded || isOpen || count === 0) return null;

  const subtotal = quote !== null && pricing !== "error" ? formatCents(quote.subtotalCents) : "…";

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] border-t border-line bg-void/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md md:hidden">
      <button
        type="button"
        onClick={openCart}
        aria-label={t.ordering.cart.barLabel}
        className="focus-ring flex min-h-[52px] w-full items-center justify-between gap-3 border border-amber bg-amber/10 px-4 text-amber transition-colors hover:bg-amber hover:text-void"
      >
        <span className="tag">
          {t.ordering.cart.barItems.replace("{count}", String(count))}
        </span>
        <span className="font-display text-lg font-extrabold tabular-nums">{subtotal}</span>
      </button>
    </div>
  );
}
