"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { formatCents } from "@/lib/money";
import type { PendingReview } from "@/lib/reviews/repository";
import { accountTexts } from "./texts";
import { PanelHeader } from "./fields";

/**
 * Sipariş değerlendirme ekranı.
 *
 * Yalnızca **değerlendirilebilir** siparişler listelenir — sunucu zaten
 * pencerenin dışındakileri ayıklıyor. "Bu siparişi değerlendiremezsiniz"
 * diyen gri bir satır, kullanıcıya sebepsiz bir hayal kırıklığından başka bir
 * şey vermezdi.
 *
 * Yıldız seçimi radyo düğmeleriyle kurulu, `div`+`onClick` ile değil: klavyeyle
 * ok tuşlarıyla gezilebiliyor, ekran okuyucu "5 üzerinden 4" diyebiliyor ve
 * form `required` ile tarayıcı tarafından doğrulanıyor. Görsel yıldız, radyo
 * düğmesinin etiketidir — düğmenin kendisi görünmez ama yerinde durur.
 */

export type OwnReview = {
  orderNo: string;
  foodRating: number;
  deliveryRating: number | null;
  comment: string;
  reply: string;
  published: boolean;
  createdAt: string;
};

export default function ReviewsPanel({
  pending,
  own,
}: {
  pending: PendingReview[];
  own: OwnReview[];
}) {
  const { lang } = useLanguage();
  const de = lang !== "tr";
  const t = accountTexts(de);
  const [rows, setRows] = useState(pending);
  const [mine, setMine] = useState(own);

  function afterSubmit(order: PendingReview, review: OwnReview) {
    // Yazılan sipariş bekleyenlerden düşer, yazdıklarıma eklenir: sayfayı
    // yeniden yüklemeden de doğru olan tek hâl bu.
    setRows((list) => list.filter((row) => row.orderNo !== order.orderNo));
    setMine((list) => [review, ...list]);
  }

  return (
    <section>
      <PanelHeader title={t.reviewsTitle} lead={t.reviewsLead} />

      {rows.length === 0 ? (
        <p className="border border-line bg-char px-4 py-8 text-center text-sm text-smoke">
          {t.reviewsNonePending}
        </p>
      ) : (
        <ul className="space-y-5">
          {rows.map((order) => (
            <ReviewForm
              key={order.orderNo}
              order={order}
              de={de}
              onDone={(review) => afterSubmit(order, review)}
            />
          ))}
        </ul>
      )}

      {mine.length > 0 && (
        <div className="mt-12">
          <h3 className="tag mb-3 text-smoke">{t.reviewsMineTitle}</h3>
          <ul className="space-y-4">
            {mine.map((review) => (
              <li key={review.orderNo} className="border border-line bg-char p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Stars value={review.foodRating} />
                  <span className="tag text-smoke/70">{review.orderNo}</span>
                </div>
                {review.comment && (
                  <p className="mt-3 text-sm leading-relaxed text-smoke">{review.comment}</p>
                )}
                {review.reply && (
                  <div className="mt-4 border-l-2 border-amber bg-void/50 py-3 pl-4">
                    <p className="tag mb-1.5 text-amber">{t.reviewsReplyLabel}</p>
                    <p className="text-sm leading-relaxed text-bone">{review.reply}</p>
                  </div>
                )}
                {!review.published && (
                  <p className="mt-3 text-xs text-smoke/70">{t.reviewsHidden}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ form */

function ReviewForm({
  order,
  de,
  onDone,
}: {
  order: PendingReview;
  de: boolean;
  onDone: (review: OwnReview) => void;
}) {
  const t = accountTexts(de);
  const [food, setFood] = useState(0);
  const [delivery, setDelivery] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closes = new Intl.DateTimeFormat(de ? "de-DE" : "tr-TR", {
    timeZone: "Europe/Berlin",
    dateStyle: "long",
  }).format(new Date(order.closesAt));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (food === 0) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/account/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNo: order.orderNo,
          foodRating: food,
          // Gel-al siparişte hiç gönderilmez; sunucu da bu alanı yok sayar.
          ...(order.asksDelivery && delivery > 0 ? { deliveryRating: delivery } : {}),
          comment,
        }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(data?.error ?? t.reviewsError);
        return;
      }
      onDone({
        orderNo: order.orderNo,
        foodRating: food,
        deliveryRating: order.asksDelivery && delivery > 0 ? delivery : null,
        comment: comment.trim(),
        reply: "",
        published: true,
        createdAt: new Date().toISOString(),
      });
    } catch {
      setError(t.reviewsError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border border-line bg-char p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line/60 pb-4">
        <div className="min-w-0">
          <p className="tag text-smoke/70">{order.orderNo}</p>
          <p className="mt-1 truncate text-sm text-bone">{order.summary}</p>
        </div>
        <span className="tag shrink-0 tabular-nums text-smoke">
          {formatCents(order.totalCents)}
        </span>
      </div>

      <form onSubmit={submit} className="mt-5 space-y-5">
        <RatingGroup
          name={`food-${order.orderNo}`}
          label={t.reviewsFoodLabel}
          value={food}
          onChange={setFood}
          de={de}
        />

        {order.asksDelivery && (
          <RatingGroup
            name={`delivery-${order.orderNo}`}
            label={t.reviewsDeliveryLabel}
            value={delivery}
            onChange={setDelivery}
            de={de}
            optional={t.reviewsOptional}
          />
        )}

        <label className="block">
          <span className="tag mb-2 block text-smoke">
            {t.reviewsCommentLabel}{" "}
            <span className="normal-case text-smoke/60">({t.reviewsOptional})</span>
          </span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={800}
            rows={3}
            placeholder={t.reviewsCommentPlaceholder}
            className="focus-ring w-full resize-y border border-line bg-void px-3.5 py-2.5 text-sm text-bone placeholder:text-smoke/50 focus:border-amber"
          />
        </label>

        {error && (
          <p role="alert" className="border border-flame/50 bg-flame/10 px-4 py-3 text-sm text-flame">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={busy || food === 0}
            className="focus-ring tag min-h-[48px] border border-amber bg-amber px-6 py-3 font-semibold text-void transition-colors hover:bg-bone hover:border-bone disabled:opacity-40 disabled:pointer-events-none"
          >
            {busy ? t.reviewsSending : t.reviewsSubmit}
          </button>
          <span className="text-xs text-smoke/70">
            {t.reviewsClosesAt} {closes}
          </span>
        </div>
      </form>
    </li>
  );
}

/* -------------------------------------------------------------- yıldızlar */

function RatingGroup({
  name,
  label,
  value,
  onChange,
  de,
  optional,
}: {
  name: string;
  label: string;
  value: number;
  onChange: (next: number) => void;
  de: boolean;
  optional?: string;
}) {
  return (
    <fieldset>
      <legend className="tag mb-2 block text-smoke">
        {label}
        {optional && <span className="ml-1 normal-case text-smoke/60">({optional})</span>}
      </legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <label
            key={star}
            className="focus-within:ring-2 focus-within:ring-amber cursor-pointer"
            title={`${star}/5`}
          >
            <input
              type="radio"
              name={name}
              value={star}
              checked={value === star}
              onChange={() => onChange(star)}
              className="sr-only"
            />
            <span
              aria-label={de ? `${star} von 5 Sternen` : `5 üzerinden ${star} yıldız`}
              /* Dokunma hedefi 44px: yıldızlar telefonda seçiliyor ve küçük
                 hedeflerde yanlış yıldıza basmak kuralın kendisinden daha çok
                 hataya yol açar. */
              className={`flex h-11 w-11 items-center justify-center text-2xl transition-colors ${
                star <= value ? "text-amber" : "text-smoke/30 hover:text-amber/60"
              }`}
            >
              ★
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="font-display text-lg tracking-wider text-amber">
      {"★".repeat(value)}
      <span className="text-smoke/30">{"★".repeat(5 - value)}</span>
    </span>
  );
}
