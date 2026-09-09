"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { CartLineDraft } from "@/lib/cart";
import { useCart } from "@/lib/cart";
import { formatCents } from "@/lib/money";
import { accountTexts, type AccountTexts } from "./texts";
import { PanelHeader } from "./fields";

/**
 * Sipariş geçmişi.
 *
 * Bileşen hiçbir tutar hesaplamaz: geçmiş siparişlerin tutarları sipariş
 * anındaki dondurulmuş değerlerdir ve sunucudan öyle gelir.
 *
 * Aktif ve geçmiş siparişler ayrı listelenir. Tek bir liste hâlinde "yolda"
 * olan sipariş üç ay önceki bir siparişle aynı görünürdü; oysa müşterinin bu
 * sayfayı açma sebebi neredeyse her zaman ilkidir.
 */

export type AccountOrder = {
  orderNo: string;
  createdAt: string;
  statusLabel: string;
  /** Durumun kendisi yetmediğinde açıklaması; bkz. lib/orders/status.ts. */
  statusHint: string | null;
  /**
   * Siparişin akışı sürüyor mu (müşteri gözünden).
   *
   * Sunucuda `isTerminal` ile türetilir. Burada durum etiketinden tahmin
   * edilmez: etiket çeviri metnidir, kural değil — dil değişince kırılırdı.
   */
  active: boolean;
  /**
   * İptal/ret sebebi — **sunucuda müşterinin dilinde cümleye çevrilmiş**
   * hâliyle gelir (bkz. lib/orders/cancelReasons.ts). İptal edilmemiş
   * siparişte null.
   */
  cancelReason: string | null;
  totalCents: number;
  /** İmzalı takip bağlantısı; sunucuda üretilir. */
  trackingUrl: string;
  lines: { label: string; detail: string; qty: number; lineCents: number }[];
  /** Siparişi sepete geri koymak için gereken tarif (bkz. `lib/orders/reorder`). */
  reorder: CartLineDraft[];
};

export default function OrdersPanel({ orders }: { orders: AccountOrder[] }) {
  const { lang } = useLanguage();
  const t = accountTexts(lang !== "tr");
  const { add, openCart } = useCart();

  function reorder(order: AccountOrder) {
    for (const line of order.reorder) add(line);
    openCart();
  }

  // Sunucu siparişleri zaten yeniden eskiye sıralı verir; bölmek sırayı bozmaz.
  const activeOrders = orders.filter((order) => order.active);
  const pastOrders = orders.filter((order) => !order.active);

  return (
    <section>
      <PanelHeader title={t.ordersTitle} lead={t.ordersLead} />

      {orders.length === 0 ? (
        <p className="border border-line bg-char px-4 py-8 text-center text-sm text-smoke">
          {t.noOrders}
        </p>
      ) : (
        <div className="space-y-10">
          <OrderGroup
            title={t.activeTitle}
            orders={activeOrders}
            emptyLabel={t.noActive}
            live
            t={t}
            onReorder={reorder}
          />
          {pastOrders.length > 0 && (
            <OrderGroup title={t.pastTitle} orders={pastOrders} t={t} onReorder={reorder} />
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Tek bir sipariş grubu (aktif ya da geçmiş).
 *
 * `live` yalnızca görünümü değiştirir: aktif grup kenarlık ve yanıp sönen
 * noktayla öne çıkar. Hangi siparişin aktif olduğu kararı sunucudadır.
 */
function OrderGroup({
  title,
  orders,
  emptyLabel,
  live,
  t,
  onReorder,
}: {
  title: string;
  orders: AccountOrder[];
  emptyLabel?: string;
  live?: boolean;
  t: AccountTexts;
  onReorder: (order: AccountOrder) => void;
}) {
  return (
    <div>
      <h3 className="tag mb-3 flex items-center gap-2 text-smoke">
        {live && (
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-flame"
            aria-hidden
          />
        )}
        {title}
      </h3>

      {orders.length === 0 ? (
        <p className="border border-dashed border-line px-4 py-6 text-center text-sm text-smoke/70">
          {emptyLabel}
        </p>
      ) : (
        <ul className="space-y-4">
          {orders.map((order) => (
            <OrderCard
              key={order.orderNo}
              order={order}
              live={live}
              t={t}
              onReorder={onReorder}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function OrderCard({
  order,
  live,
  t,
  onReorder,
}: {
  order: AccountOrder;
  live?: boolean;
  t: AccountTexts;
  onReorder: (order: AccountOrder) => void;
}) {
  return (
    <li className={`border bg-char p-4 ${live ? "border-amber/60" : "border-line"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="font-mono text-sm text-bone">{order.orderNo}</span>
        <span className="font-mono text-sm tabular-nums text-amber">
          {formatCents(order.totalCents)}
        </span>
      </div>
      <p className="mt-1 text-xs text-smoke">
        {order.createdAt} ·{" "}
        <span className={live ? "text-amber" : undefined}>{order.statusLabel}</span>
      </p>

      {/* Süresi dolan sipariş için "param gitti mi?" sorusu burada, listede
          cevaplanır — müşteri bunun için takip bağlantısını açmak zorunda
          kalmamalı. Metin iptal sebebiyle aynı biçimde ama farklı tonda:
          bu bir ret değil, kendiliğinden kapanmış bir sipariş. */}
      {order.statusHint && (
        <p className="mt-3 border-l-2 border-line bg-void px-3 py-2 text-xs leading-relaxed text-smoke">
          {order.statusHint}
        </p>
      )}

      {/*
        İptal sebebi.

        Müşterinin bu satırı görmek için takip bağlantısını açması gerekmemeli:
        "neden iptal edildi?" sorusu listede sorulur, orada cevaplanır.
      */}
      {order.cancelReason && (
        <p className="mt-3 border-l-2 border-flame bg-void px-3 py-2 text-xs leading-relaxed text-smoke">
          <span className="text-flame">{t.cancelledReason}:</span> {order.cancelReason}
        </p>
      )}

      <ul className="mt-3 space-y-0.5">
        {order.lines.map((line, i) => (
          <li key={i} className="text-xs text-smoke">
            <span className="font-mono text-amber">{line.qty}×</span> {line.label}
            {line.detail && <span className="text-smoke/60"> — {line.detail}</span>}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-3">
        {/* Aktif siparişte asıl iş takip etmektir; geçmişte tekrar sipariş. */}
        <Link
          href={order.trackingUrl}
          className={
            live
              ? "focus-ring tag border border-amber px-3 py-1.5 text-amber transition-colors hover:bg-amber hover:text-void"
              : "focus-ring tag border border-line px-3 py-1.5 text-smoke transition-colors hover:border-amber hover:text-amber"
          }
        >
          {t.track}
        </Link>
        {order.reorder.length > 0 && (
          <button
            onClick={() => onReorder(order)}
            className={
              live
                ? "focus-ring tag border border-line px-3 py-1.5 text-smoke transition-colors hover:border-amber hover:text-amber"
                : "focus-ring tag border border-amber px-3 py-1.5 text-amber transition-colors hover:bg-amber hover:text-void"
            }
          >
            {t.again}
          </button>
        )}
      </div>
    </li>
  );
}
