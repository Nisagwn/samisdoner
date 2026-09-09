"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Button } from "@/components/ui";
import { BUSINESS_INFO } from "@/data/businessInfo";

/**
 * Uç durum ekranı — 404 ve hata sayfalarının ortak gövdesi.
 *
 * İkisinin de tek işi aynı: nerede olduğunu söyle, çıkışı göster. Ayrı ayrı
 * yazıldığında iki sayfa iki farklı geometriye kayıyordu; burada tek tanım var
 * ve fark yalnızca metin ile ek düğme.
 *
 * Çıkış yolu bilinçli olarak **menü**dür, ana sayfa değil: buraya düşen kişi
 * çoğunlukla sipariş vermeye gelmiş biridir, onu tanıtım sayfasının en üstüne
 * bırakmak bir kaydırma daha demek. Telefon numarası da duruyor — site
 * çalışmıyorsa dükkânın kapalı olması gerekmez.
 */
export function EdgeScreen({
  tag,
  title,
  text,
  action,
}: {
  tag: string;
  title: string;
  text: string;
  /** Hata sayfasındaki "tekrar dene"; 404'te yoktur. */
  action?: { label: string; onClick: () => void };
}) {
  const { t } = useLanguage();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-void px-5 py-24 text-bone">
      <div className="w-full max-w-lg">
        <p className="tag mb-3 text-flame">{tag}</p>
        <h1 className="section-title mb-4 font-display font-extrabold text-bone">{title}</h1>
        <p className="mb-8 text-sm leading-relaxed text-smoke">{text}</p>

        <div className="flex flex-wrap gap-3">
          {action && (
            <Button variant="primary" onClick={action.onClick} className="text-xs">
              {action.label}
            </Button>
          )}
          <Link
            href="/speisekarte"
            className="focus-ring tag inline-flex min-h-[44px] items-center border border-amber bg-amber/10 px-5 text-amber transition-colors hover:bg-amber hover:text-void"
          >
            {t.errors.menuBtn}
          </Link>
          <Link
            href="/"
            className="focus-ring tag inline-flex min-h-[44px] items-center border border-line px-5 text-smoke transition-colors hover:border-amber hover:text-amber"
          >
            {t.errors.homeBtn}
          </Link>
        </div>

        <p className="mt-10 border-t border-line pt-6 text-xs leading-relaxed text-smoke/70">
          {t.errors.callHint}{" "}
          <a href={BUSINESS_INFO.phoneTel} className="focus-ring text-amber hover:underline">
            {BUSINESS_INFO.formattedPhone}
          </a>
        </p>
      </div>
    </main>
  );
}
