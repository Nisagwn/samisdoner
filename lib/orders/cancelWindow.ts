import type { OrderStatus } from "@prisma/client";

/**
 * Müşterinin kendi siparişini iptal edebildiği pencere.
 *
 * NEDEN BİR PENCERE VAR
 *
 * Referans (Lieferando): sipariş **restoran onaylayana kadar** iptal
 * edilebiliyor, sonrasında müşteri dükkânı aramak zorunda. Mantığı basit —
 * mutfak dönerini kesmeye başladıysa iptal artık bedava değil, atılacak yemek
 * var. Aynı çizgiyi buraya taşıyoruz ve bir de üst süre koyuyoruz: panele
 * kimsenin bakmadığı bir akşamda sipariş saatlerce "onaylanmamış" kalabilir,
 * ama mutfak onu çoktan hazırlamış olabilir.
 *
 * VORBESTELLUNG AYRI
 *
 * Akşam 20:00'ye verilmiş bir ön sipariş, saat 15:00'te iptal edilebilmeli:
 * ortada henüz hazırlanan bir şey yok. Bu yüzden ileri saatli siparişte
 * pencere, **hazırlığın başlayacağı ana** (teslim saati eksi hazırlık payı)
 * kadar açık kalır.
 *
 * ÖDENMEMİŞ SİPARİŞ
 *
 * PENDING_PAYMENT'ta tahsilat yoktur, dolayısıyla iptal edilecek bir para da
 * yok. İptal serbesttir ve iade akışı hiç çalışmaz.
 *
 * Saf mantık: veritabanına dokunmaz, testte doğrudan çalıştırılır.
 */

/** Onaylanmamış sipariş için üst süre — ödeme anından itibaren. */
export const CUSTOMER_CANCEL_MINUTES = 10;

/** Ön siparişte hazırlığın başladığı varsayılan an bilinmiyorsa kullanılacak pay (dk). */
const DEFAULT_PREP_MINUTES = 30;

export type CancelWindowOrder = {
  status: OrderStatus;
  /** Siparişin mutfağa düştüğü an; ödenmemiş siparişte null. */
  paidAt: Date | null;
  /** Ön siparişte istenen teslim saati; "en kısa sürede"de null. */
  requestedAt: Date | null;
  /** Siparişe dondurulmuş tahmini süre (dk). */
  etaMinutes: number | null;
  /** Ödenmemiş siparişin ödeme penceresinin sonu. */
  expiresAt: Date | null;
};

export type CancelWindow =
  | { ok: true; until: Date | null }
  | { ok: false; reason: "already_accepted" | "window_closed" | "terminal" };

/**
 * Siparişin iptal penceresi.
 *
 * `until` null dönebilir: ödenmemiş siparişte pencerenin sonu ödeme
 * penceresinin sonudur ve o da tanımlı olmayabilir — o durumda gösterilecek
 * bir saat yoktur, iptal yine de mümkündür.
 */
export function customerCancelWindow(
  order: CancelWindowOrder,
  now: Date = new Date()
): CancelWindow {
  switch (order.status) {
    /*
     * Henüz ödenmemiş: iade edilecek para yok, pencere ödeme penceresiyle
     * aynı. Zaten süresi dolmuşsa iptal edecek bir şey de kalmamıştır.
     */
    case "PENDING_PAYMENT": {
      if (order.expiresAt && order.expiresAt <= now) {
        return { ok: false, reason: "window_closed" };
      }
      return { ok: true, until: order.expiresAt };
    }

    // Ödeme alındı, işletme henüz bakmadı — iptalin serbest olduğu tek durum.
    case "PAID": {
      const until = deadlineFor(order);
      if (until && until <= now) return { ok: false, reason: "window_closed" };
      return { ok: true, until };
    }

    /*
     * Mutfak siparişi üstlendi. Buradan sonrası telefon işi: yemek
     * hazırlanıyor olabilir ve iptal kararını işletme vermeli.
     */
    case "ACCEPTED":
    case "PREPARING":
    case "READY":
    case "OUT_FOR_DELIVERY":
      return { ok: false, reason: "already_accepted" };

    // Akışı bitmiş sipariş: iptal edilecek bir şey yok.
    default:
      return { ok: false, reason: "terminal" };
  }
}

/**
 * Ödenmiş ama onaylanmamış siparişin son iptal anı.
 *
 * Ön siparişte hazırlığın başlayacağı an, hemen teslimatta ödeme anından
 * itibaren sabit pencere. İkisinin **büyüğü** alınır: 10 dakika sonrasına
 * verilmiş bir "ön sipariş", sabit pencereyi sıfıra indirmemeli.
 */
function deadlineFor(order: CancelWindowOrder): Date | null {
  if (!order.paidAt) return null;

  const fixed = new Date(order.paidAt.getTime() + CUSTOMER_CANCEL_MINUTES * 60_000);
  if (!order.requestedAt) return fixed;

  const prep = order.etaMinutes && order.etaMinutes > 0 ? order.etaMinutes : DEFAULT_PREP_MINUTES;
  const beforePrep = new Date(order.requestedAt.getTime() - prep * 60_000);

  return beforePrep > fixed ? beforePrep : fixed;
}
