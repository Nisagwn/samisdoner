import { cookies } from "next/headers";
import { trTranslations } from "./locales/tr";
import { deTranslations, type Translations } from "./locales/de";
import { LANG_COOKIE, normalizeLanguage, type Language } from "./config";

/**
 * Sunucu tarafında dil çözümü.
 *
 * Sunucu bileşenleri metni buradan alır; `useLanguage()` yalnızca gerçekten
 * istemcide yaşayan bileşenler (sepet, navbar, yapılandırıcı) içindir.
 *
 * Kazanç ölçülebilir: yalnızca çeviri okumak için `"use client"` yazılmış yedi
 * bölüm vardı ve her biri iki dilin **tamamını** tarayıcıya taşıyordu. Metin
 * artık sunucuda çözülüp HTML olarak gidiyor.
 *
 * Bu dosya yalnızca sunucuda çalışır: `next/headers` bir istemci bileşeninden
 * içe aktarıldığında Next derlemeyi durdurur, dolayısıyla yanlış kullanım
 * çalışma anına kalmaz.
 */
export function getLanguage(): Language {
  return normalizeLanguage(cookies().get(LANG_COOKIE)?.value);
}

export function getTranslations(): { lang: Language; t: Translations } {
  const lang = getLanguage();
  return { lang, t: lang === "de" ? deTranslations : trTranslations };
}
