/**
 * Ödeme sayfası iskeleti.
 *
 * Sayfa katalogu ve teslimat bölgelerini sunucuda okuyor; o sırada ekran
 * bomboş kalıyordu ve müşteri "Kasaya git"e bastıktan sonra hiçbir şey
 * olmadığını sanıp ikinci kez basıyordu.
 *
 * İskelet gerçek düzenin ölçülerini taşır (mobilde tek kolon, `lg:` üstünde
 * sağda 380 px'lik özet), böylece içerik geldiğinde sayfa zıplamaz.
 */
export default function CheckoutLoading() {
  const bar = (className: string) => (
    <div className={`animate-pulse bg-line/40 ${className}`} />
  );

  return (
    <div className="min-h-screen bg-void pt-[var(--nav-h)]" aria-busy="true" aria-live="polite">
      <span className="sr-only">Lädt …</span>
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {bar("h-4 w-32")}
          {bar("h-9 w-64")}
          <div className="space-y-4 border border-line p-5">
            {bar("h-3 w-24")}
            {bar("h-12 w-full")}
            {bar("h-3 w-24")}
            {bar("h-12 w-full")}
            {bar("h-3 w-24")}
            {bar("h-12 w-full")}
          </div>
          <div className="space-y-4 border border-line p-5">
            {bar("h-3 w-32")}
            {bar("h-12 w-full")}
            {bar("h-12 w-full")}
          </div>
        </div>

        <div className="space-y-4 border border-line p-5 lg:sticky lg:top-[calc(var(--nav-h)+1.5rem)] lg:self-start">
          {bar("h-3 w-20")}
          {bar("h-5 w-full")}
          {bar("h-5 w-3/4")}
          {bar("h-px w-full")}
          {bar("h-8 w-1/2")}
          {bar("h-11 w-full")}
        </div>
      </div>
    </div>
  );
}
