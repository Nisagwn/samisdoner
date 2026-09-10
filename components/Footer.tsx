import Link from "next/link";
import { getTranslations } from "@/lib/i18n/server";
import { BUSINESS_INFO } from "@/data/businessInfo";

/** Yalnızca gerçekten tanımlanmış hesaplar listelenir (bkz. businessInfo). */
const SOCIAL = [
  { label: "Instagram", href: BUSINESS_INFO.social.instagram },
  { label: "Facebook", href: BUSINESS_INFO.social.facebook },
  { label: "YouTube", href: BUSINESS_INFO.social.youtube },
].filter((item) => item.href.length > 0);

/*
 * Sunucu bileşeni.
 *
 * Bu bölüm yalnızca çeviri okumak için `"use client"` yazılmıştı: hiçbir
 * durumu, olayı ya da tarayıcı API'si yok — düz biçimlendirme. Bedeli, iki
 * dilin tamamının bu bölümü içeren her sayfaya paket olarak gitmesiydi.
 * Metin artık sunucuda çözülüyor (`lib/i18n/server.ts`).
 */
export default async function Footer() {
  const { t } = getTranslations();

  return (
    <footer className="relative overflow-hidden bg-void border-t border-line pt-20 pb-10">
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,#FF3D12,#FFC247,#62D5FF,transparent)]" />
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        <div className="grid md:grid-cols-[1.4fr_1fr_1fr_1fr] gap-10 mb-16">
          <div>
            <p className="font-display font-extrabold text-2xl text-bone mb-4">
              SAMİ´S <span className="text-amber">//</span> DÖNER
            </p>
            <p className="text-smoke text-sm max-w-xs leading-relaxed mb-4">
              {t.footer.description}
            </p>
            <p className="font-mono text-xs text-amber uppercase tracking-wider">
              {t.footer.franchiseInfo}
            </p>
          </div>

          <div>
            <p className="tag text-smoke mb-4">{t.footer.navigationTitle}</p>
            <ul className="space-y-2 text-sm text-bone">
              <li><Link href="/" className="hover:text-amber transition-colors">{t.footer.links.home}</Link></li>
              <li><Link href="/ueber-uns" className="hover:text-amber transition-colors">{t.footer.links.company}</Link></li>
              <li><Link href="/#filialen" className="hover:text-amber transition-colors">{t.footer.links.branches}</Link></li>
              {/* Ürünler ana sayfadan kendi sayfasına taşındı. */}
              <li><Link href="/speisekarte" className="hover:text-amber transition-colors">{t.footer.links.products}</Link></li>
              <li><Link href="/ueber-uns#franchise" className="hover:text-amber transition-colors">{t.footer.links.franchise}</Link></li>
              <li><Link href="/ueber-uns#blog" className="hover:text-amber transition-colors">{t.footer.links.blog}</Link></li>
            </ul>
          </div>

          <div>
            <p className="tag text-smoke mb-4">{t.footer.legalTitle}</p>
            <ul className="space-y-2 text-sm text-bone">
              {/* DDG § 5: Impressum her sayfadan iki tıkla ulaşılabilir olmak
                  zorunda. Bu bağlantılar daha önce "/" gösteriyordu — yani
                  Impressum fiilen yoktu. */}
              <li><Link href="/impressum" className="hover:text-amber transition-colors">{t.footer.impressum}</Link></li>
              <li><Link href="/datenschutz" className="hover:text-amber transition-colors">{t.footer.privacy}</Link></li>
              <li><Link href="/agb" className="hover:text-amber transition-colors">{t.footer.terms}</Link></li>
              <li><Link href="/widerruf" className="hover:text-amber transition-colors">{t.footer.withdrawal}</Link></li>
              <li><Link href="/allergene" className="hover:text-amber transition-colors">{t.footer.allergens}</Link></li>
            </ul>
          </div>

          <div>
            <p className="tag text-smoke mb-4">{t.footer.contactTitle}</p>
            <ul className="space-y-2 text-sm text-bone">
              <li>
                <a href={BUSINESS_INFO.phoneTel} className="focus-ring hover:text-amber transition-colors">
                  {BUSINESS_INFO.formattedPhone}
                </a>
              </li>
              <li>
                <a
                  href={BUSINESS_INFO.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-ring hover:text-amber transition-colors"
                >
                  {BUSINESS_INFO.address.fullAddress}
                </a>
              </li>
              {SOCIAL.map((item) => (
                <li key={item.label}>
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="focus-ring hover:text-amber transition-colors"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-8 border-t border-line tag text-smoke">
          <span>{t.footer.rightsReserved}</span>
          <div className="flex gap-6">
            <a href="#top" className="focus-ring hover:text-amber transition-colors">
              {t.footer.backToTop}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
