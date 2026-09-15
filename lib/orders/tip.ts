/**
 * Trinkgeld (bahşiş).
 *
 * İKİ KURAL BURADA TOPLANIR
 *
 * 1. **Bahşiş KDV matrahına girmez.** Abschn. 10.1 Abs. 5 UStAE: servis
 *    personeline gönüllü verilen bahşiş, işletmenin edimi için ödenen bedelin
 *    (Entgelt) parçası değildir — para misafirden çalışana geçer, işletmenin
 *    hasılatına hiç uğramaz. Aynı paranın işletme sahibine verilmesi hâlinde
 *    durum tersine döner ve KDV'ye girer; bu yüzden arayüzdeki metin bilinçli
 *    olarak "ekibimiz / kuryemiz için" der, "bize" demez. Toplam formülü de
 *    bunu yansıtır: bahşiş toplama eklenir ama `vatBreakdown`'a girmez
 *    (bkz. lib/orders/totals.ts).
 *
 * 2. **Bahşiş sunucuda sınırlanır.** İstemciden gelen değer doğrudan tahsil
 *    edilecek bir tutardır; virgülü kaçmış bir girdi (5 yerine 500) müşterinin
 *    kartından çekilir ve iade süreci gerektirir. Alt/üst sınır burada, tek
 *    yerde uygulanır.
 *
 * Saf mantık: veritabanına dokunmaz, testte doğrudan çalıştırılır.
 */

/**
 * Arayüzde hazır düğme olarak sunulan yüzdeler.
 *
 * Referans siteler (Lieferando, Wolt, Uber Eats) hazır yüzde + serbest tutar
 * ikilisini kullanıyor: hazır düğmeler kararı kolaylaştırır, serbest alan
 * "tam 2 €" demek isteyeni engellemez.
 */
export const TIP_PRESET_PERCENTS = [0, 5, 10, 15] as const;

/** Serbest tutarın mutlak üst sınırı (50 €). */
export const MAX_TIP_CENTS = 5_000;

/**
 * Küçük siparişte de anlamlı bir bahşiş bırakılabilsin diye taban.
 *
 * Üst sınır sepetin kendisine bağlanmasaydı 8 €'luk bir dönere 50 € bahşiş
 * yazılabilirdi; yalnız sepete bağlansaydı 8 €'luk siparişte 5 € bahşiş
 * mümkün olmazdı. İkisinin ortası: sepet kadar, ama en az 5 €.
 */
const MIN_TIP_CEILING_CENTS = 500;

/** Bu sepette bırakılabilecek en yüksek bahşiş. */
export function maxTipFor(subtotalCents: number): number {
  const base = Math.max(0, Math.round(subtotalCents));
  return Math.min(MAX_TIP_CENTS, Math.max(base, MIN_TIP_CEILING_CENTS));
}

/**
 * Yüzdeye karşılık gelen bahşiş.
 *
 * Taban **ara toplamdır**, genel toplam değil: kurye ücretinin ve servis
 * bedelinin üstünden bahşiş hesaplamak, müşterinin bırakmak istediğinden
 * fazlasını yazar.
 */
export function tipForPercent(subtotalCents: number, percent: number): number {
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return 0;
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return clampTip(Math.round((subtotalCents * percent) / 100), subtotalCents);
}

/**
 * İstemciden gelen bahşiş tutarını kabul edilebilir aralığa çeker.
 *
 * Geçersiz girdi (NaN, negatif, ondalık) sessizce 0'a düşer: bahşiş isteğe
 * bağlı bir jesttir, yüzünden sipariş reddedilmez.
 */
export function clampTip(raw: unknown, subtotalCents: number): number {
  const value = typeof raw === "number" ? Math.round(raw) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, maxTipFor(subtotalCents));
}

/**
 * Serbest alana yazılan Euro metnini cent'e çevirir ("2,50" → 250).
 *
 * Almanca klavyede ondalık ayıracı virgüldür; noktayı da kabul ederiz çünkü
 * telefon klavyesinde çoğu zaman nokta çıkar. Rakam dışındaki her şey atılır.
 */
export function parseTipInput(raw: string, subtotalCents: number): number {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === "" || cleaned === ".") return 0;
  return clampTip(Math.round(Number(cleaned) * 100), subtotalCents);
}
