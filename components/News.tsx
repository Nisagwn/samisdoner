import { getTranslations } from "@/lib/i18n/server";

/*
 * Sunucu bileşeni.
 *
 * Bu bölüm yalnızca çeviri okumak için `"use client"` yazılmıştı: hiçbir
 * durumu, olayı ya da tarayıcı API'si yok — düz biçimlendirme. Bedeli, iki
 * dilin tamamının bu bölümü içeren her sayfaya paket olarak gitmesiydi.
 * Metin artık sunucuda çözülüyor (`lib/i18n/server.ts`).
 */
export default async function News() {
  const { t } = getTranslations();

  return (
    <section id="blog" className="relative overflow-hidden bg-void py-24 md:py-32 border-t border-line">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        <div className="mb-14">
          <p className="tag text-flame mb-3">{t.news.tag}</p>
          <h2 className="section-title font-display font-extrabold text-bone">
            {t.news.title}
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {t.news.items.map((art) => (
            <article
              key={art.id}
              className="kinetic-card border border-line bg-char p-6 flex flex-col justify-between hover:border-amber transition-colors duration-300"
            >
              <div>
                <span className="tag text-amber block mb-3">{t.news.badge}</span>
                <h3 className="font-display font-bold text-lg text-bone mb-3 leading-snug [overflow-wrap:anywhere]">
                  {art.title}
                </h3>
                <p className="text-smoke text-sm leading-relaxed mb-6">
                  {art.summary}
                </p>
              </div>

              <a
                href="#top"
                className="tag text-flame hover:text-amber transition-colors inline-flex items-center gap-1"
              >
                {t.news.readMore}
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
