import { getTranslations } from "@/lib/i18n/server";

/*
 * Sunucu bileşeni.
 *
 * Bu bölüm yalnızca çeviri okumak için `"use client"` yazılmıştı: hiçbir
 * durumu, olayı ya da tarayıcı API'si yok — düz biçimlendirme. Bedeli, iki
 * dilin tamamının bu bölümü içeren her sayfaya paket olarak gitmesiydi.
 * Metin artık sunucuda çözülüyor (`lib/i18n/server.ts`).
 */
export default async function AboutUs() {
  const { t } = getTranslations();

  return (
    <section id="unternehmen" className="relative overflow-hidden bg-void py-24 md:py-32 border-t border-line">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        <div className="mb-12">
          <p className="tag text-flame mb-2">{t.about.tag}</p>
          <p className="font-mono text-xs text-amber uppercase tracking-widest mb-3">{t.about.subTag}</p>
          <h2 className="section-title font-display font-extrabold text-bone">
            {t.about.title}
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-8 items-stretch">
          <div className="ember-surface border border-line p-8 md:p-10 flex flex-col justify-center">
            <h3 className="font-display font-extrabold text-2xl md:text-3xl text-bone mb-6">
              {t.about.welcome}
            </h3>
            <p className="text-smoke text-sm md:text-base leading-relaxed mb-6">
              {t.about.text1}
            </p>
            <p className="text-smoke/90 text-sm md:text-base leading-relaxed">
              {t.about.text2}
            </p>
          </div>

          <div className="relative border border-line bg-char p-8 md:p-10 flex flex-col justify-between overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none font-display text-9xl font-black text-bone">
              2019
            </div>
            <div className="space-y-6 relative z-10">
              <div className="border-b border-line pb-4">
                <span className="tag text-amber block mb-1">{t.about.sinceLabel}</span>
                <span className="font-display text-xl md:text-2xl font-bold text-bone block text-balance">
                  {t.about.sinceValue}
                </span>
              </div>
              <div className="border-b border-line pb-4">
                <span className="tag text-flame block mb-1">{t.about.tasteLabel}</span>
                <span className="font-display text-xl md:text-2xl font-bold text-bone block text-balance">
                  {t.about.tasteValue}
                </span>
              </div>
              <div>
                <span className="tag text-herb block mb-1">{t.about.qualityLabel}</span>
                <span className="font-display text-xl md:text-2xl font-bold text-bone block text-balance">
                  {t.about.qualityValue}
                </span>
              </div>
            </div>
            <div className="pt-6 border-t border-line mt-6 tag text-smoke">
              {t.about.locationLine}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
