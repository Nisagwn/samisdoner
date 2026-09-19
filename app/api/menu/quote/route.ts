import { NextResponse } from "next/server";
import { parseCartLines, parseLang } from "@/lib/cartLines";
import { buildCheckoutQuote } from "@/lib/orders/checkout";
import { withDatabase } from "@/lib/security/dbGuard";
import { checkThrottle, clientIp, recordFailure, throttleKeys } from "@/lib/security/throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sepetin fiyat teklifi.
 *
 * İstemci yalnızca "ne seçtim, nereye, nasıl" der; **tüm tutarlar burada**
 * hesaplanır. Yanıt teslimat ücretini ve genel toplamı da içerir, dolayısıyla
 * sepet çekmecesinde toplanacak bir şey kalmaz — istemcide para aritmetiği
 * yoktur.
 *
 * Sipariş oluşturma ucu (`createOrderAction`) da aynı `buildCheckoutQuote`
 * fonksiyonunu çağırır; ekrandaki tutarla tahsil edilen tutar tek kaynaktan
 * gelir.
 *
 * Sipariş kabul edilemez durumdaysa (kapalıyız, bölge dışı, sepet eşiği) uç
 * yine 200 döner ve sebebi `rejection` alanında taşır: müşteri hem tutarları
 * hem engeli aynı anda görür.
 *
 * `withDatabase`: sepet her değişiklikte bu ucu çağırır ve yanıtı JSON olarak
 * ayrıştırır. Havuzlanmış bağlantı anlık düştüğünde sarmalayıcı olmadan Next
 * HTML hata sayfası döndürür ve sepet "Unexpected token '<'" ile kırılırdı.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const input = (body ?? {}) as Record<string, unknown>;

  // Teslim biçimi tanınmayan bir değerse teslimata düşülür: varsayılanın
  // gel-al olması, teslimat ücretini sessizce sıfırlardı.
  const fulfillment = input.fulfillment === "PICKUP" ? "PICKUP" : "DELIVERY";

  // Posta kodu yalnızca beş haneli hâliyle anlamlı; yarım yazılmış bir kod
  // bölge sorgusuna hiç gitmez.
  const rawZip = typeof input.zip === "string" ? input.zip.trim() : "";
  const zip = /^\d{5}$/.test(rawZip) ? rawZip : undefined;

  /*
   * Kupon, bahşiş ve ön sipariş saati isteğe bağlıdır ve hepsi **sunucuda**
   * denetlenir: kupon kuralı okunur, bahşiş kelepçelenir, saat açılış
   * saatlerine karşı sınanır. Sepet çekmecesi bu alanları hiç göndermiyor ve
   * göndermemeye devam edebilir — eksik alan "yok" demektir.
   */
  const couponCode = typeof input.couponCode === "string" ? input.couponCode : "";
  const tipCents = typeof input.tipCents === "number" ? input.tipCents : 0;

  // Ayrıştırılamayan saat "en kısa sürede"ye düşer: teklif ekranında geçersiz
  // bir saat yüzünden tutarları hiç göstermemek, müşteriyi boş bir özetle
  // baş başa bırakırdı. Sipariş oluşturmada aynı değer reddedilir.
  const rawRequestedAt = typeof input.requestedAt === "string" ? new Date(input.requestedAt) : null;
  const requestedAt =
    rawRequestedAt && !Number.isNaN(rawRequestedAt.getTime()) ? rawRequestedAt : null;

  return withDatabase(async () => {
    /*
     * Kupon kodu denemelerinin hız sınırı.
     *
     * Bu uç oturum istemiyor ve `couponRejection` alanında var olmayan kodu
     * (`coupon_unknown`) var olandan ayırt edilebilir biçimde bildiriyor.
     * İkisi bir araya gelince ortaya bir **kod sayacı** çıkıyor: bir betik
     * sözlükten kod deneyip hangilerinin gerçek olduğunu öğrenebilir. Kodlar
     * panelden elle yazılıyor ("SOMMER10" gibi), yani tahmin edilebilir.
     *
     * Sınır bilinçli olarak yalnızca **kod taşıyan** isteklere uygulanıyor:
     * sepet her değiştiğinde bu uç çağrılıyor ve her çağrıyı saymak, normal
     * alışverişi kilitlerdi.
     *
     * Sayaca yalnızca `coupon_unknown` yazılıyor. Var olan bir kodun başka
     * sebeple reddi (asgari tutarın altı, yanlış teslim biçimi) müşterinin
     * sepetini düzeltirken tekrar tekrar oluşur — onları saymak, elinde
     * gerçek kuponu olan müşteriyi kilitlemek olurdu.
     */
    const couponKeys = [throttleKeys.couponIp(clientIp(request))];
    const throttled = couponCode ? await checkThrottle(couponKeys) : { blocked: false as const };

    const quote = await buildCheckoutQuote({
      lines: parseCartLines(input.lines),
      lang: parseLang(input.lang),
      fulfillment,
      zip,
      // Engelliyken kod veritabanına hiç sorulmaz: sınırın amacı tam olarak
      // o sorgunun cevabını vermemek.
      couponCode: throttled.blocked ? "" : couponCode,
      tipCents,
      requestedAt,
    });

    if (throttled.blocked) {
      return NextResponse.json({
        ...quote,
        couponRejection: {
          code: "coupon_too_many_attempts",
          retryAfterSeconds: throttled.retryAfterSeconds,
        },
      });
    }

    if (quote.couponRejection?.code === "coupon_unknown") {
      await recordFailure(couponKeys);
    }

    return NextResponse.json(quote);
  });
}
