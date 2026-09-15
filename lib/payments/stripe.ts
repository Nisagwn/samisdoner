import Stripe from "stripe";
import {
  WebhookSignatureError,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentEvent,
  type PaymentProvider,
  type PaymentSnapshot,
  type RefundResult,
} from "./provider";

/**
 * Stripe sürücüsü.
 *
 * Neden Stripe Checkout (barındırmalı sayfa) ve kendi ödeme formumuz değil:
 *  - PayPal, kart, Apple Pay ve Google Pay tek ekrandan gelir. Almanya'da
 *    yemek siparişinde PayPal pazarlıksızdır ve Stripe onu Alman hesaplarında
 *    yerel yöntem olarak taşır — ayrı SDK, ayrı webhook, ayrı mutabakat yok.
 *  - 3DS/SCA akışını Stripe yürütür.
 *  - Kart verisi hiçbir zaman bizim sunucumuza uğramaz; PCI kapsamı SAQ-A'da
 *    kalır.
 *
 * Hangi ödeme yöntemlerinin görüneceği **Stripe panelinden** yönetilir
 * (Settings → Payment methods). Bu yüzden burada `payment_method_types`
 * verilmez: yeni bir yöntem açmak için kod dağıtmak gerekmesin.
 */

/**
 * API sürümü bilinçli olarak sabitlenir. Stripe hesabın varsayılan sürümünü
 * ilerlettiğinde alanların şekli sessizce değişmesin; yükseltme ayrı ve
 * kasıtlı bir iş olsun.
 */
const API_VERSION = "2026-08-26.dahlia";

let client: Stripe | null = null;

function stripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY tanımlı değil. .env.local dosyasına ekleyin.");
  }
  client = new Stripe(key, { apiVersion: API_VERSION as Stripe.LatestApiVersion });
  return client;
}

/** Stripe hesabının test modunda olup olmadığı — panelde uyarı göstermek için. */
export function isTestMode(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");
}

/**
 * Checkout satırları.
 *
 * Tutarlar cent olarak, sunucudaki hesaptan **olduğu gibi** aktarılır; Stripe
 * tarafında yeniden hesaplama yoktur. Vergi Stripe Tax ile hesaplanmaz: Alman
 * tüketici fiyatı brüttür (PAngV § 3), KDV dökümü bizim veritabanımızda
 * dondurulur.
 */
function toLineItems(request: CheckoutRequest): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const items: Stripe.Checkout.SessionCreateParams.LineItem[] = request.lines.map((line) => ({
    quantity: line.qty,
    price_data: {
      currency: "eur",
      unit_amount: line.unitCents,
      product_data: {
        name: line.label,
        // Stripe boş açıklamayı reddeder; yalnızca doluysa gönderilir.
        ...(line.detail ? { description: line.detail.slice(0, 300) } : {}),
      },
    },
  }));

  if (request.feeCents > 0) {
    items.push({
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: request.feeCents,
        product_data: { name: request.feeLabel },
      },
    });
  }

  /*
   * Bahşiş ayrı satır.
   *
   * Ücretle birleştirilmedi: müşteri ödeme ekranında bıraktığı bahşişi
   * görebilmeli ve "bu para nereden çıktı" diye sormamalı. Ayrıca KDV
   * açısından da ayrı bir kalem (bkz. lib/orders/tip.ts) — Stripe tarafında
   * vergi hesaplanmıyor ama fişteki ayrım doğru okunuyor.
   */
  if (request.tipCents > 0) {
    items.push({
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: request.tipCents,
        product_data: { name: request.tipLabel },
      },
    });
  }

  return items;
}

/** Satırların indirim öncesi toplamı — beyan edilen toplamla karşılaştırmak için. */
function sumOf(items: Stripe.Checkout.SessionCreateParams.LineItem[]): number {
  return items.reduce(
    (sum, item) => sum + (item.price_data?.unit_amount ?? 0) * (item.quantity ?? 1),
    0
  );
}

/**
 * Kullanılan ödeme yöntemi ("card", "paypal" …).
 *
 * Kesin bilgi PaymentIntent'in içindedir, ama webhook gövdesinde o alan
 * genişletilmemiş (yalnızca kimlik) gelir. Oturumda tek bir yöntem varsa o
 * kesin doğrudur; birden çoksa hangisinin seçildiği buradan anlaşılmaz ve null
 * döneriz — yöntem bilgisi bilgilendirme amaçlıdır, akışı etkilemez.
 */
function methodOf(session: Stripe.Checkout.Session): string | null {
  const types = session.payment_method_types;
  return types?.length === 1 ? types[0] : null;
}

/**
 * Checkout oturumunun kapanma anı (Unix saniye).
 *
 * Stripe `expires_at` için iki katı sınır uygular: **en az 30 dakika**, en çok
 * 24 saat sonrası. Sınırın altına düşen bir değer `invalid_request_error` ile
 * reddedilir ve müşteriye "ödeme başlatılamadı" olarak görünür.
 *
 * İki koruma birden gerekiyor:
 *  - `Math.ceil`: saniyeye yuvarlama değeri ASLA aşağı çekmemeli. `floor` ile
 *    tam 30 dakikalık bir pencere 29:59'a düşer ve reddedilir.
 *  - Alt sınır kelepçesi: çağıran taraf ne verirse versin, "şimdi + 30 dk + 60 sn"
 *    altına inilmez. Sipariş yazma ile bu satır arasında geçen süre (veritabanı
 *    işlemi, ağ) pencereden sessizce yenir; kelepçe onu telafi eder.
 */
function checkoutExpiresAt(expiresAt: Date): number {
  const floorSeconds = Math.ceil(Date.now() / 1000) + 30 * 60 + 60;
  return Math.max(Math.ceil(expiresAt.getTime() / 1000), floorSeconds);
}

export const stripeProvider: PaymentProvider = {
  name: "stripe",

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const items = toLineItems(request);

    /*
     * Tahsil edilecek tutar, sunucunun hesapladığı tutarla birebir aynı mı.
     *
     * Bu kontrol bir paranoya değil: satırlar bu dosyada kuruluyor, toplam
     * `composeTotals` içinde hesaplanıyor. İkisinin arasına bir gün yeni bir
     * kalem (ambalaj ücreti, kampanya) girer ve yalnız birine eklenirse,
     * müşteriden ekranda yazandan başka bir tutar çekilir ve fark ancak
     * muhasebede görülür. Burada durmak, orada bulmaktan ucuz.
     */
    const expected = sumOf(items) - request.discountCents;
    if (expected !== request.totalCents) {
      throw new Error(
        `Ödeme tutarı tutmuyor: satırlar ${expected} cent, sipariş ${request.totalCents} cent.`
      );
    }

    /*
     * İndirim, Stripe'ın kendi indirim mekanizmasıyla uygulanır: negatif
     * tutarlı satır kabul edilmiyor. Kupon siparişe özel ve tek kullanımlık
     * üretilir — kataloğa kalıcı bir kupon bırakmanın anlamı yok, indirimin
     * kuralı zaten bizim veritabanımızda.
     */
    let discountId: string | null = null;
    if (request.discountCents > 0) {
      const coupon = await stripe().coupons.create({
        amount_off: request.discountCents,
        currency: "eur",
        duration: "once",
        name: request.discountLabel,
        max_redemptions: 1,
        metadata: { orderNo: request.orderNo },
      });
      discountId = coupon.id;
    }

    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: items,
      ...(discountId ? { discounts: [{ coupon: discountId }] } : {}),
      // Sipariş numarası iki yere birden yazılır: metadata webhook'ta okunur,
      // client_reference_id Stripe panelinde siparişi bulmayı kolaylaştırır.
      metadata: { orderNo: request.orderNo },
      client_reference_id: request.orderNo,
      payment_intent_data: { metadata: { orderNo: request.orderNo } },
      ...(request.email ? { customer_email: request.email } : {}),
      locale: request.lang === "de" ? "de" : "tr",
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      // Oturum, siparişin EXPIRED olacağı anda kapanır: müşteri yarım saat
      // sonra eski bağlantıdan ödeme yapıp karşılığı olmayan bir tahsilat
      // yaratamasın.
      expires_at: checkoutExpiresAt(request.expiresAt),
    });

    if (!session.url) {
      throw new Error("Stripe ödeme bağlantısı üretilemedi.");
    }
    return { id: session.id, url: session.url };
  },

  async parseWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error("STRIPE_WEBHOOK_SECRET tanımlı değil.");
    }
    if (!signature) throw new WebhookSignatureError();

    let event: Stripe.Event;
    try {
      event = stripe().webhooks.constructEvent(rawBody, signature, secret);
    } catch (error) {
      throw new WebhookSignatureError(error);
    }

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderNo = session.metadata?.orderNo ?? session.client_reference_id;

        // Ödeme gerçekten tamamlanmadıysa siparişi PAID yapmayız. PayPal gibi
        // gecikmeli yöntemlerde "completed" olayı "unpaid" durumla gelebilir;
        // parayı async_payment_succeeded getirir.
        if (!orderNo || session.payment_status !== "paid") {
          return { kind: "ignored", eventId: event.id, eventType: event.type };
        }

        return {
          kind: "payment_succeeded",
          eventId: event.id,
          eventType: event.type,
          orderNo,
          providerRef: session.id,
          amountCents: session.amount_total ?? 0,
          method: methodOf(session),
          email: session.customer_details?.email ?? session.customer_email ?? null,
          raw: session,
        };
      }

      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        return {
          kind: "payment_failed",
          eventId: event.id,
          eventType: event.type,
          orderNo: session.metadata?.orderNo ?? session.client_reference_id ?? null,
          raw: session,
        };
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        return {
          kind: "session_expired",
          eventId: event.id,
          eventType: event.type,
          orderNo: session.metadata?.orderNo ?? session.client_reference_id ?? null,
          raw: session,
        };
      }

      default:
        return { kind: "ignored", eventId: event.id, eventType: event.type };
    }
  },

  async fetchPayment(providerRef: string): Promise<PaymentSnapshot | null> {
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe().checkout.sessions.retrieve(providerRef);
    } catch (error) {
      // Oturum bu hesapta yok (test verisi silinmiş, anahtar değişmiş).
      // Bu bir arıza değil: "bilgi yok" demektir, çağıran taraf beklemeye
      // devam eder.
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        error.code === "resource_missing"
      ) {
        return null;
      }
      throw error;
    }

    return {
      // Webhook'taki ölçütün aynısı: "complete" oturum ödendi demek değildir,
      // PayPal gibi gecikmeli yöntemlerde para sonra düşer.
      paid: session.payment_status === "paid",
      amountCents: session.amount_total ?? 0,
      method: methodOf(session),
      email: session.customer_details?.email ?? session.customer_email ?? null,
      raw: session,
    };
  },

  async refund(providerRef: string, amountCents?: number): Promise<RefundResult> {
    // `providerRef` bir Checkout Session kimliğidir; iade PaymentIntent
    // üzerinden yapılır, bu yüzden önce oturum okunur.
    const session = await stripe().checkout.sessions.retrieve(providerRef);
    const intentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;

    if (!intentId) {
      throw new Error("Bu ödeme için iade edilebilir bir işlem bulunamadı.");
    }

    const refund = await stripe().refunds.create({
      payment_intent: intentId,
      ...(amountCents !== undefined ? { amount: amountCents } : {}),
    });

    return { providerRef: refund.id, amountCents: refund.amount };
  },
};

/**
 * Uygulamanın kullandığı sağlayıcı.
 *
 * Tek değişim noktası burasıdır: başka bir sürücü yazılırsa yalnızca bu satır
 * değişir, çağıran hiçbir kod değişmez.
 */
export const paymentProvider: PaymentProvider = stripeProvider;
