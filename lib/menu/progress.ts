/**
 * Sepet eşiklerinin ilerleme hesabı — saf.
 *
 * İki eşik var ve ikisi farklı şey söyler:
 *  - **Mindestbestellwert**: altındaysan sipariş veremezsin (engel).
 *  - **Ücretsiz teslimat / ücretsiz servis**: altındaysan ücret ödersin (teşvik).
 *
 * İkisi de aynı görsel dili kullanır — bir çubuk ve "noch X €" — ama tonu
 * farklıdır. Hesap tek yerde, çünkü "kalan tutar" ile "çubuğun doluluğu"
 * arasında tutarsızlık olması (çubuk dolu, yazı "2 € kaldı" diyor) müşterinin
 * ekrandaki hiçbir sayıya güvenmemesine yol açar.
 *
 * Tutarlar cent; yüzde 0–100 arası tam sayı.
 */

export type ThresholdProgress = {
  /** Eşiğe kalan tutar (cent); eşik yoksa ya da aşıldıysa 0. */
  remainingCents: number;
  /** Çubuğun doluluğu, 0–100. Eşik yoksa 100 (gösterilecek bir şey yok). */
  percent: number;
  /** Eşik aşıldı mı. Eşik tanımlı değilse true. */
  reached: boolean;
  /** Eşik gerçekten tanımlı mı; false ise arayüz çubuğu hiç çizmez. */
  active: boolean;
};

export function thresholdProgress(
  subtotalCents: number,
  thresholdCents: number
): ThresholdProgress {
  const subtotal = Number.isFinite(subtotalCents) ? Math.max(0, Math.round(subtotalCents)) : 0;
  const threshold = Number.isFinite(thresholdCents) ? Math.round(thresholdCents) : 0;

  // Eşik yoksa ilerleme diye bir şey de yok: çubuk çizilmesin diye `active`
  // false döner, ama "ulaşıldı" sayılır ki çağıran taraf engel görmesin.
  if (threshold <= 0) {
    return { remainingCents: 0, percent: 100, reached: true, active: false };
  }

  if (subtotal >= threshold) {
    return { remainingCents: 0, percent: 100, reached: true, active: true };
  }

  return {
    remainingCents: threshold - subtotal,
    // Aşağı yuvarlanır: çubuk "neredeyse dolu" görünürken yazının hâlâ para
    // istemesi, yukarı yuvarlamanın kaçınılmaz sonucuydu.
    percent: Math.floor((subtotal / threshold) * 100),
    reached: false,
    active: true,
  };
}
