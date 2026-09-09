"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trTranslations } from "./locales/tr";
import { deTranslations, type Translations } from "./locales/de";
import {
  DEFAULT_LANGUAGE,
  LANG_COOKIE,
  LANG_COOKIE_MAX_AGE,
  normalizeLanguage,
  type Language,
} from "./config";

export type { Language };

type LanguageContextType = {
  lang: Language;
  setLang: (lang: Language) => void;
  t: Translations;
};

const LanguageContext = createContext<LanguageContextType | null>(null);

function writeCookie(lang: Language) {
  // `SameSite=Lax`: çerez yalnızca dil tercihi taşıyor, üçüncü taraf isteğinde
  // gitmesine gerek yok. `Secure` yerelde HTTP'de çalışmayı engellemesin diye
  // yalnızca HTTPS'te ekleniyor.
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

function readCookie(): Language | null {
  const hit = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${LANG_COOKIE}=`));
  return hit ? normalizeLanguage(hit.slice(LANG_COOKIE.length + 1)) : null;
}

/**
 * Dil sağlayıcı.
 *
 * `initialLang` sunucudan gelir (`lib/i18n/server.ts` → kök düzen). Bu, tek bir
 * hatayı kökten kapatır: sağlayıcı önceden her zaman Almanca ile açılıp
 * hidrasyondan sonra tercihi okuyordu, yani Türkçe seçmiş bir ziyaretçi her
 * sayfada önce Almanca metni görüyordu. Artık sunucu ve istemci ilk çizimde
 * aynı dili kullanıyor.
 *
 * Dil değişince `router.refresh()` çağrılır: metnin çoğu artık sunucu
 * bileşenlerinde (altbilgi, konum, hakkımızda, yorumlar). Bağlam durumunu
 * değiştirmek onları etkilemez — sunucudan yeniden çizilmeleri gerekir.
 * Tazeleme istemci durumunu (sepet, form alanları) korur.
 */
export function LanguageProvider({
  initialLang = DEFAULT_LANGUAGE,
  children,
}: {
  initialLang?: Language;
  children: React.ReactNode;
}) {
  const [lang, setLangState] = useState<Language>(initialLang);
  const router = useRouter();

  /*
   * Eski sürümlerden geçiş.
   *
   * Tercih bu sürümden önce `localStorage`'daydı. Çerez yoksa ama orada bir
   * değer varsa, onu bir kereliğine çereze taşıyıp sayfayı tazeliyoruz;
   * böylece geri dönen ziyaretçi seçimini kaybetmiyor. Taşıma bittikten sonra
   * bu dal bir daha çalışmaz.
   */
  useEffect(() => {
    if (readCookie()) return;

    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LANG_COOKIE);
    } catch {
      // depolama kapalı (gizli sekme) — taşınacak bir şey yok
    }

    const migrated = normalizeLanguage(saved);
    writeCookie(migrated);
    if (migrated !== lang) {
      setLangState(migrated);
      router.refresh();
    }
  }, [lang, router]);

  const setLang = useCallback(
    (next: Language) => {
      setLangState(next);
      writeCookie(next);
      try {
        localStorage.setItem(LANG_COOKIE, next);
      } catch {
        // depolama kapalı: çerez zaten yazıldı, tercih yine kalıcı
      }
      router.refresh();
    },
    [router]
  );

  // `<html lang>` ekran okuyucunun telaffuzunu belirler. Sunucu da doğru
  // değeri yazıyor; burası yalnızca tazeleme beklemeden güncellemek için.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = lang === "de" ? deTranslations : trTranslations;

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}
