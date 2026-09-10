import { getTranslations } from "@/lib/i18n/server";
import { BUSINESS_INFO } from "@/data/businessInfo";

/*
 * Sunucu bileşeni.
 *
 * Bu bölüm yalnızca çeviri okumak için `"use client"` yazılmıştı: hiçbir
 * durumu, olayı ya da tarayıcı API'si yok — düz biçimlendirme. Bedeli, iki
 * dilin tamamının bu bölümü içeren her sayfaya paket olarak gitmesiydi.
 * Metin artık sunucuda çözülüyor (`lib/i18n/server.ts`).
 */
export default async function SocialMedia() {
  const { t } = getTranslations();

  return (
    <section className="relative overflow-hidden bg-char py-20 border-t border-line">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        <div className="ember-surface border border-line p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-8">
          <div>
            <p className="tag text-amber mb-2">{t.social.tag}</p>
            <h2 className="font-display font-extrabold text-2xl md:text-3xl text-bone mb-4">
              {t.social.title}
            </h2>
            <p className="text-smoke text-sm md:text-base max-w-2xl leading-relaxed">
              {t.social.description}
            </p>
          </div>

          <a
            href={BUSINESS_INFO.phoneTel}
            className="focus-ring shrink-0 bg-flame-gradient text-void font-display font-extrabold px-8 py-4 text-sm hover:brightness-110 transition-[filter,transform] active:translate-y-px"
          >
            {t.social.followBtn}
          </a>
        </div>
      </div>
    </section>
  );
}
