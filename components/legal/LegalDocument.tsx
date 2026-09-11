"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { LegalBlock, LegalDocumentData } from "@/lib/legal/content";

/**
 * Yasal belge görüntüleyicisi.
 *
 * İçerik sunucuda üretilir (ortam değişkenlerini okur), burada yalnızca seçilen
 * dile göre gösterilir. Bileşen metin bilmez: hangi belgeyi gösterdiğinden
 * bağımsızdır, dolayısıyla yeni bir yasal sayfa eklemek bir veri dosyası
 * yazmaktan ibarettir.
 *
 * Eksik alan uyarısı bilinçli olarak **müşteriye de görünür**. Yalnızca
 * geliştirici konsoluna yazsaydı, canlıda eksik kalan bir Impressum alanı
 * kimsenin dikkatini çekmezdi — ki bu tam olarak uyarının önlemek istediği şey.
 */
export default function LegalDocument({ data }: { data: LegalDocumentData }) {
  const { lang } = useLanguage();
  const pick = <T,>(value: { de: T; tr: T }) => (lang === "tr" ? value.tr : value.de);

  return (
    <article className="mx-auto w-full max-w-2xl px-5 pb-24 pt-[calc(var(--nav-h)+3rem)]">
      <header className="mb-10 border-b border-line pb-6">
        <h1 className="font-display text-3xl font-extrabold text-bone">{pick(data.title)}</h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-widest2 text-smoke">
          {lang === "tr" ? "Son güncelleme" : "Stand"}: {data.updated}
        </p>
        {lang === "tr" && (
          <p className="mt-3 text-xs leading-relaxed text-smoke">
            Bağlayıcı olan Almanca metindir. Türkçe çeviri yalnızca anlaşılırlık
            amacıyla sunulmuştur.
          </p>
        )}
      </header>

      {data.missing.length > 0 && (
        <div
          role="alert"
          className="mb-10 border border-flame bg-flame/10 px-4 py-4 text-sm text-flame"
        >
          <p className="font-display font-bold">
            {lang === "tr"
              ? "Bu belge eksik yayınlanmış durumda."
              : "Dieses Dokument ist unvollständig veröffentlicht."}
          </p>
          <p className="mt-2 leading-relaxed">
            {lang === "tr"
              ? "Aşağıdaki zorunlu alanlar henüz doldurulmadı. Site canlıya alınmadan önce bu değerlerin ortam değişkeni olarak girilmesi gerekir:"
              : "Die folgenden Pflichtangaben fehlen noch. Sie müssen vor dem Livegang als Umgebungsvariablen gesetzt werden:"}
          </p>
          <ul className="mt-2 space-y-1 font-mono text-xs">
            {data.missing.map((f) => (
              <li key={f.key}>· {f.key}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-10">
        {data.sections.map((section) => (
          <section key={section.heading.de}>
            <h2 className="mb-4 font-display text-lg font-bold text-amber">
              {pick(section.heading)}
            </h2>
            <div className="space-y-4">
              {section.blocks.map((block, i) => (
                <Block key={i} block={block} lang={lang} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer className="mt-14 border-t border-line pt-6 text-sm">
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-smoke">
          <Link href="/impressum" className="hover:text-amber transition-colors">
            Impressum
          </Link>
          <Link href="/datenschutz" className="hover:text-amber transition-colors">
            {lang === "tr" ? "Gizlilik" : "Datenschutz"}
          </Link>
          <Link href="/agb" className="hover:text-amber transition-colors">
            AGB
          </Link>
          <Link href="/widerruf" className="hover:text-amber transition-colors">
            {lang === "tr" ? "Cayma hakkı" : "Widerruf"}
          </Link>
        </nav>
      </footer>
    </article>
  );
}

function Block({ block, lang }: { block: LegalBlock; lang: "tr" | "de" }) {
  const text = (value: { de: string; tr: string }) => (lang === "tr" ? value.tr : value.de);

  switch (block.kind) {
    case "p":
      return <p className="text-sm leading-relaxed text-smoke">{text(block)}</p>;

    case "ul":
      return (
        <ul className="space-y-2">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed text-smoke">
              <span className="text-amber" aria-hidden>
                ·
              </span>
              <span>{text(item)}</span>
            </li>
          ))}
        </ul>
      );

    case "kv":
      return (
        <dl className="space-y-2">
          {block.rows.map((row) => (
            <div key={row.label} className="flex flex-wrap gap-x-3 text-sm">
              <dt className="min-w-[10rem] text-smoke">{row.label}:</dt>
              <dd className={row.field.missing ? "font-mono text-xs text-flame" : "text-bone"}>
                {row.field.missing
                  ? `${lang === "tr" ? "EKSİK" : "FEHLT"} — ${row.field.key}`
                  : row.field.value}
              </dd>
            </div>
          ))}
        </dl>
      );

    case "note":
      return (
        <p className="border-l-2 border-amber bg-char px-4 py-3 text-sm leading-relaxed text-bone">
          {text(block)}
        </p>
      );
  }
}
