"use client";

import { formatCents } from "@/lib/money";
import type { CheckoutQuote } from "@/lib/orders/checkout";
import type { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * Sipariş özeti.
 *
 * § 312j Abs. 2 BGB: siparişin temel bilgileri — ne alındığı, toplam fiyat,
 * teslimat ücreti — sipariş düğmesinin **hemen üstünde**, araya başka içerik
 * girmeden bulunmak zorunda. Mobilde bu blok butonun üzerinde açılır; masaüstünde
 * sağ sütunda butonla aynı kartın içindedir. Her iki düzende de arada yalnızca
 * yasal metin vardır.
 *
 * Tutarların hiçbiri burada hesaplanmıyor — **tek bir toplama işlemi bile yok.**
 * Hepsi sunucudan gelen `quote` alanları; ekrandaki tutarla tahsil edilen
 * tutarın ayrışması mümkün değil.
 */
export function SummaryPanel({
  quote,
  t,
}: {
  quote: CheckoutQuote;
  t: ReturnType<typeof useLanguage>["t"];
}) {
  return (
    <div className="border border-line bg-void/40 px-4 py-4">
      <p className="tag mb-3 text-smoke">{t.cart.summaryTitle}</p>

      <ul className="mb-3 space-y-1.5">
        {quote.lines
          .filter((line) => !line.unavailable)
          .map((line) => (
            <li key={line.key} className="flex justify-between gap-3 text-xs">
              <span className="min-w-0 text-bone">
                <span className="font-mono text-amber">{line.qty}×</span> {line.label}
              </span>
              <span className="shrink-0 font-mono text-smoke tabular-nums">
                {formatCents(line.lineCents)}
              </span>
            </li>
          ))}
      </ul>

      <dl className="space-y-1 border-t border-line pt-3 text-xs text-smoke">
        <SummaryRow label={t.cart.summarySubtotal} value={formatCents(quote.subtotalCents)} />

        {/* Servis ücreti panelden yönetilir; 0 ve eşiksizse satır hiç çıkmaz. */}
        {(quote.serviceFeeCents > 0 || quote.freeServiceOverCents > 0) && (
          <SummaryRow
            label={t.cart.deliveryFee}
            value={
              quote.serviceFeeCents === 0
                ? t.cart.freeDelivery
                : formatCents(quote.serviceFeeCents)
            }
          />
        )}

        {/*
          PAngV § 3: kurye ücreti sipariş onayından ÖNCE açıkça görünmeli.
          Bölge seçilmeden ücret bilinmez ve tahmini bir tutar göstermek
          yanıltıcı olurdu; bu yüzden satır ancak posta kodu seçilince çıkar —
          ve seçilmeden sipariş düğmesi zaten basılamaz.
        */}
        {quote.zone && (
          <SummaryRow
            label={t.cart.deliveryCost}
            value={
              quote.deliveryFeeCents === 0
                ? t.cart.freeDelivery
                : formatCents(quote.deliveryFeeCents)
            }
          />
        )}

        {/*
          Her kampanya ayrı satırda, eksi işaretle ve ayırt edici renkle.
          Kampanya adı ve varsa kodu etiketin içinde: müşteri "ayın ürünü mü
          geçti, kodum mu" sorusunu özete bakarak cevaplayabilmeli.
        */}
        {quote.campaigns.map((campaign) => (
          <SummaryRow
            key={campaign.id}
            label={[campaign.title || t.orderFlow.summaryDiscount, campaign.code]
              .filter(Boolean)
              .join(" · ")}
            value={`−${formatCents(campaign.amountCents)}`}
            tone="good"
          />
        ))}

        {/*
          Bahşiş ayrı satır ve toplamın içinde; KDV dökümünün dışında
          (Abschn. 10.1 Abs. 5 UStAE — bkz. lib/orders/tip.ts). Aşağıdaki KDV
          notunun bahşişi kapsamaması bu yüzden doğru.
        */}
        {quote.tipCents > 0 && (
          <SummaryRow label={t.orderFlow.summaryTip} value={formatCents(quote.tipCents)} />
        )}
      </dl>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className="tag text-smoke">{t.cart.total}</span>
        <span className="font-display text-2xl font-extrabold text-amber tabular-nums">
          {formatCents(quote.totalCents)}
        </span>
      </div>

      {/* KDV dökümü brütten ayrıştırılmıştır (PAngV § 3: fiyatlar KDV dahil). */}
      <p className="mt-2 text-[10px] leading-relaxed text-smoke/60">
        {t.cart.summaryVatIncluded}
        {quote.vatBreakdown.length > 0 && (
          <>
            {" "}
            <span className="font-mono">
              {quote.vatBreakdown
                .map((bucket) => `${bucket.rate}% = ${formatCents(bucket.vatCents)}`)
                .join(" · ")}
            </span>
          </>
        )}
      </p>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  /** "good": müşterinin lehine olan satır (indirim). */
  tone?: "good";
}) {
  return (
    <div className={`flex justify-between gap-3 ${tone === "good" ? "text-herb" : ""}`}>
      <dt className="min-w-0 truncate">{label}</dt>
      <dd className="shrink-0 font-mono tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Minimum sepet tutarına kalan yol.
 *
 * Sadece "15 € altında sipariş alamıyoruz" demek müşteriyi sepetten kaçırır;
 * ne kadar kaldığını göstermek bir ürün daha eklemeyi kolaylaştırır. Çubuk
 * yalnızca gösterimdir, tutarlar sunucudan gelir.
 */
export function MinimumProgress({
  subtotalCents,
  minOrderCents,
  label,
}: {
  subtotalCents: number;
  minOrderCents: number;
  label: string;
}) {
  const percent =
    minOrderCents > 0 ? Math.min(100, Math.round((subtotalCents / minOrderCents) * 100)) : 0;

  return (
    <div>
      <div
        className="h-1.5 w-full overflow-hidden bg-line"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="h-full bg-flame-gradient transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-flame">{label}</p>
    </div>
  );
}
