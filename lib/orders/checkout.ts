import {
  priceCart,
  type CartLineInput,
  type PricedLine,
  type VatBucket,
} from "@/lib/admin/store";
import { checkOrderability, deliveryFeeFor, type RejectionReason } from "./availability";
import { applyCampaigns, campaignTitle } from "./campaign";
import { normalizeCouponCode, type CouponRejection } from "./coupon";
import { findCouponRule, listAutomaticRules } from "./coupons";
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

/** Teklife binen bir kampanya. */
export type QuoteCampaign = {
  /** Kampanya kaydının kimliği; kullanım kaydı buna yazılır. */
  id: string;
  /** Kodla gelen kampanyada kod; otomatikte boş. */
  code: string;
  /** Müşterinin dilindeki ad; ikisi de boşsa boş (ekran "İndirim" yazar). */
  title: string;
  /** Siparişe dondurulacak iki dil. */
  titleDe: string;
  titleTr: string;
  amountCents: number;
};

export type CheckoutQuote = {
  lines: PricedLine[];
  subtotalCents: number;
  serviceFeeCents: number;
  /** Kurye ücreti. Gel-alda ve bölge seçilmemişken 0. */
  deliveryFeeCents: number;
  /** Bütün kampanya indirimlerinin toplamı (pozitif cent); yoksa 0. */
  discountCents: number;
  /** İndirim yapan kampanyalar, ayrı ayrı. Toplamları `discountCents`. */
  campaigns: QuoteCampaign[];
  /** Sepet indirimi (yüzde / sabit) payı; bütün satırlara oransal dağıtılır. */
  cartDiscountCents: number;
  /** Satır başına ürün indirimi, `lines` ile aynı sırada. Siparişe aynen geçer. */
  lineDiscountCents: number[];
  /** Kabul edilen kodun kendisi; kod yoksa ya da reddedildiyse boş. */
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
   * Kampanyalar.
   *
   * Otomatik olanlar (ayın ürünü, menü fiyatı) her teklifte, kodlu olan
   * yalnızca müşteri kod girdiyse okunur; ikisinin birleşimi saf
   * `applyCampaigns` içinde.
   *
   * Reddedilen kod **akışı durdurmaz**: kodun indirimi 0 kalır, sebep ayrı bir
   * alanda taşınır ve müşteri kod alanının altında görür. Geçersiz bir kod
   * yüzünden "sipariş verilemez" demek, kodu silmeyi bilmeyen müşteriyi
   * sepette kilitler. Otomatik kampanyalar bundan etkilenmez.
   */
  const code = normalizeCouponCode(input.couponCode ?? "");
  const [automatic, coded] = await Promise.all([
    listAutomaticRules(),
    code ? findCouponRule(code) : Promise.resolve(null),
  ]);
  const campaigns = applyCampaigns({
    automatic,
    coded,
    enteredCode: code,
    lines: quote.lines.map((line) => ({
      productId: line.input.productId,
      variantSize: line.input.variantSize,
      unitBaseCents: line.baseUnitCents ?? line.unitCents,
      qty: line.qty,
      unavailable: line.unavailable,
    })),
    subtotalCents: quote.subtotalCents,
    fulfillment: input.fulfillment,
  });

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
    discountCents: campaigns.cartDiscountCents,
    lineDiscountCents: campaigns.lineDiscountCents,
    tipCents: clampTip(input.tipCents, quote.subtotalCents),
  });

  return {
    lines: quote.lines,
    subtotalCents: totals.subtotalCents,
    serviceFeeCents: totals.serviceFeeCents,
    deliveryFeeCents: totals.deliveryFeeCents,
    discountCents: totals.discountCents,
    campaigns: campaigns.applied.map(({ rule, amountCents }) => ({
      id: rule.id ?? "",
      code: rule.code,
      title: campaignTitle(rule, input.lang),
      titleDe: campaignTitle(rule, "de"),
      titleTr: campaignTitle(rule, "tr"),
      amountCents,
    })),
    cartDiscountCents: campaigns.cartDiscountCents,
    lineDiscountCents: campaigns.lineDiscountCents,
    couponCode: campaigns.code,
    couponRejection: campaigns.codeRejection,
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
