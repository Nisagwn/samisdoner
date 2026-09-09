import type { Fulfillment, OrderStatus } from "@prisma/client";

/**
 * Sipariş durum makinesi.
 *
 * Saf mantık: veritabanına dokunmaz, test edilebilir. Geçişin veritabanına
 * yazılması `lib/orders/repository.ts` içindeki `transitionOrder` işidir.
 *
 * Kural: bir siparişin durumu yalnızca burada tanımlı kenarlar üzerinden
 * değişir. "Teslim edildi" işaretlenmiş bir siparişi tekrar "hazırlanıyor"a
 * çekmek gibi geriye dönüşler kazayla olamaz.
 */

/**
 * İzin verilen geçişler.
 *
 * OUT_FOR_DELIVERY ve READY birbirinin alternatifidir: hangisinin geçerli
 * olduğunu siparişin teslim biçimi belirler (bkz. `nextStatuses`).
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  // Ödeme bekleniyor. Webhook PAID'e taşır; süresi dolarsa EXPIRED.
  PENDING_PAYMENT: ["PAID", "EXPIRED", "CANCELLED"],
  // Ödeme alındı, işletme henüz bakmadı.
  PAID: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  READY: ["PICKED_UP"],
  // Uç durumlar: buradan çıkış yok. Kapanmış sipariş panelden iptal edilemez;
  // teslim edilmiş bir siparişin parası gerekiyorsa Stripe'tan iade edilir.
  DELIVERED: [],
  PICKED_UP: [],
  CANCELLED: [],
  REJECTED: [],
  EXPIRED: [],
};

/** Siparişin akışı bitti mi. */
export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Ödeme alınmış ve iptal edilmemiş siparişler işletme için "canlı" sayılır. */
export const ACTIVE_STATUSES: readonly OrderStatus[] = [
  "PAID",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
];

/** İptal/ret durumunda paranın iade edilmesi gereken durumlar. */
export function needsRefund(from: OrderStatus): boolean {
  return from !== "PENDING_PAYMENT" && from !== "EXPIRED";
}

/**
 * Bu siparişin bulunduğu durumdan gidebileceği durumlar.
 *
 * Teslim biçimine göre daraltılır: kurye siparişi "hazır"a değil "yolda"ya,
 * gel-al siparişi "yolda"ya değil "hazır"a geçer.
 */
export function nextStatuses(
  status: OrderStatus,
  fulfillment: Fulfillment
): readonly OrderStatus[] {
  return TRANSITIONS[status].filter((next) => {
    if (next === "OUT_FOR_DELIVERY") return fulfillment === "DELIVERY";
    if (next === "READY") return fulfillment === "PICKUP";
    return true;
  });
}

export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  fulfillment: Fulfillment
): boolean {
  return nextStatuses(from, fulfillment).includes(to);
}

/** İzinsiz geçiş denendiğinde fırlatılır. */
export class InvalidTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus
  ) {
    super(`Sipariş durumu ${from} → ${to} olarak değiştirilemez.`);
    this.name = "InvalidTransitionError";
  }
}

/* ------------------------------------------------------------- gösterim */

export const STATUS_LABELS: Record<OrderStatus, { de: string; tr: string }> = {
  PENDING_PAYMENT: { de: "Warten auf Zahlung", tr: "Ödeme bekleniyor" },
  PAID: { de: "Bezahlt", tr: "Ödendi" },
  ACCEPTED: { de: "Bestellung angenommen", tr: "Sipariş alındı" },
  PREPARING: { de: "Wird zubereitet", tr: "Hazırlanıyor" },
  READY: { de: "Abholbereit", tr: "Teslime hazır" },
  OUT_FOR_DELIVERY: { de: "Unterwegs", tr: "Yolda" },
  DELIVERED: { de: "Geliefert", tr: "Teslim edildi" },
  PICKED_UP: { de: "Abgeholt", tr: "Teslim alındı" },
  CANCELLED: { de: "Storniert", tr: "İptal edildi" },
  REJECTED: { de: "Abgelehnt", tr: "Reddedildi" },
  EXPIRED: { de: "Abgelaufen", tr: "Süresi doldu" },
};

/**
 * Durumun tek başına anlatmadığı şeyi anlatan cümle.
 *
 * Şu an yalnızca `EXPIRED` için var ve gerekçesi somut: müşteri ödeme
 * sayfasında sekmeyi kapattığında sipariş 31 dakika sonra bakım göreviyle
 * süresi dolmuş sayılıyor. Ekranda tek başına "Süresi doldu" yazması iki
 * soruyu cevapsız bırakıyordu — *neden* ve *param gitti mi*. İkincisi
 * cevapsız kalınca müşteri telefona sarılıyor.
 *
 * "Tahsilat yapılmadı" güvenli bir ifade: `EXPIRED` yalnızca hiç ödeme
 * alınmamış siparişe uygulanır. Ödemesi alınmış ama bildirimi gecikmiş sipariş
 * bakım görevinde bilinçli olarak atlanır (bkz. lib/orders/reconcile.ts) ve
 * `PENDING_PAYMENT`'ta bekletilir.
 *
 * Aynı metin hem takip sayfasında hem hesap listesinde kullanılır: iki yerde
 * iki farklı açıklama, müşterinin hangisine inanacağını bilememesi demek.
 */
export const STATUS_HINTS: Partial<Record<OrderStatus, { de: string; tr: string }>> = {
  EXPIRED: {
    de:
      "Die Zahlung wurde nicht abgeschlossen, deshalb ist diese Bestellung abgelaufen. " +
      "Es wurde nichts abgebucht — Sie können jederzeit neu bestellen.",
    tr:
      "Ödeme tamamlanmadığı için bu siparişin süresi doldu. " +
      "Hesabınızdan hiçbir tahsilat yapılmadı — dilediğiniz zaman yeniden sipariş verebilirsiniz.",
  },
};

/**
 * Panelde gösterilen durum adları.
 *
 * Müşteri "Hazırlanıyor" görür; onun için doğru olan budur, yemeği o sırada
 * gerçekten hazırlanıyordur. Mutfak ise o düğmeye hazırlığı **bitirdiğinde**
 * basar — panelde "Hazırlandı" yazması işletmenin kendi diline uyar ve
 * "bu siparişte ne yaptım?" sorusunu doğru cevaplar.
 *
 * Ayrı bir tablo tutulmasının sebebi de bu: paneldeki kelime değiştiğinde
 * müşterinin gördüğü cümle değişmemeli.
 */
export const ADMIN_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Ödeme bekleniyor",
  PAID: "Ödendi",
  ACCEPTED: "Sipariş alındı",
  PREPARING: "Hazırlandı",
  READY: "Teslime hazır",
  OUT_FOR_DELIVERY: "Yolda",
  DELIVERED: "Teslim edildi",
  PICKED_UP: "Teslim alındı",
  CANCELLED: "İptal edildi",
  REJECTED: "Reddedildi",
  EXPIRED: "Süresi doldu",
};

/**
 * Müşteri takip ekranındaki adım çubuğu.
 *
 * İptal/ret gibi durumlar bu çizgide yer almaz; onlar ayrı bir uyarı olarak
 * gösterilir, ilerleme çubuğu olarak değil.
 */
export function progressSteps(fulfillment: Fulfillment): OrderStatus[] {
  return fulfillment === "DELIVERY"
    ? ["PAID", "ACCEPTED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"]
    : ["PAID", "ACCEPTED", "PREPARING", "READY", "PICKED_UP"];
}

/** Adım çubuğunda kaçıncı adımdayız; durum çizgide değilse -1. */
export function progressIndex(status: OrderStatus, fulfillment: Fulfillment): number {
  return progressSteps(fulfillment).indexOf(status);
}
