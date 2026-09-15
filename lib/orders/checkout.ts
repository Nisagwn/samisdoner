import {
  priceCart,
  type CartLineInput,
  type PricedLine,
  type VatBucket,
} from "@/lib/admin/store";
import { checkOrderability, deliveryFeeFor, type RejectionReason } from "./availability";
import { evaluateCoupon, findCouponRule, type CouponRejection } from "./coupon";
import { clampTip } from "./tip";
import { composeTotals } from "./totals";

/**
 * Ödeme adımının **tek** hesabı.
 *
 * Bu dosyadan önce iki yerde para toplanıyordu: sunucuda sipariş oluşturulurken
 * (`createOrderAction`) ve istemcide sepet çekmecesinde (`quote.totalCents +
 * delivery.feeCents`). İki ayrı toplam demek, ekranda yazan tutarla tahsil
 * edilen tutarın sessizce ayrışabilmesi demektir.
 *
 * Artık her ikisi de buradan geçiyor: sepet çekmecesi `/api/menu/quote`
 * üzerinden, sipariş oluşturma doğrudan. İstemcide tek bir toplama işlemi
 * kalmadı.
 *
 * İkinci kural: **ret, hesabı durdurmaz.** Dükkân kapalıyken ya da sepet
 * minimumun altındayken de tutarlar hesaplanır ve döner; müşteri neyi neden
 * sipariş edemediğini tutarlarla birlikte görür. Ret sebebi ayrı bir alanda
 * (`rejection`) taşınır, çağıran taraf ona bakar.
 */

export type CheckoutZone = {
  zip: string;
  city: string;
  minOrderCents: number;
  feeCents: number;
  freeOverCents: number;
  etaMinutes: number;
};

export type CheckoutQuote = {
  lines: PricedLine[];
  subtotalCents: number;
  serviceFeeCents: number;
  /** Kurye ücreti. Gel-alda ve bölge seçilmemişken 0. */
  deliveryFeeCents: number;
  /** Uygulanan kupon indirimi (pozitif cent); kupon yoksa 0. */
  discountCents: number;
  /** Kabul edilen kuponun kodu; kupon yoksa ya da reddedildiyse boş. */
  couponCode: string;
  /** Kod girildi ama kabul edilmediyse sebebi; aksi hâlde null. */
  couponRejection: CouponRejection | null;
  /** Bahşiş (pozitif cent). Toplama eklenir, KDV matrahına girmez. */
  tipCents: number;
  /** Ara toplam + ücretler − indirim + bahşiş. Müşteriye gösterilecek tutar. */
  totalCents: number;
  /** Ücretsiz servise kalan tutar; eşik yoksa veya aşıldıysa 0. */
  remainingForFreeServiceCents: number;
  freeServiceOverCents: number;
  /** Minimum sepete kalan tutar; eşik yoksa, aşıldıysa veya bölge seçilmediyse 0. */
  remainingForMinimumCents: number;
  vatBreakdown: VatBucket[];
  currency: "EUR";

  fulfillment: "DELIVERY" | "PICKUP";
  /** Seçilen posta kodunun bölgesi; gel-alda ve bölge dışında null. */
  zone: CheckoutZone | null;
  /** Tahmini süre (dk): teslimatta bölgenin, gel-alda hazırlık süresi. */
  etaMinutes: number | null;
  /** Sipariş şu an verilebilir mi; verilemiyorsa sebebi. */
  rejection: RejectionReason | null;
  /** Sipariş sırasında menüden kalkmış satır var mı. */
  hasUnavailable: boolean;
};

export async function buildCheckoutQuote(input: {
  lines: CartLineInput[];
  lang: "tr" | "de";
  fulfillment: "DELIVERY" | "PICKUP";
  /** Teslimat posta kodu. Gel-alda ve müşteri henüz seçmediyse boş. */
  zip?: string;
  /** Müşterinin girdiği kupon kodu; boşsa kupon hiç sorgulanmaz. */
  couponCode?: string;
  /** Müşterinin bıraktığı bahşiş (cent); sunucuda kelepçelenir. */
  tipCents?: number;
  /** İleri saatli siparişte istenen teslim saati; "en kısa sürede"de boş. */
  requestedAt?: Date | null;
}): Promise<CheckoutQuote> {
  const quote = await priceCart(input.lines, input.lang);

  const orderability = await checkOrderability({
    fulfillment: input.fulfillment,
    zip: input.zip,
    subtotalCents: quote.subtotalCents,
    requestedAt: input.requestedAt ?? null,
  });

  const zone = orderability.zone;
  const deliveryFeeCents = zone ? deliveryFeeFor(zone, quote.subtotalCents) : 0;

  /*
   * Kupon.
   *
   * Reddedilen kupon **akışı durdurmaz**: indirim 0 kalır, sebep ayrı bir
   * alanda taşınır ve müşteri kod alanının altında görür. Geçersiz bir kod
   * yüzünden "sipariş verilemez" demek, kodu silmeyi bilmeyen müşteriyi
   * sepette kilitler.
   */
  const code = (input.couponCode ?? "").trim();
  const coupon = code
    ? evaluateCoupon(await findCouponRule(code), {
        subtotalCents: quote.subtotalCents,
        fulfillment: input.fulfillment,
      })
    : null;

  /*
   * Toplam ve KDV dökümü, siparişe yazılanla **aynı fonksiyondan** üretilir
   * (`composeTotals`). `createOrder` da birebir aynısını çağırır; dolayısıyla
   * ekranda gösterilen döküm ile faturaya yazılan döküm ayrışamaz.
   */
  const totals = composeTotals({
    lines: quote.lines,
    subtotalCents: quote.subtotalCents,
    serviceFeeCents: quote.serviceFeeCents,
    deliveryFeeCents,
    discountCents: coupon?.ok ? coupon.discountCents : 0,
    tipCents: clampTip(input.tipCents, quote.subtotalCents),
  });

  return {
    lines: quote.lines,
    subtotalCents: totals.subtotalCents,
    serviceFeeCents: totals.serviceFeeCents,
    deliveryFeeCents: totals.deliveryFeeCents,
    discountCents: totals.discountCents,
    couponCode: coupon?.ok ? coupon.code : "",
    couponRejection: coupon && !coupon.ok ? coupon.reason : null,
    tipCents: totals.tipCents,
    totalCents: totals.totalCents,
    remainingForFreeServiceCents: quote.remainingForFreeServiceCents,
    freeServiceOverCents: quote.freeServiceOverCents,
    remainingForMinimumCents:
      zone && quote.subtotalCents > 0 && quote.subtotalCents < zone.minOrderCents
        ? zone.minOrderCents - quote.subtotalCents
        : 0,
    vatBreakdown: totals.vatBreakdown,
    currency: "EUR",

    fulfillment: input.fulfillment,
    zone: zone
      ? {
          zip: zone.postalCode,
          city: zone.city,
          minOrderCents: zone.minOrderCents,
          feeCents: deliveryFeeCents,
          freeOverCents: zone.freeOverCents,
          etaMinutes: zone.etaMinutes,
        }
      : null,
    etaMinutes: orderability.ok ? orderability.etaMinutes : (zone?.etaMinutes ?? null),
    rejection: orderability.ok ? null : orderability.reason,
    hasUnavailable: quote.lines.some((line) => line.unavailable),
  };
}
