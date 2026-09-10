import { getTranslations } from "@/lib/i18n/server";

/*
 * Sunucu bileşeni.
 *
 * Bu bölüm yalnızca çeviri okumak için `"use client"` yazılmıştı: hiçbir
 * durumu, olayı ya da tarayıcı API'si yok — düz biçimlendirme. Bedeli, iki
 * dilin tamamının bu bölümü içeren her sayfaya paket olarak gitmesiydi.
 * Metin artık sunucuda çözülüyor (`lib/i18n/server.ts`).
 */
export default async function Franchise() {
  const { t } = getTranslations();

  return (
    <section id="franchise" className="relative overflow-hidden bg-char py-24 md:py-32 border-t border-line">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        <div className="mb-14 max-w-3xl">
          <p className="tag text-flame mb-3">{t.franchise.tag}</p>
          <h2 className="section-title font-display font-extrabold text-bone mb-4">
            {t.franchise.title1}
            <br />
            <span className="text-flame">{t.franchise.title2}</span>
          </h2>
          <p className="font-display font-bold text-lg text-amber mb-4">
            {t.franchise.subTitle}
          </p>
          <p className="text-smoke text-sm md:text-base leading-relaxed">
            {t.franchise.description}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-line mb-14 border border-line">
          {t.franchise.stats.map((s, i) => (
            <div key={i} className="bg-void p-8 text-center md:text-left">
              <p className="font-display font-extrabold text-4xl md:text-5xl text-amber mb-2 tabular-nums">{s.v}</p>
              <p className="tag text-smoke">{s.k}</p>
            </div>
          ))}
        </div>

        {/* Feature box */}
        <div className="ember-surface border border-line p-8 md:p-12 grid lg:grid-cols-[1.4fr_1fr] gap-8 items-center">
          <div>
            <p className="tag text-amber mb-2">{t.franchise.chanceTitle}</p>
            <h3 className="font-display font-extrabold text-2xl md:text-3xl text-bone mb-4">
              {t.franchise.leadTitle}
            </h3>
            <p className="text-smoke text-sm md:text-base leading-relaxed mb-6">
              {t.franchise.leadDesc}
            </p>
            <p className="font-mono text-xs text-flame uppercase tracking-wider mb-6">
              {t.franchise.contactTitle}
            </p>
          </div>
          <div className="flex lg:justify-end">
            <a
              href="#top"
              className="focus-ring w-full lg:w-auto text-center bg-flame-gradient text-void font-display font-extrabold px-8 py-4 text-base hover:brightness-110 transition-[filter,transform] active:translate-y-px"
            >
              {t.franchise.joinBtn}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
