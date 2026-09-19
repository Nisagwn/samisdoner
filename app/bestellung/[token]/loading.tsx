/**
 * Sipariş takip sayfası iskeleti.
 *
 * Bu sayfaya girilen an, ödemeden dönülen andır: müşteri parasının gidip
 * gitmediğini bilmiyor. Boş bir ekran o saniyede en kötü cevaptır. Sayfa
 * jetonu doğrulayıp siparişi okurken en azından bir çerçeve durur.
 *
 * Otomatik tazelemede (`AutoRefresh`) bu iskelet görünmez — o gezinme değil,
 * yerinde yenilemedir.
 */
export default function OrderLoading() {
  const bar = (className: string) => (
    <div className={`animate-pulse bg-line/40 ${className}`} />
  );

  return (
    <main className="min-h-dvh bg-void px-5 py-16 text-bone" aria-busy="true" aria-live="polite">
      <span className="sr-only">Lädt …</span>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        {bar("h-4 w-28")}
        {bar("h-10 w-3/4")}
        <div className="space-y-4 border border-line p-6">
          {bar("h-3 w-24")}
          {bar("h-6 w-1/2")}
          {bar("h-px w-full")}
          {bar("h-4 w-full")}
          {bar("h-4 w-5/6")}
        </div>
        <div className="space-y-3 border border-line p-6">
          {bar("h-3 w-20")}
          {bar("h-4 w-full")}
          {bar("h-4 w-2/3")}
        </div>
      </div>
    </main>
  );
}
