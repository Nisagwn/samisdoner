import { getTranslations } from "@/lib/i18n/server";

/*
 * Sunucu bileşeni.
 *
 * Bu bölüm yalnızca çeviri okumak için `"use client"` yazılmıştı: hiçbir
 * durumu, olayı ya da tarayıcı API'si yok — düz biçimlendirme. Bedeli, iki
 * dilin tamamının bu bölümü içeren her sayfaya paket olarak gitmesiydi.
 * Metin artık sunucuda çözülüyor (`lib/i18n/server.ts`).
 */
export default async function Reviews() {
  const { t } = getTranslations();

  return (
    <section id="bewertungen" className="relative overflow-hidden bg-char py-24 md:py-32 border-t border-line">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-14 border-b border-line pb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="font-display font-black text-4xl text-amber">{t.reviews.rating}</span>
              <span className="text-amber text-xl">★★★★★</span>
              <span className="tag text-smoke">{t.reviews.count}</span>
            </div>
            <h2 className="section-title font-display font-extrabold text-bone">
              {t.reviews.subTitle}
            </h2>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {t.reviews.items.map((rev, i) => (
            <div
              key={i}
              className="kinetic-card border border-line bg-void/60 p-6 flex flex-col justify-between"
            >
              <p className="text-smoke text-sm leading-relaxed mb-6 italic">
                {rev.text}
              </p>
              <div className="border-t border-line/60 pt-4 flex items-center justify-between">
                <span className="font-display font-bold text-bone text-sm">{rev.name}</span>
                <span className="text-amber text-xs">{rev.stars}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
