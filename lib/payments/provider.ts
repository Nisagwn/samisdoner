/**
 * Ödeme sağlayıcısı arayüzü.
 *
 * Sipariş domaini Stripe'ı **tanımaz**: yalnızca bu arayüzü bilir. Sağlayıcı
 * değiştirilecekse (ör. Mollie) yapılacak iş yeni bir sürücü yazmaktır;
 * sipariş akışı, veri modeli ve panel aynı kalır.
 *
 * Bu yüzden burada Stripe tipleri geçmez — hepsi sade veri.
 */

export type CheckoutLine = {
  label: string;
  detail: string;
  /** Birim brüt fiyat (cent). Almanya'da gösterilen fiyat KDV dahildir. */
  unitCents: number;
  qty: number;
};

export type CheckoutRequest = {
  orderNo: string;
  lines: CheckoutLine[];
  /** Teslimat + servis ücreti; tek bir satır olarak gösterilir. */
  feeCents: number;
  feeLabel: string;
  /**
   * Bahşiş (cent). Sağlayıcı sayfasında **ayrı bir satır** olarak görünür:
   * müşteri ödeme ekranında bıraktığı bahşişi görebilmeli, toplamın içinde
   * kaybolmamalı.
   */
  tipCents: number;
  tipLabel: string;
  /**
   * Kupon indirimi (pozitif cent). Satır olarak eklenemez — hiçbir sağlayıcı
   * negatif tutarlı satır kabul etmez — bu yüzden sürücü bunu kendi indirim
   * mekanizmasıyla uygular.
   */
  discountCents: number;
  discountLabel: string;
  /**
   * Sunucuda hesaplanmış toplam.
   *
   * Sürücü bunu **doğrulamak zorundadır**: kendi kurduğu satırların toplamı
   * buna eşit değilse oturum hiç açılmamalıdır. Aksi hâlde ekranda yazan
   * tutardan farklı bir tutar tahsil edilir ve fark ancak mutabakatta
   * görülür.
   */
  totalCents: number;
  email?: string;
  lang: "tr" | "de";
  successUrl: string;
  cancelUrl: string;
  /** Oturumun geçerlilik sonu; siparişin EXPIRED olma anıyla aynı. */
  expiresAt: Date;
};

export type CheckoutSession = {
  /** Sağlayıcıdaki oturum kimliği; ödeme kaydında `providerRef` olur. */
  id: string;
  /** Müşterinin yönlendirileceği barındırmalı ödeme sayfası. */
  url: string;
};

/** Webhook'tan çıkan, sağlayıcıdan bağımsız olay. */
export type PaymentEvent =
  | {
      kind: "payment_succeeded";
      /** Sağlayıcı olayının kimliği — idempotency anahtarı. */
      eventId: string;
      eventType: string;
      orderNo: string;
      providerRef: string;
      amountCents: number;
      method: string | null;
      email: string | null;
      raw: unknown;
    }
  | {
      kind: "payment_failed" | "session_expired";
      eventId: string;
      eventType: string;
      orderNo: string | null;
      raw: unknown;
    }
  | { kind: "ignored"; eventId: string; eventType: string };

/**
 * Sağlayıcıdaki ödeme oturumunun anlık durumu.
 *
 * Webhook'un ulaşmadığı durumlarda gerçeği **sorarak** öğrenmek için gerekir:
 * olay kaybolabilir, gecikebilir, uç yanlış yapılandırılmış olabilir. Bu
 * okuma, webhook'un taşıdığı bilginin aynısını taşır — böylece iki yol da
 * siparişi tıpatıp aynı şekilde kapatır.
 */
export type PaymentSnapshot = {
  paid: boolean;
  amountCents: number;
  method: string | null;
  email: string | null;
  raw: unknown;
};

export type RefundResult = {
  providerRef: string;
  amountCents: number;
};

export interface PaymentProvider {
  /** Ödeme kayıtlarında saklanan sağlayıcı adı ("stripe"). */
  readonly name: string;

  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;

  /**
   * Ham gövdeyi ve imzayı doğrulayıp olayı çözer.
   *
   * Gövde **ham metin** olmalıdır: JSON olarak ayrıştırılıp yeniden
   * serileştirilmiş bir gövdenin imzası tutmaz.
   */
  parseWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent>;

  /**
   * Ödeme oturumunun sağlayıcıdaki güncel durumunu okur.
   *
   * Oturum sağlayıcıda yoksa null döner (silinmiş test verisi, anahtar
   * değişimi). Webhook'a ek bir güvence ağıdır, onun yerini almaz: webhook
   * müşteri sayfaya hiç dönmese de çalışır, bu okuma ise müşteri döndüğünde.
   */
  fetchPayment(providerRef: string): Promise<PaymentSnapshot | null>;

  /** Tam veya kısmi iade. `amountCents` verilmezse tamamı iade edilir. */
  refund(providerRef: string, amountCents?: number): Promise<RefundResult>;
}

/**
 * Ödeme isteğinin kendi içinden çıkan toplam.
 *
 * Sağlayıcıya gönderilen kalemler (satırlar + ücret + bahşiş − indirim) ile
 * siparişe yazılan `totalCents` **aynı sayı olmak zorunda**. İkisi ayrı yerde
 * hesaplanıyor: biri `composeTotals` içinde katalog fiyatlarından, diğeri
 * burada sağlayıcıya gidecek kalemlerden. Araya bir gün yeni bir kalem
 * (ambalaj ücreti, ikinci bir kampanya) girer ve yalnız birine eklenirse,
 * müşteriden ekranda yazandan başka bir tutar çekilir — ve fark ancak
 * muhasebede görülür.
 *
 * Sürücünün içinde değil burada: saf bir fonksiyon olarak testte doğrudan
 * çalıştırılabilsin ve Stripe'a özgü olmayan bu kural yeni bir sürücü
 * yazıldığında da elde kalsın.
 */
export function checkoutAmountOf(
  request: Pick<CheckoutRequest, "lines" | "feeCents" | "tipCents" | "discountCents">
): number {
  const lines = request.lines.reduce((sum, line) => sum + line.unitCents * line.qty, 0);
  return lines + request.feeCents + request.tipCents - request.discountCents;
}

/** Tutar tutmuyorsa fırlatılır; oturum hiç açılmamalıdır. */
export class CheckoutAmountMismatchError extends Error {
  constructor(
    readonly expectedCents: number,
    readonly requestedCents: number
  ) {
    super(
      `Ödeme tutarı tutmuyor: kalemler ${expectedCents} cent, sipariş ${requestedCents} cent.`
    );
    this.name = "CheckoutAmountMismatchError";
  }
}

/** İmza doğrulanamadığında fırlatılır — çağıran taraf 400 döner. */
export class WebhookSignatureError extends Error {
  constructor(cause?: unknown) {
    super("Webhook imzası doğrulanamadı.");
    this.name = "WebhookSignatureError";
    this.cause = cause;
  }
}
