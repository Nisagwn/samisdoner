"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";
import { normalizeCouponCode, type CouponRejection } from "@/lib/orders/coupon";
import { Button, Field, TextInput } from "@/components/ui";
import type { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * Gutscheincode alanı.
 *
 * Referans (Lieferando): kod ödeme seçeneklerinin yanında giriliyor, "Einlösen"
 * ile uygulanıyor, geçersizse alanın altında gerekçesiyle birlikte söyleniyor.
 * Aynı akış burada da geçerli.
 *
 * DOĞRULAMA AYRI BİR UÇTA DEĞİL
 *
 * Kod, fiyat teklifi ucuna (`/api/menu/quote`) gönderilir ve cevabı oradan
 * okunur: indirim tutarı ya da ret sebebi. Ayrı bir "kupon doğrula" ucu,
 * kuponun geçerliliğini iki farklı yerden sormak olurdu — sepet 20 €'ya
 * düştüğünde asgari tutar kuralının yalnız birinde güncellenmesi an
 * meselesiydi. Tek uç, tek cevap.
 *
 * Bu yüzden bileşen bir tutar hesaplamaz ve bir istek atmaz: kodu yukarı
 * bildirir, sonucu aşağı alır.
 */
export function CouponField({
  appliedCode,
  discountCents,
  rejection,
  checking,
  onApply,
  onRemove,
  t,
}: {
  /** Sunucunun kabul ettiği kod; kabul edilmediyse boş. */
  appliedCode: string;
  discountCents: number;
  /** Kod girildi ama kabul edilmediyse sebebi. */
  rejection: CouponRejection | null;
  checking: boolean;
  onApply: (code: string) => void;
  onRemove: () => void;
  t: ReturnType<typeof useLanguage>["t"];
}) {
  const [draft, setDraft] = useState("");
  const f = t.orderFlow;
  const applied = appliedCode !== "" && discountCents > 0;

  if (applied) {
    return (
      <div className="flex items-center justify-between gap-3 border border-herb bg-herb/10 px-4 py-3">
        <span className="min-w-0 text-sm text-herb">
          <span className="font-display font-extrabold">
            {f.couponApplied.replace("{code}", appliedCode)}
          </span>
          <span className="ml-2 font-mono text-xs">−{formatCents(discountCents)}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            setDraft("");
            onRemove();
          }}
          className="focus-ring shrink-0 text-xs text-smoke underline transition-colors hover:text-amber"
        >
          {f.couponRemove}
        </button>
      </div>
    );
  }

  const submit = () => {
    const code = normalizeCouponCode(draft);
    if (code) onApply(code);
  };

  return (
    <section aria-labelledby="coupon-title" className="space-y-2">
      <h3 id="coupon-title" className="tag text-smoke">
        {f.couponTitle}
      </h3>

      <Field label={f.couponLabel} htmlFor="coupon">
        <div className="flex gap-2">
          <TextInput
            id="coupon"
            value={draft}
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={40}
            placeholder={f.couponPlaceholder}
            invalid={rejection !== null}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              /*
               * Enter kodu uygular ama formu göndermez. Ödeme sayfasında
               * gerçek bir `<form>` yok; yine de alışkanlık gereği Enter'a
               * basan müşteri kuponun uygulanmasını bekler.
               */
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            onClick={submit}
            disabled={checking || normalizeCouponCode(draft) === ""}
            className="shrink-0 text-xs"
          >
            {checking ? f.couponChecking : f.couponApply}
          </Button>
        </div>
      </Field>

      {rejection && (
        <p role="alert" className="text-sm text-flame">
          {describeRejection(rejection, t)}
        </p>
      )}
    </section>
  );
}

/**
 * Ret sebebini müşterinin dilinde bir cümleye çevirir.
 *
 * Her sebep **ne yapılacağını** söyleyebilecek kadar veri taşıyor: "geçersiz
 * kod" demek yerine "bu kupon 20 €'dan itibaren geçerli" demek, sepete bir
 * ürün daha eklemeyi mümkün kılar.
 */
export function describeRejection(
  rejection: CouponRejection,
  t: ReturnType<typeof useLanguage>["t"]
): string {
  const f = t.orderFlow;
  switch (rejection.code) {
    case "coupon_unknown":
      return f.couponUnknown;
    case "coupon_inactive":
      return f.couponInactive;
    case "coupon_not_started":
      return f.couponNotStarted;
    case "coupon_expired":
      return f.couponExpired;
    case "coupon_exhausted":
      return f.couponExhausted;
    case "coupon_wrong_fulfillment":
      return rejection.fulfillment === "DELIVERY" ? f.couponWrongDelivery : f.couponWrongPickup;
    case "coupon_below_minimum":
      return f.couponBelowMinimum.replace("{amount}", formatCents(rejection.minOrderCents));
    case "coupon_no_items":
      return f.couponNoItems;
    case "coupon_too_many_attempts":
      // Kodun kendisi hakkında hiçbir şey söylenmez — sınırın amacı bu.
      // Dakikaya yukarı yuvarlanır: "0 dakika sonra" diye bir bekleyiş yok.
      return f.couponTooManyAttempts.replace(
        "{minutes}",
        String(Math.max(1, Math.ceil(rejection.retryAfterSeconds / 60)))
      );
  }
}
