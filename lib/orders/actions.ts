"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getCurrentCustomer } from "@/lib/account/guard";
import { paymentProvider } from "@/lib/payments/stripe";
import { checkThrottle, pickClientIp, recordFailure, throttleKeys } from "@/lib/security/throttle";
import { getOrderSettings } from "./availability";
import { buildCheckoutQuote } from "./checkout";
import { CouponUnavailableError, createOrder } from "./repository";
import { createOrderSchema } from "./schema";
import type { CreateOrderResult } from "./result";
import { settleOnSiteOrder } from "./settle";
import { createOrderToken } from "./token";
import { SITE_URL } from "@/lib/site";

/**
 * Sipariş oluşturma — sistemin para dokunan tek giriş noktası.
 *
 * Sıra bilinçlidir:
 *   1. Girdiyi doğrula (Zod).
 *   2. **Sunucuda fiyatla.** İstemciden gelen hiçbir tutar kullanılmaz;
 *      gövdede "total" alanı olsa bile yok sayılır.
 *   3. Siparişin kabul edilebilirliğini denetle (açık mıyız, bölge, eşik).
 *   4. Siparişi PENDING_PAYMENT olarak **yaz**, sonra ödeme oturumunu aç.
 *      Bu sıra önemli: ödeme kaydı önce açılıp sipariş yazılamazsa, karşılığı
 *      olmayan bir tahsilat oluşur. Tersi durumda en fazla ödenmemiş bir
 *      sipariş kalır ve o da 30 dakika sonra kendiliğinden EXPIRED olur.
 *
 * Misafir akışı: üyelik, oturum veya çerez gerekmez. Müşterinin siparişine
 * erişimi, dönen bağlantıdaki imzalı jetondan gelir.
 */

/**
 * Ödenmemiş siparişin yaşam süresi.
 *
 * Stripe Checkout `expires_at` için **en az 30 dakika** ister ve bu sınırı katı
 * uygular. Tam 30 yazmak sınıra sıfır pay bırakır: bu satır ile isteğin Stripe'a
 * ulaştığı an arasında geçen milisaniyeler ve saniyeye yuvarlama, değeri
 * sınırın altına düşürüp siparişi "ödeme başlatılamadı" ile reddettirebilir.
 * Bir dakikalık pay bu sınıf hataları tamamen kapatır.
 */
const PAYMENT_WINDOW_MINUTES = 31;

/** Aynı IP'den arka arkaya sipariş denemesi sınırı (bkz. `lib/security/throttle`). */
function clientIpFromHeaders(): string {
  const h = headers();
  return pickClientIp(h.get("x-real-ip"), h.get("x-forwarded-for"));
}

export async function createOrderAction(input: unknown): Promise<CreateOrderResult> {
  /*
   * Hız sınırı — doğrulamadan da önce.
   *
   * `createOrderAction` oturum gerektirmeyen, herkese açık ve para dokunan tek
   * giriş noktası. Sınırsız çağrı her seferinde bir sıra numarası tüketir
   * (GoBD açısından boşluk demektir), bir Stripe oturumu açar ve panele çöp
   * doldurur. Giriş uçlarındaki `LoginAttempt` sayacı burada da kullanılır;
   * anahtar ayrıdır, çok sipariş veren müşteri kendini panelden kilitlemesin.
   *
   * Sayaç her denemede artar: giriş uçlarından farklı olarak burada
   * "başarısız deneme" diye bir kategori yok, her çağrının maliyeti var.
   */
  const ip = clientIpFromHeaders();
  const throttleKey = [throttleKeys.orderIp(ip)];
  const throttled = await checkThrottle(throttleKey);
  if (throttled.blocked) {
    return {
      ok: false,
      error: { code: "too_many_requests", retryAfterSeconds: throttled.retryAfterSeconds },
    };
  }
  await recordFailure(throttleKey);

  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: {
        code: "invalid_input",
        field: issue?.path.join("."),
        message: issue?.message ?? "Ungültige Eingabe.",
      },
    };
  }

  const { lines, fulfillment, lang, customer, address, paymentMethod, couponCode, tipCents } =
    parsed.data;

  /*
   * İleri saatli sipariş (Vorbestellung).
   *
   * Saatin gerçekten seçilebilir olduğu `checkOrderability` içinde, çalışma
   * saatleri ve tatil günleri okunarak denetlenir. Burada yalnızca ayrıştırma
   * yapılır; ayrıştırılamayan bir değer "en kısa sürede"ye düşmez, reddedilir —
   * akşam 20:00'ye sipariş verdiğini sanan müşteriye 20 dakika sonra yemek
   * göndermek, sipariş almamaktan kötüdür.
   */
  let requestedAt: Date | null = null;
  if (parsed.data.requestedAt) {
    const parsedDate = new Date(parsed.data.requestedAt);
    if (Number.isNaN(parsedDate.getTime())) {
      return {
        ok: false,
        error: { code: "invalid_input", field: "requestedAt", message: "Ungültige Uhrzeit." },
      };
    }
    requestedAt = parsedDate;
  }

  /*
   * Kapıda ödeme açık mı.
   *
   * `cashEnabled` anahtarı **kapıda ödemenin tamamını** yönetir: nakit ve
   * kapıda kart aynı kapıdan geçer, çünkü ikisinin de işletme açısından anlamı
   * aynı — para teslim anında, personelin elinden alınıyor. Ayarlara ikinci
   * bir anahtar eklemek, panelde birbirinden ayırt edilemeyen iki kutu
   * demekti.
   *
   * Karar sunucuda: arayüz seçeneği gizlese bile istek gövdesi kurcalanabilir.
   */
  if (paymentMethod !== "ONLINE") {
    const settings = await getOrderSettings();
    if (!settings.cashEnabled) {
      return { ok: false, error: { code: "payment_method_unavailable", paymentMethod } };
    }
  }

  /*
   * Oturum açıksa sipariş hesaba bağlanır. Bağ **oturumdan** kurulur, istek
   * gövdesinden değil: gövdeden gelen bir `customerId` kabul edilseydi, herkes
   * kendi siparişini başkasının hesabına — ya da daha kötüsü, başkasının
   * siparişini kendi hesabına — yazabilirdi.
   *
   * Oturum yoksa `null` kalır ve akış misafir siparişi olarak aynen devam
   * eder; üyelik hiçbir aşamada zorunlu değildir.
   */
  const account = await getCurrentCustomer();

  /*
   * Tek geçerli fiyat hesabı.
   *
   * Sepet çekmecesi `/api/menu/quote` üzerinden **aynı** fonksiyonu çağırır;
   * ekrandaki tutarla burada tahsil edilen tutarın ayrışması mümkün değildir.
   * Ücretler, KDV dökümü ve kabul edilebilirlik kararı hep oradan gelir.
   */
  const quote = await buildCheckoutQuote({
    lines,
    lang,
    fulfillment,
    zip: address?.zip,
    couponCode,
    tipCents,
    requestedAt,
  });

  const unavailable = quote.lines.filter((line) => line.unavailable);
  if (unavailable.length > 0) {
    return {
      ok: false,
      error: { code: "unavailable_items", items: unavailable.map((line) => line.label) },
    };
  }
  if (quote.subtotalCents <= 0) {
    return { ok: false, error: { code: "empty_cart" } };
  }

  if (quote.rejection) {
    return { ok: false, error: quote.rejection };
  }

  /*
   * Kupon kodu girilmiş ama kabul edilmemişse sipariş **durur**.
   *
   * Teklif ucunda (sepette) reddedilen kupon akışı durdurmuyor: müşteri kodu
   * düzeltsin diye indirim 0 gösteriliyor. Ama sipariş anında sessizce devam
   * etmek, indirimli olduğunu sanan müşteriden tam tutarı tahsil etmek olurdu.
   */
  if (quote.couponRejection) {
    return { ok: false, error: quote.couponRejection };
  }

  const deliveryFeeCents = quote.deliveryFeeCents;

  /*
   * Ödeme penceresi yalnızca online ödemede vardır: kapıda ödenen siparişte
   * beklenecek bir tahsilat yok, dolayısıyla süresi dolacak bir şey de yok.
   */
  const online = paymentMethod === "ONLINE";
  const paymentWindowEnd = new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60_000);
  const expiresAt = online ? paymentWindowEnd : null;

  let order: Awaited<ReturnType<typeof createOrder>>;
  try {
    order = await createOrder({
    customerId: account?.id ?? null,
    lines: quote.lines,
    subtotalCents: quote.subtotalCents,
    serviceFeeCents: quote.serviceFeeCents,
    deliveryFeeCents,
    // Sepet ve ürün indirimleri ayrı gider: ürün indirimi kendi satırının
    // KDV matrahından düşülüyor (bkz. composeTotals).
    discountCents: quote.cartDiscountCents,
    lineDiscountCents: quote.lineDiscountCents,
    campaigns: quote.campaigns,
    couponCode: quote.couponCode,
    tipCents: quote.tipCents,
    paymentMethod,
    fulfillment,
    lang,
    customerName: customer.name,
    phone: customer.phone,
    // Formda e-posta boş bırakıldıysa hesaptaki adres kullanılır: üye
    // müşteriden aynı bilgiyi ikinci kez istemenin anlamı yok.
    email: customer.email || account?.email || "",
    street: address?.street ?? "",
    houseNo: address?.houseNo ?? "",
    floor: address?.floor ?? "",
    bellName: address?.bellName ?? "",
    zip: address?.zip ?? "",
    city: address?.city ?? "",
    note: customer.note ?? "",
    requestedAt,
      // Tahmini süre siparişe DONDURULUR: bölge ayarı yarın değişse bile bu
      // siparişe verilen söz değişmez. Saatin kendisi ödeme onayında türetilir.
      etaMinutes: quote.etaMinutes,
      expiresAt,
    });
  } catch (error) {
    /*
     * Kampanya, teklif ile sipariş yazımı arasında elden kaçtı. Sipariş hiç
     * oluşmadı (kullanım kaydı ile sipariş aynı işlemde). Kodluysa müşteri
     * kodu silip tekrar dener; otomatikse ödeme ekranı teklifi yeniler ve
     * müşteri yeni tutarı görüp yeniden onaylar.
     */
    if (error instanceof CouponUnavailableError) {
      return { ok: false, error: { code: error.automatic ? "campaign_gone" : "coupon_gone" } };
    }
    throw error;
  }

  const token = await createOrderToken(order.orderNo);

  /*
   * Kapıda ödeme: Stripe'a hiç uğranmaz.
   *
   * Sipariş doğrudan mutfağa düşer ve müşteri takip sayfasına yönlendirilir.
   * Yönlendirme yine bir adrestir (`checkoutUrl`) — çağıran tarafın iki farklı
   * dönüş biçimini ayırt etmesi gerekmesin; ödeme yöntemini seçen zaten o.
   */
  if (!online) {
    try {
      await settleOnSiteOrder({ orderNo: order.orderNo, method: paymentMethod });
    } catch (error) {
      /*
       * Sipariş yazıldı ama mutfağa düşürülemedi. Kayıt PENDING_PAYMENT'ta
       * kalır ve `expiresAt` boş olduğu için bakım görevi onu kapatmaz —
       * panelde görünür ve elle ilerletilebilir. Müşteriye teknik ayrıntı
       * verilmez.
       */
      console.error(`[order] ${order.orderNo} — kapıda ödeme siparişi açılamadı`, error);
      return { ok: false, error: { code: "payment_unavailable" } };
    }

    return {
      ok: true,
      orderNo: order.orderNo,
      checkoutUrl: `${SITE_URL}/bestellung/${encodeURIComponent(token)}`,
    };
  }

  const feeCents = quote.serviceFeeCents + deliveryFeeCents;

  try {
    const session = await paymentProvider.createCheckout({
      orderNo: order.orderNo,
      lines: quote.lines.map((line) => ({
        label: line.label,
        detail: line.detail,
        unitCents: line.unitCents,
        qty: line.qty,
      })),
      feeCents,
      feeLabel: lang === "de" ? "Liefer- und Servicegebühr" : "Teslimat ve servis ücreti",
      tipCents: quote.tipCents,
      tipLabel: lang === "de" ? "Trinkgeld" : "Bahşiş",
      discountCents: quote.discountCents,
      // Stripe indirim adı en fazla 40 karakter kabul ediyor.
      discountLabel: (
        quote.campaigns.map((campaign) => campaign.title || campaign.code).filter(Boolean).join(" + ") ||
        (lang === "de" ? "Rabatt" : "İndirim")
      ).slice(0, 40),
      totalCents: order.totalCents,
      email: customer.email || account?.email || undefined,
      lang,
      successUrl: `${SITE_URL}/bestellung/${encodeURIComponent(token)}`,
      /*
       * İptalde müşteri **ödeme sayfasına** döner, ana sayfaya değil: sepeti ve
       * doldurduğu adres orada duruyor, tek tıkla tekrar deneyebilir. Ana
       * sayfaya atmak, formu yeniden doldurtmak demekti. Sipariş kaydı ödenmemiş
       * kalır ve süresi dolunca kendiliğinden kapanır.
       */
      cancelUrl: `${SITE_URL}/checkout?abgebrochen=1`,
      // Bu dala yalnızca online ödemede gelinir; pencere her zaman doludur.
      expiresAt: paymentWindowEnd,
    });

    // Ödeme satırı beklemede açılır: müşteri Stripe'ta kaybolursa bile hangi
    // oturumun hangi siparişe ait olduğu kayıtlıdır.
    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: paymentProvider.name,
        providerRef: session.id,
        amountCents: order.totalCents,
        status: "PENDING",
      },
    });

    return { ok: true, orderNo: order.orderNo, checkoutUrl: session.url };
  } catch (error) {
    // Ödeme oturumu açılamadı: sipariş ödenmemiş olarak kalır, süresi dolunca
    // kapanır. Müşteriye teknik ayrıntı verilmez.
    console.error(`[order] ${order.orderNo} — ödeme oturumu açılamadı`, error);
    return { ok: false, error: { code: "payment_unavailable" } };
  }
}
