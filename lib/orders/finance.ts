import { prisma } from "@/lib/db";
import { berlinDayStart } from "./stats";

/**
 * Ciro raporu.
 *
 * ─── Neden Stripe paneline bakmak yetmiyor ─────────────────────────────────
 *
 * Stripe **tahsilatı** bilir: hangi kart çekildi, ne zaman ödendi, ne zaman
 * hesaba yatacak. Bilmediği şey işletmenin sorduğu sorulardır: bugün kaç
 * sipariş geldi, ortalama sepet ne, teslimat ücreti ne kadar tuttu, %7 ve %19
 * KDV ayrı ayrı ne oldu, kaç sipariş neden iptal edildi. Bunların cevabı
 * bizim veritabanımızda; Stripe'ta yalnızca toplam tutar var.
 *
 * Bu yüzden bölüşüm şu: **sayılar burada, para hareketi Stripe'ta.** Panel
 * kendi kayıtlarından raporlar, ödeme satırının detayına gerekince Stripe'a
 * bağlantı verir (bkz. stripeSearchUrl). Stripe panelini uygulamanın içine
 * gömmek zaten mümkün değil: gömülü bileşenler yalnızca Connect platformları
 * için var ve tek hesaplı bir işletmede API anahtarını tarayıcıya taşımak
 * demek olurdu.
 *
 * Ciroya yalnızca ödemesi alınmış ve iptal edilmemiş siparişler girer —
 * `lib/orders/stats.ts` ile aynı kural; iki ekran farklı ciro göstermemeli.
 */

const COUNTED_STATUSES = [
  "PAID",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "PICKED_UP",
] as const;

export type PeriodTotals = {
  orders: number;
  revenueCents: number;
  averageCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
};

export const FINANCE_RANGE_DAYS = [1, 7, 14, 30, 90] as const;
export type FinanceRangeDays = (typeof FINANCE_RANGE_DAYS)[number];

export type DayBucket = {
  /** "2026-09-08" — Europe/Berlin gününe göre. */
  date: string;
  orders: number;
  revenueCents: number;
};

export type VatBucketTotal = {
  rate: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
};

export type CancelBucket = {
  /** Ham `cancelReason` değeri; etiketi arayüz çözer. */
  reason: string | null;
  count: number;
  valueCents: number;
};

export type FinanceReport = {
  selected: PeriodTotals;
  rangeDays: FinanceRangeDays;
  today: PeriodTotals;
  /**
   * Hemen öncesindeki eşit uzunlukta dönem.
   *
   * Tek başına bir ciro rakamı bir şey söylemez; "geçen haftaya göre" söyler.
   * Bu iki sayı için sipariş satırları belleğe taşınmaz, veritabanı toplar.
   */
  previous: { orders: number; revenueCents: number };
  /** Seçilen dönem, eskiden yeniye. */
  days: DayBucket[];
  /** Seçilen dönemin KDV dökümü — muhasebeye giden sayı. */
  vat: VatBucketTotal[];
  /** Seçilen dönemde iptal/ret edilen siparişler, sebebe göre. */
  cancelled: CancelBucket[];
  cancelledCount: number;
  cancelledValueCents: number;
  /** Seçilen dönemde iade edilen tutar (Stripe'tan gelen kayıtlara göre). */
  refundedCents: number;
  /** Ödeme yöntemine göre sipariş sayısı ("card", "paypal" …). */
  methods: { method: string; count: number; revenueCents: number }[];
  /** Ödemesi beklenirken süresi dolan sipariş sayısı (seçilen dönem). */
  expiredCount: number;
};

/** Bir siparişin dondurulmuş KDV dökümü; şema `Json` tutar. */
type StoredVatBucket = { rate: number; netCents: number; vatCents: number; grossCents: number };

function berlinDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function emptyTotals(): PeriodTotals {
  return {
    orders: 0,
    revenueCents: 0,
    averageCents: 0,
    deliveryFeeCents: 0,
    serviceFeeCents: 0,
  };
}

function addToTotals(totals: PeriodTotals, order: CountedOrder): void {
  totals.orders += 1;
  totals.revenueCents += order.totalCents;
  totals.deliveryFeeCents += order.deliveryFeeCents;
  totals.serviceFeeCents += order.serviceFeeCents;
}

function finishTotals(totals: PeriodTotals): PeriodTotals {
  return {
    ...totals,
    averageCents: totals.orders > 0 ? Math.round(totals.revenueCents / totals.orders) : 0,
  };
}

export function normalizeFinanceRange(value: unknown): FinanceRangeDays {
  const numeric = typeof value === "string" ? Number(value) : value;
  return FINANCE_RANGE_DAYS.includes(numeric as FinanceRangeDays)
    ? (numeric as FinanceRangeDays)
    : 7;
}

export function financeRangeStart(rangeDays: FinanceRangeDays, now: Date = new Date()): Date {
  const dayStart = berlinDayStart(now);
  return new Date(dayStart.getTime() - (rangeDays - 1) * 24 * 60 * 60 * 1000);
}

type CountedOrder = {
  createdAt: Date;
  totalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  vatBreakdown: unknown;
};

/**
 * Raporu üretir.
 *
 * **Yalnızca seçilen dönem okunur.** Rapor eskiden, ekranda görünmeyen "son 7
 * gün" ve "son 30 gün" kutuları için her açılışta en az otuz günü belleğe
 * çekiyordu; "bugün"e bakmak da otuz günlük sorgu demekti. Kutular kalkınca o
 * zorunluluk da kalktı — dönem daraldıkça sorgu da daralıyor.
 *
 * Kalan tek geniş okuma seçilen dönemin siparişleridir ve tek sorgudur: KDV
 * dökümü zaten satır satır JSON okumayı gerektiriyor, o okuma varken ciroyu,
 * günleri ve ücretleri de aynı geçişte çıkarmak hem ucuz hem tutarlı — iki
 * ekran farklı sayı gösteremez.
 */
export async function getFinanceReport(
  now: Date = new Date(),
  rangeDays: FinanceRangeDays = 7
): Promise<FinanceReport> {
  const dayStart = berlinDayStart(now);
  const rangeStart = financeRangeStart(rangeDays, now);
  // Karşılaştırma dönemi: seçilenin hemen öncesi, aynı uzunlukta.
  const previousStart = new Date(rangeStart.getTime() - rangeDays * 24 * 60 * 60 * 1000);

  const [orders, previous, cancelledRows, refunds, payments, expiredCount] = await Promise.all([
    prisma.order.findMany({
      where: { status: { in: [...COUNTED_STATUSES] }, createdAt: { gte: rangeStart } },
      select: {
        createdAt: true,
        totalCents: true,
        deliveryFeeCents: true,
        serviceFeeCents: true,
        vatBreakdown: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.order.aggregate({
      where: {
        status: { in: [...COUNTED_STATUSES] },
        createdAt: { gte: previousStart, lt: rangeStart },
      },
      _count: { _all: true },
      _sum: { totalCents: true },
    }),
    prisma.order.findMany({
      where: {
        status: { in: ["CANCELLED", "REJECTED"] },
        createdAt: { gte: rangeStart },
      },
      select: { cancelReason: true, totalCents: true },
    }),
    prisma.refund.aggregate({
      where: { createdAt: { gte: rangeStart } },
      _sum: { amountCents: true },
    }),
    prisma.payment.groupBy({
      by: ["method"],
      where: { status: "PAID", paidAt: { gte: rangeStart } },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    prisma.order.count({ where: { status: "EXPIRED", createdAt: { gte: rangeStart } } }),
  ]);

  const selected = emptyTotals();
  const today = emptyTotals();

  const dayMap = new Map<string, DayBucket>();
  // Seçilen dönem boş da olsa listede durur: eksik günler grafikte "veri yok"
  // değil, "o gün sipariş gelmedi" demektir ve bu bilgidir.
  for (let index = rangeDays - 1; index >= 0; index--) {
    const date = berlinDayKey(new Date(dayStart.getTime() - index * 24 * 60 * 60 * 1000));
    dayMap.set(date, { date, orders: 0, revenueCents: 0 });
  }

  const vatMap = new Map<number, VatBucketTotal>();

  for (const order of orders) {
    addToTotals(selected, order);
    if (order.createdAt >= dayStart) addToTotals(today, order);

    const key = berlinDayKey(order.createdAt);
    const bucket = dayMap.get(key);
    if (bucket) {
      bucket.orders += 1;
      bucket.revenueCents += order.totalCents;
    }

    // Döküm sipariş anında dondurulmuştur; burada yeniden hesaplanmaz, toplanır.
    const buckets = Array.isArray(order.vatBreakdown)
      ? (order.vatBreakdown as unknown as StoredVatBucket[])
      : [];
    for (const entry of buckets) {
      const current = vatMap.get(entry.rate) ?? {
        rate: entry.rate,
        netCents: 0,
        vatCents: 0,
        grossCents: 0,
      };
      current.netCents += entry.netCents ?? 0;
      current.vatCents += entry.vatCents ?? 0;
      current.grossCents += entry.grossCents ?? 0;
      vatMap.set(entry.rate, current);
    }
  }

  const cancelMap = new Map<string, CancelBucket>();
  for (const row of cancelledRows) {
    const key = row.cancelReason ?? "";
    const current = cancelMap.get(key) ?? {
      reason: row.cancelReason,
      count: 0,
      valueCents: 0,
    };
    current.count += 1;
    current.valueCents += row.totalCents;
    cancelMap.set(key, current);
  }

  return {
    selected: finishTotals(selected),
    rangeDays,
    today: finishTotals(today),
    previous: {
      orders: previous._count._all,
      revenueCents: previous._sum.totalCents ?? 0,
    },
    days: [...dayMap.values()],
    vat: [...vatMap.values()].sort((a, b) => a.rate - b.rate),
    cancelled: [...cancelMap.values()].sort((a, b) => b.count - a.count),
    cancelledCount: cancelledRows.length,
    cancelledValueCents: cancelledRows.reduce((sum, row) => sum + row.totalCents, 0),
    refundedCents: refunds._sum.amountCents ?? 0,
    methods: payments
      .map((row) => ({
        method: row.method ?? "—",
        count: row._count._all,
        revenueCents: row._sum.amountCents ?? 0,
      }))
      .sort((a, b) => b.count - a.count),
    expiredCount,
  };
}

/**
 * Stripe panelinde bu ödemeyi arayan bağlantı.
 *
 * Doğrudan `/payments/<id>` verilemez: elimizdeki kimlik bir Checkout Session
 * (`cs_…`), PaymentIntent değil. Arama sayfası her iki kimliği de bulur.
 * Test/canlı ayrımı gizli anahtardan okunur — canlı panelde test ödemesini
 * aramak sonuçsuz kalırdı.
 */
export function stripeSearchUrl(providerRef: string): string {
  const testMode = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");
  const base = testMode ? "https://dashboard.stripe.com/test" : "https://dashboard.stripe.com";
  return `${base}/search?query=${encodeURIComponent(providerRef)}`;
}
