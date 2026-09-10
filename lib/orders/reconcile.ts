import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { paymentProvider } from "@/lib/payments/stripe";
import { transitionOrder } from "./repository";
import { settleOrderPayment } from "./settle";

/**
 * Ödeme mutabakatı — webhook'un güvenlik ağı.
 *
 * Webhook tek doğruluk kaynağıdır ama **tek yol olamaz**: yerel geliştirmede
 * Stripe localhost'a ulaşamaz, canlıda uç yanlış yapılandırılmış olabilir,
 * olay gecikebilir veya sunucu o an cevap veremeyebilir. Bu durumların hepsinde
 * müşteri parayı ödemiş olur ama sipariş PENDING_PAYMENT'ta kalır: takip
 * sayfası "ödeme bekleniyor" der ve sipariş panele hiç düşmez.
 *
 * Burada gerçeği **sorarak** öğreniriz: siparişin ödeme oturumu Stripe'ta
 * gerçekten ödenmiş mi? Ödenmişse sipariş, webhook'un kullandığı yolun
 * aynısından (`settleOrderPayment`) kapatılır. Bu bir "ödeme kabul etme" değil,
 * sağlayıcıdan okuma işlemidir; istemcinin söylediği hiçbir şeye güvenilmez.
 *
 * Ödeme bulunamaz ve siparişin ödeme penceresi de kapanmışsa sipariş burada
 * EXPIRED'a taşınır — bkz. fonksiyonun sonundaki gerekçe.
 *
 * Dönen değer siparişin **mutabakat sonrası** durumudur; sipariş yoksa null.
 */
export async function reconcileOrderPayment(orderNo: string): Promise<OrderStatus | null> {
  const order = await prisma.order.findUnique({
    where: { orderNo },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      payments: {
        where: { provider: paymentProvider.name },
        // En yeni oturum önce denenir: müşteri ödemeyi ikinci bir oturumda
        // tamamlamış olabilir.
        orderBy: { createdAt: "desc" },
        select: { providerRef: true },
        take: 3,
      },
    },
  });

  if (!order) return null;
  if (order.status !== "PENDING_PAYMENT") return order.status;

  /*
   * Sağlayıcıya sorulan her oturumun cevabı alındı mı.
   *
   * Aşağıdaki süre dolumu kararı buna bakar: okunamayan tek bir oturum bile
   * varsa "ödenmemiş" sonucuna varılamaz — belki de ödenmiştir ve yalnız
   * Stripe'a ulaşılamamıştır.
   */
  let allAnswered = true;

  for (const payment of order.payments) {
    let snapshot;
    try {
      snapshot = await paymentProvider.fetchPayment(payment.providerRef);
    } catch (error) {
      // Sağlayıcıya ulaşılamadı: sipariş beklemede kalır, webhook veya bir
      // sonraki yoklama işi bitirir. Müşteriye hata göstermeyiz.
      console.error(`[sync] ${orderNo} — ödeme durumu okunamadı`, error);
      allAnswered = false;
      continue;
    }

    if (!snapshot?.paid) continue;

    const { order: settled } = await settleOrderPayment({
      orderNo,
      provider: paymentProvider.name,
      providerRef: payment.providerRef,
      amountCents: snapshot.amountCents,
      method: snapshot.method,
      email: snapshot.email ?? undefined,
      raw: snapshot.raw as Prisma.InputJsonValue,
      source: `${paymentProvider.name}:sync`,
    });
    return settled.status;
  }

  /*
   * Ödeme yok ve pencere kapanmış → sipariş burada, okuma sırasında kapanır.
   *
   * Neden bakım görevini beklemiyoruz: barındırma Hobby planında ve Vercel
   * orada günde tek cron çalıştırıyor (`vercel.json`, 03:00). Yalnız ona
   * güvenilseydi, ödemesini yarıda bırakan müşteri kendi takip sayfasında
   * "ödeme bekleniyor" yazısını ve 20 saniyede bir dönen tazelemeyi bir güne
   * kadar görmeye devam ederdi — hâlbuki Stripe oturumu çoktan kapanmış,
   * ödemesi mümkün olmayan bir siparişti.
   *
   * Burada yapmak güvenli: sağlayıcıya bu satıra gelene kadar zaten soruldu
   * **ve hepsi cevap verdi** (`allAnswered`), yani bakım görevinin "kapatmadan
   * önce mutabakat" kuralı burada da geçerli. Bir oturum okunamadıysa sipariş
   * beklemede bırakılır: karşılığı gösterilmeyen bir tahsilat bırakmaktansa
   * panelde bir gün fazladan duran bir satır yeğdir.
   *
   * Aynı işi iki taraf birden yapabilir (cron ile eşzamanlı çağrı):
   * `transitionOrder` geçişi durum makinesine karşı doğrular ve EXPIRED'dan
   * çıkış olmadığı için ikinci deneme `InvalidTransitionError` ile döner.
   * Bu bir arıza değil, yarışın kaybeden tarafıdır — yutulur.
   */
  if (allAnswered && order.expiresAt && order.expiresAt < new Date()) {
    try {
      const expired = await transitionOrder(order.id, "EXPIRED", "system:sync");
      return expired.status;
    } catch (error) {
      console.error(`[sync] ${orderNo} süresi dolmuş olarak işaretlenemedi`, error);
      return order.status;
    }
  }

  return order.status;
}

/**
 * Süresi dolmak üzere olan ödenmemiş siparişleri kapatmadan önce son bir kez
 * sağlayıcıya sorar.
 *
 * Bakım görevi bu siparişleri EXPIRED'a taşır. Ödemesi alınmış ama webhook'u
 * ulaşmamış bir sipariş bu şekilde kapatılırsa ortada karşılığı gösterilmeyen
 * bir tahsilat kalır — müşteri parayı ödemiştir, yemeği gelmez. Bu yüzden
 * kapatmadan önce gerçek durum okunur.
 *
 * `reconcileOrderPayment` cevabı alınmış ve ödenmemiş siparişi kendisi
 * EXPIRED'a taşıdığı için sayım iki kalemli döner: ödenmiş çıkanlar ve
 * kapatılanlar. Geriye kalan (sağlayıcıya ulaşılamayanlar) hâlâ beklemededir
 * ve bakım görevinin `expireStaleOrders` adımına düşer.
 */
export async function reconcileStalePendingOrders(
  now: Date = new Date()
): Promise<{ settled: number; expired: number }> {
  const stale = await prisma.order.findMany({
    where: { status: "PENDING_PAYMENT", expiresAt: { lt: now } },
    select: { orderNo: true },
    take: 100,
  });

  let settled = 0;
  let expired = 0;
  for (const { orderNo } of stale) {
    try {
      const status = await reconcileOrderPayment(orderNo);
      if (status === "PAID") settled++;
      else if (status === "EXPIRED") expired++;
    } catch (error) {
      // Tek bir siparişin arızası süpürmeyi durdurmasın.
      console.error(`[sync] ${orderNo} mutabakatı başarısız`, error);
    }
  }
  return { settled, expired };
}
