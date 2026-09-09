/**
 * Dil tercihinin taşındığı yer — sunucu ve istemcinin ortak sözleşmesi.
 *
 * Tercih neden çerezde: sayfaların çoğu (altbilgi, konum, hakkımızda, yorumlar)
 * artık sunucu bileşeni. Sunucu `localStorage`'ı göremez; tercih orada
 * kalsaydı bu bölümler herkese Almanca çizilir, sonra istemcide düzelirdi —
 * yani ya yanlış dil ya da bir "sıçrama". Çerez isteğin kendisiyle geldiği
 * için sunucu ilk çizimde doğru dili biliyor.
 *
 * `localStorage` tamamen bırakılmadı: bu sürümden önce tercihini oraya yazmış
 * ziyaretçiler var, `LanguageProvider` ilk açılışta onu çereze taşıyor.
 */

export type Language = "tr" | "de";

/** Çerez ve (geçiş için) localStorage anahtarı — ikisi de aynı adı kullanır. */
export const LANG_COOKIE = "the-doner-lang";

/**
 * Varsayılan Almanca: dükkân Bayern'de, müşterilerin tamamına yakını Almanca
 * okuyor. Türkçe bilinçli bir seçim olarak kalır.
 */
export const DEFAULT_LANGUAGE: Language = "de";

/** Bir yıl: dil tercihi oturumluk değil, kişinin kalıcı seçimi. */
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function normalizeLanguage(value: string | null | undefined): Language {
  return value === "tr" || value === "de" ? value : DEFAULT_LANGUAGE;
}
