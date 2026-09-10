"use client";

import { EdgeScreen } from "@/components/EdgeScreen";
import { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * 404.
 *
 * İstemci bileşeni, çünkü metin dil bağlamından okunuyor — ziyaretçi Türkçeye
 * geçtiyse hata sayfasında birdenbire Almanca görmemeli. Sayfanın kendisi
 * kök düzenin içinde çizildiği için `LanguageProvider` burada mevcut.
 */
export default function NotFound() {
  const { t } = useLanguage();

  return (
    <EdgeScreen
      tag={t.errors.notFoundTag}
      title={t.errors.notFoundTitle}
      text={t.errors.notFoundText}
    />
  );
}
