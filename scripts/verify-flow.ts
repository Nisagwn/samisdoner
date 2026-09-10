/**
 * Uçtan uca akış doğrulaması.
 *
 * Çalıştırma:  npm run verify:flow
 *
 * Birim testler saf mantığı kanıtlar; bu betik **bağlantıyı** kanıtlar:
 * gerçek veritabanı ve gerçek Stripe test hesabıyla siparişin baştan sona
 * yürüyüp yürümediğini. Yarattığı bütün kayıtları sonunda siler.
 *
 * DİKKAT: geliştirme/test veritabanında çalıştırılmalıdır. Stripe yalnızca
 * test anahtarıyla (sk_test_) çağrılır; canlı anahtarla çalıştırmayın.
 */

import { PrismaClient } from "@prisma/client";
import { priceCart } from "@/lib/admin/store";

const prisma = new PrismaClient();
let failures = 0;

function check(name: string, passed: boolean, detail = "") {
  if (!passed) failures++;
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

async function main() {
  const { createOrder, markOrderPaid, transitionOrder, getOrderByNo } = await import(
    "@/lib/orders/repository"
  );
  const { paymentProvider } = await import("@/lib/payments/stripe");
  const { createOrderToken, verifyOrderToken } = await import(
    "@/lib/orders/token"
  );
  const { checkOrderability, deliveryFeeFor } = await import(
    "@/lib/orders/availability"
  );

  console.log("=== A. SUNUCU TARAFI FİYATLANDIRMA ===");
  const quote = await priceCart(
    [
      { kind: "product", productId: "drehspiess--drehspiess-xl-03", qty: 2 },
      { kind: "product", productId: "drehspiess--dueruem-drehspiess-04", qty: 1 },
    ],
    "de"
  );
  check("sepet fiyatlandı", quote.subtotalCents === 2600, `subtotal=${quote.subtotalCents} (2×900+800)`);
  check(
    "KDV dökümü toplamı tutuyor",
    quote.vatBreakdown.reduce((s, b) => s + b.grossCents, 0) === quote.totalCents,
    `${quote.totalCents}`
  );

  console.log("\n=== B. SİPARİŞ KABUL EDİLEBİLİRLİĞİ ===");
  const orderability = await checkOrderability({
    fulfillment: "DELIVERY",
    zip: "94342",
    subtotalCents: quote.subtotalCents,
  });
  check("94342 için sipariş kabul ediliyor", orderability.ok, JSON.stringify(orderability));

  const outside = await checkOrderability({
    fulfillment: "DELIVERY",
    zip: "10115",
    subtotalCents: quote.subtotalCents,
  });
  check(
    "bölge dışı reddediliyor",
    !outside.ok && outside.reason.code === "out_of_delivery_area",
    outside.ok ? "kabul edildi!" : outside.reason.code
  );

  const tooSmall = await checkOrderability({
    fulfillment: "DELIVERY",
    zip: "94342",
    subtotalCents: 500,
  });
  check(
    "minimum sepet altı reddediliyor",
    !tooSmall.ok && tooSmall.reason.code === "below_minimum",
    tooSmall.ok ? "kabul edildi!" : tooSmall.reason.code
  );

  if (!orderability.ok) throw new Error("sipariş kabul edilmedi, devam edilemiyor");
  const deliveryFee = orderability.zone ? deliveryFeeFor(orderability.zone, quote.subtotalCents) : 0;
  check("teslimat ücreti hesaplandı", deliveryFee === 200, `${deliveryFee} cent (30 € altı)`);

  console.log("\n=== C. TEST HESABI ===");
  const email = `flow-${Date.now()}@example.invalid`;
  const account = await prisma.customer.create({
    data: { email, passwordHash: "test", name: "Akış Testi", phone: "0176 000", lang: "de" },
  });
  check("test hesabı açıldı", Boolean(account.id));

  console.log("\n=== D. SİPARİŞİN VERİTABANINA YAZILMASI ===");
  const order = await createOrder({
    customerId: account.id,
    lines: quote.lines,
    subtotalCents: quote.subtotalCents,
    serviceFeeCents: quote.serviceFeeCents,
    deliveryFeeCents: deliveryFee,
    fulfillment: "DELIVERY",
    lang: "de",
    customerName: "Akış Testi",
    phone: "0176 000",
    email,
    street: "Straubinger Str.",
    houseNo: "3",
    floor: "3. OG links",
    bellName: "Akış",
    zip: "94342",
    city: "Straßkirchen",
    note: "Otomatik akış testi",
    requestedAt: null,
    etaMinutes: orderability.etaMinutes,
    expiresAt: new Date(Date.now() + 31 * 60_000),
  });

  check("sipariş numarası üretildi", /^SD-\d{6}-\d{3}$/.test(order.orderNo), order.orderNo);
  check("durum PENDING_PAYMENT", order.status === "PENDING_PAYMENT", order.status);
  check("satırlar anlık görüntü olarak yazıldı", order.lines.length === 2, `${order.lines.length} satır`);
  check(
    "toplam = ara toplam + ücretler",
    order.totalCents === quote.subtotalCents + quote.serviceFeeCents + deliveryFee,
    `${order.totalCents}`
  );
  check("sipariş hesaba bağlandı", order.customerId === account.id);

  const events0 = await prisma.orderEvent.findMany({ where: { orderId: order.id } });
  check("ilk durum olayı yazıldı (append-only)", events0.length === 1, `${events0.length} olay`);

  console.log("\n=== E. STRIPE ÖDEME OTURUMU (test modu) ===");
  const token = await createOrderToken(order.orderNo);
  let sessionId = "";
  try {
    const session = await paymentProvider.createCheckout({
      orderNo: order.orderNo,
      lines: quote.lines.map((l) => ({
        label: l.label,
        detail: l.detail,
        unitCents: l.unitCents,
        qty: l.qty,
      })),
      feeCents: quote.serviceFeeCents + deliveryFee,
      feeLabel: "Liefer- und Servicegebühr",
      totalCents: order.totalCents,
      email,
      lang: "de",
      successUrl: `http://localhost:3000/bestellung/${encodeURIComponent(token)}`,
      cancelUrl: "http://localhost:3000/?bestellung=abgebrochen",
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    sessionId = session.id;
    check("Stripe ödeme oturumu açıldı", session.id.startsWith("cs_"), session.id.slice(0, 20) + "…");
    check("ödeme bağlantısı üretildi", session.url.startsWith("https://"), session.url.slice(0, 45) + "…");
  } catch (error) {
    check("Stripe ödeme oturumu açıldı", false, (error as Error).message);
  }

  if (sessionId) {
    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: "stripe",
        providerRef: sessionId,
        amountCents: order.totalCents,
        status: "PENDING",
      },
    });
    check("ödeme kaydı beklemede açıldı", true);
  }

  console.log("\n=== F. ÖDEME ONAYI VE İDEMPOTENCY ===");
  const paid = await markOrderPaid({
    orderNo: order.orderNo,
    provider: "stripe",
    providerRef: sessionId || "cs_test_manual",
    amountCents: order.totalCents,
    method: "card",
    email,
  });
  check("sipariş PAID oldu", paid.order.status === "PAID", paid.order.status);
  check("ilk işlemede alreadyPaid=false", paid.alreadyPaid === false);

  const again = await markOrderPaid({
    orderNo: order.orderNo,
    provider: "stripe",
    providerRef: sessionId || "cs_test_manual",
    amountCents: order.totalCents,
    method: "card",
    email,
  });
  check("tekrar gönderimde alreadyPaid=true (bildirim tekrarlanmaz)", again.alreadyPaid === true);
  const payments = await prisma.payment.count({ where: { orderId: order.id } });
  check("ikinci kez ödeme satırı YAZILMADI", payments === 1, `${payments} ödeme satırı`);

  /*
   * Teslim saati ödeme onayında dondurulur; siparişin yazıldığı anda değil.
   * Beklenen an "şimdi + etaMinutes"; iki saniyelik pay, veritabanı gidiş
   * dönüşü için.
   */
  const promised = paid.order.promisedAt;
  const expectedPromise = Date.now() + (orderability.etaMinutes ?? 0) * 60_000;
  check(
    "teslim saati (promisedAt) ödemede donduruldu",
    promised !== null && Math.abs(promised.getTime() - expectedPromise) < 2_000,
    promised ? promised.toISOString() : "yazılmadı!"
  );

  const { delayOrderPromise } = await import("@/lib/orders/repository");
  const delayed = await delayOrderPromise(order.id, 10, "verify-flow");
  check(
    "panelden +10 dk gecikme bildirimi saati öteledi",
    delayed !== null &&
      promised !== null &&
      delayed.promisedAt!.getTime() - promised.getTime() === 10 * 60_000,
    delayed?.promisedAt?.toISOString() ?? "ötelenmedi!"
  );

  console.log("\n=== G. MUTFAK PANELİ AKIŞI ===");
  const feed = await prisma.order.findMany({
    where: { status: { in: ["PAID", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] } },
    select: { orderNo: true, acknowledgedAt: true },
  });
  check(
    "sipariş panel akışında görünüyor",
    feed.some((o) => o.orderNo === order.orderNo),
    `${feed.length} canlı sipariş`
  );
  check(
    "sesli uyarı tetikleniyor (henüz görülmedi)",
    feed.find((o) => o.orderNo === order.orderNo)?.acknowledgedAt === null
  );

  console.log("\n=== H. DURUM MAKİNESİ (gerçek geçişler) ===");
  await transitionOrder(order.id, "ACCEPTED", "admin");
  await transitionOrder(order.id, "PREPARING", "admin");
  await transitionOrder(order.id, "OUT_FOR_DELIVERY", "admin");
  const delivered = await transitionOrder(order.id, "DELIVERED", "admin");
  check("teslim edildi", delivered.status === "DELIVERED");
  check("her geçiş geçmişe yazıldı", delivered.events.length === 6, `${delivered.events.length} olay`);

  let rejected = false;
  try {
    await transitionOrder(order.id, "PREPARING", "admin");
  } catch {
    rejected = true;
  }
  check("teslim edilmiş sipariş geri alınamıyor", rejected);

  console.log("\n=== H2. İADE ===");
  /*
   * Burada Stripe'a **gidilmez**. Akış betiği ödemeyi `markOrderPaid` ile
   * doğrudan yazıyor; ortada gerçek bir tahsilat olmadığı için gerçek bir
   * iade de yapılamaz. Sınanan şey iadenin kapıları: sağlayıcıya hangi
   * durumlarda hiç gidilmediği ve aynı ödemenin ikinci kez iade edilemediği.
   * Gerçek para hareketi elle yürütülen senaryonun işi (bkz. tests/README.md).
   */
  const { refundOrder } = await import("@/lib/orders/refund");

  const paidPayment = await prisma.payment.findFirstOrThrow({
    where: { orderId: order.id },
  });

  // İdempotency kapısı: iade satırı varsa sağlayıcıya hiç gidilmez.
  await prisma.refund.create({
    data: {
      paymentId: paidPayment.id,
      amountCents: paidPayment.amountCents,
      providerRef: "re_test_verify_flow",
      reason: "akış doğrulaması",
    },
  });
  const second = await refundOrder(delivered, "ikinci deneme", "verify-flow");
  check("aynı ödeme ikinci kez iade edilmiyor", second.kind === "already_refunded", second.kind);

  // Ödemesi hiç alınmamış sipariş: sağlayıcıya gitmenin karşılığı yok.
  await prisma.refund.deleteMany({ where: { paymentId: paidPayment.id } });
  await prisma.payment.update({
    where: { id: paidPayment.id },
    data: { status: "PENDING" },
  });
  const nothing = await refundOrder(delivered, "ödeme yok", "verify-flow");
  check(
    "ödemesi alınmamış siparişte iade denenmiyor",
    nothing.kind === "nothing_to_refund",
    nothing.kind
  );
  await prisma.payment.update({ where: { id: paidPayment.id }, data: { status: "PAID" } });

  /*
   * Denetim izi: ödemeyi kimin kapattığı (webhook mu, ödeme sayfasından
   * dönüşteki mutabakat mı) artık olay kaydında duruyor. Önceden ikisi de
   * "stripe" yazıyordu ve ayrım yalnızca console.info satırındaydı — yani
   * günlükler döndükten sonra kayboluyordu.
   */
  const paidEvent = await prisma.orderEvent.findFirst({
    where: { orderId: order.id, to: "PAID" },
    select: { actor: true },
  });
  check(
    "ödeme olayının kaynağı geçmişe yazıldı",
    typeof paidEvent?.actor === "string" && paidEvent.actor.length > 0,
    paidEvent?.actor ?? "yazılmadı!"
  );

  console.log("\n=== I. MÜŞTERİ TAKİP JETONU ===");
  const resolved = await verifyOrderToken(token);
  check("takip jetonu doğrulanıyor", resolved === order.orderNo, resolved ?? "null");
  const forged = await verifyOrderToken(order.orderNo + ".sahteimza");
  check("sahte jeton reddediliyor", forged === null);
  const found = await getOrderByNo(order.orderNo);
  check("takip sayfası siparişi buluyor", found?.orderNo === order.orderNo);

  console.log("\n=== J. HESAP GEÇMİŞİ ===");
  const history = await prisma.order.findMany({ where: { customerId: account.id } });
  check("sipariş hesap geçmişinde", history.length === 1, `${history.length} sipariş`);
  const otherHistory = await prisma.order.findMany({ where: { customerId: "baskasi" } });
  check("başkasının kimliğiyle sorgu boş dönüyor", otherHistory.length === 0);

  console.log("\n=== K. DSGVO ANONİMLEŞTİRME ===");
  const { anonymizeCustomer } = await import("@/lib/account/repository");
  await anonymizeCustomer(account.id);
  const after = await prisma.customer.findUniqueOrThrow({ where: { id: account.id } });
  check("hesap anonimleşti", after.anonymizedAt !== null && after.name === "");
  check("e-posta geri döndürülemez hâle geldi", !after.email.includes("flow-"), after.email);
  const orderAfter = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  check("sipariş SİLİNMEDİ (§ 147 AO)", orderAfter.totalCents === order.totalCents);
  check("siparişin kişisel alanları temizlendi", orderAfter.phone === "" && orderAfter.street === "");
  const linesAfter = await prisma.orderLine.count({ where: { orderId: order.id } });
  check("sipariş satırları duruyor", linesAfter === 2, `${linesAfter} satır`);

  console.log("\n=== TEMİZLİK ===");
  await prisma.refund.deleteMany({ where: { payment: { orderId: order.id } } });
  await prisma.orderEvent.deleteMany({ where: { orderId: order.id } });
  await prisma.payment.deleteMany({ where: { orderId: order.id } });
  await prisma.orderLine.deleteMany({ where: { orderId: order.id } });
  await prisma.order.delete({ where: { id: order.id } });
  await prisma.customer.delete({ where: { id: account.id } });
  console.log("test verisi silindi");

  console.log("\n" + "=".repeat(50));
  console.log(failures === 0 ? "TÜM AKIŞ DOĞRULAMALARI GEÇTİ" : `${failures} DOĞRULAMA DÜŞTÜ`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("AKIŞ HATASI:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
