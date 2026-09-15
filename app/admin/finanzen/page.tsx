import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import {
  FINANCE_RANGE_DAYS,
  financeRangeStart,
  getFinanceReport,
  normalizeFinanceRange,
  stripeSearchUrl,
} from "@/lib/orders/finance";
import { adminCancelLabel } from "@/lib/orders/cancelReasons";
import { getStaleProducts, getTopProducts } from "@/lib/admin/insights";

/**
 * Ciro ve ödemeler.
 *
 * Panelde şimdiye kadar para yalnızca dashboard'daki üç kutuydu: bugünkü ciro,
 * ortalama sepet, haftalık toplam. "Dün ne oldu", "bu ay KDV ne kadar", "kaç
 * sipariş neden iptal edildi", "şu ödeme Stripe'ta hangisiydi" sorularının
 * cevabı yoktu; işletmeci bunun için Stripe paneline gidip ödemeleri tek tek
 * okumak zorundaydı.
 *
 * Bölüşüm şu: **sayılar burada, para hareketi Stripe'ta.** Sipariş sayısı,
 * sepet ortalaması, ücretler, KDV dökümü ve iptal sebepleri bizim
 * kayıtlarımızdan gelir — Stripe bunları bilmez. Tahsilatın kendisi (kart,
 * iade, ödeme günü, hesaba geçiş) Stripe'ın işidir ve her ödeme satırından
 * oraya bağlantı verilir.
 */

export const dynamic = "force-dynamic";

const DAY_LABEL = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
});

const TIMESTAMP = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Berlin",
  dateStyle: "short",
  timeStyle: "short",
});

function rangeLabel(days: number): string {
  return days === 1 ? "Bugün" : `Son ${days} gün`;
}

/**
 * Bir önceki eşit dönemle karşılaştırma.
 *
 * "1.240 €" tek başına iyi mi kötü mü söylemez; "geçen haftaya göre %12 fazla"
 * söyler. Önceki dönemde hiç ciro yoksa yüzde hesaplanamaz (sıfıra bölme değil,
 * anlamsızlık): o durumda kıyas gösterilmez.
 */
function Trend({
  currentCents,
  previousCents,
  rangeDays,
}: {
  currentCents: number;
  previousCents: number;
  rangeDays: number;
}) {
  if (previousCents <= 0) return null;

  const change = Math.round(((currentCents - previousCents) / previousCents) * 100);
  const up = change >= 0;

  return (
    <p className={`tag mt-2 tabular-nums ${up ? "text-herb" : "text-flame"}`}>
      {up ? "▲" : "▼"} %{Math.abs(change)}{" "}
      <span className="text-smoke">
        {rangeDays === 1 ? "düne göre" : `önceki ${rangeDays} güne göre`}
      </span>
    </p>
  );
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams?: { range?: string };
}) {
  const rangeDays = normalizeFinanceRange(searchParams?.range);
  const rangeStart = financeRangeStart(rangeDays);

  const [report, recent, topProducts, staleProducts] = await Promise.all([
    getFinanceReport(new Date(), rangeDays),
    // Son ödemeler: Stripe'a giden köprü. Sipariş numarasıyla ödeme kimliğini
    // yan yana görmek, "şu ödemeyi iade eder misiniz" konuşmasını tek ekrana
    // indiriyor.
    prisma.payment.findMany({
      where: { status: "PAID", paidAt: { gte: rangeStart } },
      orderBy: { paidAt: "desc" },
      take: 50,
      select: {
        id: true,
        providerRef: true,
        amountCents: true,
        method: true,
        paidAt: true,
        order: { select: { orderNo: true } },
      },
    }),
    /* Ürün kırılımı. Ciro toplamı "iyi mi gidiyor" der; bu iki liste
       "ne alayım, neyi vitrinden indireyim" der — haftalık et ve ekmek
       siparişinin verildiği yer burası. */
    getTopProducts(rangeDays),
    getStaleProducts(rangeDays),
  ]);

  const peak = Math.max(...report.days.map((day) => day.revenueCents), 1);
  const currentLabel = rangeLabel(report.rangeDays);

  return (
    <div className="max-w-[1100px]">
      <header className="mb-10">
        <p className="tag mb-2 text-flame">Para</p>
        <h1 className="font-display text-3xl font-extrabold text-bone md:text-4xl">
          Ciro ve ödemeler
        </h1>
        <p className="mt-3 text-sm text-smoke">
          Ödemesi alınmış ve iptal edilmemiş siparişler; tutarlar sipariş anındaki
          kayıttan gelir.
        </p>
      </header>

      <nav className="mb-8 flex flex-wrap gap-2" aria-label="Finans dönemi">
        {FINANCE_RANGE_DAYS.map((days) => {
          const active = days === report.rangeDays;
          return (
            <Link
              key={days}
              href={`/admin/finanzen?range=${days}`}
              aria-current={active ? "page" : undefined}
              className={`focus-ring tag border px-4 py-2.5 transition-colors ${
                active
                  ? "border-amber bg-amber text-void"
                  : "border-line text-smoke hover:border-amber hover:text-amber"
              }`}
            >
              {rangeLabel(days)}
            </Link>
          );
        })}
      </nav>

      {/* --- seçilen dönem özeti --- */}
      <section className="mb-10 grid gap-px border border-line bg-line md:grid-cols-4">
        <div className="bg-char p-6 md:col-span-2">
          <p className="tag text-smoke">{currentLabel}</p>
          <p className="mt-2 font-display text-3xl font-extrabold tabular-nums text-herb">
            {formatCents(report.selected.revenueCents)}
          </p>
          <p className="mt-2 text-sm text-smoke">Ciro</p>
          <Trend
            currentCents={report.selected.revenueCents}
            previousCents={report.previous.revenueCents}
            rangeDays={report.rangeDays}
          />
        </div>
        <div className="bg-char p-6">
          <p className="tag text-smoke">Sipariş</p>
          <p className="mt-2 font-display text-3xl font-extrabold tabular-nums text-bone">
            {report.selected.orders}
          </p>
          <p className="mt-2 text-sm text-smoke">
            Ortalama {formatCents(report.selected.averageCents)}
          </p>
        </div>
        <div className="bg-char p-6">
          <p className="tag text-smoke">Ücretler</p>
          <dl className="mt-3 space-y-1 font-mono text-xs text-smoke">
            <div className="flex justify-between gap-4">
              <dt>Teslimat</dt>
              <dd className="tabular-nums text-bone">
                {formatCents(report.selected.deliveryFeeCents)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Servis</dt>
              <dd className="tabular-nums text-bone">
                {formatCents(report.selected.serviceFeeCents)}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* --- günlük seyir ---
          Tek günlük dönemde çizilecek bir seyir yok: o zaten yukarıdaki özet.
          Uzun dönemde liste kendi içinde kaydırılır; doksan satır sayfayı
          aşağı iterek KDV ve iptalleri ekrandan çıkarıyordu. */}
      {report.rangeDays > 1 && (
      <section className="mb-10">
        <h2 className="mb-4 font-display text-xl font-extrabold text-bone">
          Günlük seyir — {currentLabel}
        </h2>
        <ul
          className={`divide-y divide-line border border-line ${
            report.rangeDays > 14 ? "max-h-[26rem] overflow-y-auto overscroll-contain" : ""
          }`}
        >
          {report.days.map((day) => (
            <li key={day.date} className="flex items-center gap-4 bg-char px-5 py-2.5">
              <span className="w-14 shrink-0 font-mono text-xs tabular-nums text-smoke">
                {DAY_LABEL.format(new Date(`${day.date}T12:00:00Z`))}
              </span>
              {/* Çubuk en yüksek güne göre oranlanır; sayı zaten sağda duruyor,
                  çubuk yalnızca seyri bir bakışta göstermek için. */}
              <span className="h-2 min-w-0 flex-1 bg-void">
                <span
                  className="block h-2 bg-amber/70"
                  style={{ width: `${Math.round((day.revenueCents / peak) * 100)}%` }}
                />
              </span>
              <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-smoke">
                {day.orders} ad.
              </span>
              <span className="w-24 shrink-0 text-right font-mono text-sm tabular-nums text-bone">
                {formatCents(day.revenueCents)}
              </span>
            </li>
          ))}
        </ul>
      </section>
      )}

      {/*
        Ürün kırılımı.

        Sıralama adet üzerinden — "en çok satan" bir adet sorusudur. Ciroya
        göre sıralanmış bir liste pahalı ürünlerin eline geçer ve mutfağın
        ihtiyacı olan "en çok hangi malzeme gidiyor" bilgisini gizler; ciro
        yine de yanında durur, çünkü adet tek başına kârı anlatmaz.
      */}
      <section className="mb-10 grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-4 font-display text-xl font-extrabold text-bone">
            En çok satanlar
          </h2>
          {topProducts.length === 0 ? (
            <p className="border border-line bg-char px-5 py-6 text-sm text-smoke">
              Bu dönemde satış yok.
            </p>
          ) : (
            <ul className="divide-y divide-line border border-line">
              {topProducts.map((product, index) => (
                <li
                  key={product.label}
                  className="flex items-center gap-4 bg-char px-5 py-3"
                >
                  <span className="tag w-6 shrink-0 tabular-nums text-smoke/60">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-bone">
                    {product.label}
                  </span>
                  <span className="font-display text-lg font-extrabold tabular-nums text-amber">
                    {product.qty}
                    <span className="ml-1 text-xs font-semibold text-smoke">adet</span>
                  </span>
                  <span className="tag w-20 shrink-0 text-right tabular-nums text-smoke">
                    {formatCents(product.revenueCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="mb-4 font-display text-xl font-extrabold text-bone">
            Hiç satmayanlar
          </h2>
          {staleProducts.length === 0 ? (
            <p className="border border-line bg-char px-5 py-6 text-sm text-smoke">
              Menüdeki her üründen en az bir tane satıldı.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-line border border-line">
                {staleProducts.map((name) => (
                  <li key={name} className="truncate bg-char px-5 py-3 text-sm text-smoke">
                    {name}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-smoke/70">
                {currentLabel.toLowerCase()} içinde bu ürünlerden hiç sipariş gelmedi.
                Menüde durup yer kaplıyorlar.
              </p>
            </>
          )}
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* --- KDV --- */}
        <section>
          <h2 className="mb-4 font-display text-xl font-extrabold text-bone">
            KDV dökümü — {currentLabel}
          </h2>
          {report.vat.length === 0 ? (
            <p className="border border-line bg-char px-5 py-6 text-sm text-smoke">
              Bu dönemde kayıt yok.
            </p>
          ) : (
            <table className="w-full border border-line bg-char text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="tag px-4 py-3 text-smoke">Oran</th>
                  <th className="tag px-4 py-3 text-right text-smoke">Net</th>
                  <th className="tag px-4 py-3 text-right text-smoke">KDV</th>
                  <th className="tag px-4 py-3 text-right text-smoke">Brüt</th>
                </tr>
              </thead>
              <tbody>
                {report.vat.map((bucket) => (
                  <tr key={bucket.rate} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-3 tabular-nums text-bone">%{bucket.rate}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-smoke">
                      {formatCents(bucket.netCents)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-amber">
                      {formatCents(bucket.vatCents)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-bone">
                      {formatCents(bucket.grossCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-smoke/70">
            Döküm sipariş anında dondurulur; bu toplam kesilen belgelerin toplamıdır.
          </p>
        </section>

        {/* --- iptaller --- */}
        <section>
          <h2 className="mb-4 font-display text-xl font-extrabold text-bone">
            İptaller — {currentLabel}
          </h2>
          <div className="border border-line bg-char p-5">
            <p className="font-display text-2xl font-extrabold tabular-nums text-flame">
              {report.cancelledCount}{" "}
              <span className="font-body text-sm font-normal text-smoke">
                sipariş · {formatCents(report.cancelledValueCents)}
              </span>
            </p>

            {report.cancelled.length > 0 && (
              <ul className="mt-4 space-y-2">
                {report.cancelled.map((bucket, index) => (
                  <li key={index} className="flex items-baseline justify-between gap-4 text-sm">
                    <span className="text-smoke">
                      {adminCancelLabel(bucket.reason) ?? "Sebep girilmemiş"}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-bone">
                      {bucket.count} · {formatCents(bucket.valueCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <dl className="mt-5 space-y-1 border-t border-line pt-4 font-mono text-xs text-smoke">
              <div className="flex justify-between gap-4">
                <dt>İade edilen tutar</dt>
                <dd className="tabular-nums text-bone">{formatCents(report.refundedCents)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Ödenmeden düşen sipariş</dt>
                <dd className="tabular-nums text-bone">{report.expiredCount}</dd>
              </div>
            </dl>
          </div>

          {report.methods.length > 0 && (
            <>
              <h3 className="mb-3 mt-8 font-display font-bold text-bone">Ödeme yöntemleri</h3>
              <ul className="divide-y divide-line border border-line">
                {report.methods.map((method) => (
                  <li
                    key={method.method}
                    className="flex items-baseline justify-between gap-4 bg-char px-5 py-3 text-sm"
                  >
                    <span className="text-smoke">{method.method}</span>
                    <span className="font-mono tabular-nums text-bone">
                      {method.count} · {formatCents(method.revenueCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {/* --- Stripe köprüsü --- */}
      <section className="mt-10">
        <h2 className="mb-2 font-display text-xl font-extrabold text-bone">
          Ödemeler — {currentLabel}
        </h2>
        <p className="mb-4 text-sm text-smoke">
          İade ve hesaba geçiş Stripe&apos;ın işi; satırdaki bağlantı ödemeyi orada açar.
        </p>

        {recent.length === 0 ? (
          <p className="border border-line bg-char px-5 py-6 text-sm text-smoke">
            Henüz tamamlanmış ödeme yok.
          </p>
        ) : (
          <ul className="divide-y divide-line border border-line">
            {recent.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-4 bg-char px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="font-display font-bold text-bone">
                    {payment.order.orderNo}
                    <span className="tag ml-3 text-smoke">{payment.method ?? "—"}</span>
                  </p>
                  <p className="tag mt-1 text-smoke">
                    {payment.paidAt ? TIMESTAMP.format(payment.paidAt) : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-display font-extrabold tabular-nums text-amber">
                    {formatCents(payment.amountCents)}
                  </span>
                  <a
                    href={stripeSearchUrl(payment.providerRef)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="focus-ring tag border border-line px-3 py-2 text-smoke transition-colors hover:border-amber hover:text-amber"
                  >
                    STRIPE&apos;TA AÇ ↗
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/admin/orders"
          className="focus-ring tag border border-amber px-5 py-3 text-amber transition-colors hover:bg-amber hover:text-void"
        >
          SİPARİŞ PANOSU →
        </Link>
      </div>
    </div>
  );
}
