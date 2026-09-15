"use client";

import { useEffect, useRef, useState } from "react";
import type { CheckoutQuote } from "@/lib/orders/checkout";

/**
 * Ödeme adımının kendi fiyat teklifi.
 *
 * NEDEN SEPETİNKİ KULLANILMIYOR
 *
 * Sepet çekmecesi de `/api/menu/quote` çağırıyor, ama yalnızca satırlar,
 * teslim biçimi ve posta koduyla. Ödeme adımında üç şey daha var: kupon,
 * bahşiş ve ileri saat. Bunları sepet bağlamına taşımak, çekmecede hiç
 * görünmeyen üç durumu oraya eklemek olurdu — üstelik çekmece menü tarafının
 * bileşeni ve ödeme adımının ihtiyaçlarını taşımak zorunda değil.
 *
 * Değişmeyen kural aynen duruyor: **burada hiçbir tutar hesaplanmıyor.** Bu
 * kanca yalnızca istek atar ve sunucunun verdiği tutarları olduğu gibi döner.
 * Sipariş oluşturma da (`createOrderAction`) aynı `buildCheckoutQuote`
 * fonksiyonundan geçer; ekrandaki tutarla tahsil edilen tutar ayrışamaz.
 *
 * İSTEK SIRASI
 *
 * Yanıtlar sırasız dönebilir: kuponu yazıp hemen bahşişi değiştiren müşteride
 * eski isteğin cevabı sonra gelirse ekranda eski tutar kalırdı. Her isteğe bir
 * sıra numarası veriliyor ve yalnızca en sonuncusunun cevabı yazılıyor.
 */

export type PricingState = "idle" | "loading" | "ready" | "error";

export type QuoteInput = {
  lines: unknown[];
  lang: "tr" | "de";
  fulfillment: "DELIVERY" | "PICKUP";
  zip: string;
  couponCode: string;
  tipCents: number;
  /** ISO; "en kısa sürede"de boş. */
  requestedAt: string;
  /** Arttığında teklif, girdiler aynı olsa da yeniden istenir. */
  revision?: number;
};

export function useCheckoutQuote(input: QuoteInput, enabled: boolean) {
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [pricing, setPricing] = useState<PricingState>("idle");

  /** En son gönderilen isteğin sırası; geç gelen cevaplar yok sayılır. */
  const sequence = useRef(0);

  // Satır dizisi her oluşumda yeni bir referans; bağımlılığa referansı değil
  // **içeriğini** vermek gerekiyor, yoksa efekt sonsuz döner.
  const linesKey = JSON.stringify(input.lines);
  const { lang, fulfillment, zip, couponCode, tipCents, requestedAt, revision = 0 } = input;

  useEffect(() => {
    if (!enabled) return;

    const lines = JSON.parse(linesKey) as unknown[];
    if (lines.length === 0) {
      setQuote(null);
      setPricing("idle");
      return;
    }

    const ticket = ++sequence.current;
    const controller = new AbortController();
    setPricing("loading");

    fetch("/api/menu/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        lines,
        lang,
        fulfillment,
        zip,
        couponCode,
        tipCents,
        // Boş dize gönderilmez: sunucu tarafında "en kısa sürede" demek
        // alanın hiç olmaması.
        ...(requestedAt ? { requestedAt } : {}),
      }),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("quote"))))
      .then((data: CheckoutQuote) => {
        if (ticket !== sequence.current) return;
        setQuote(data);
        setPricing("ready");
      })
      .catch(() => {
        if (controller.signal.aborted || ticket !== sequence.current) return;
        // Tutarlar okunamadı: sipariş düğmesi kapanır ve sebebi ekranda
        // söylenir. Eski tutarla devam etmek, yanlış tutar göstermek olurdu.
        setPricing("error");
      });

    return () => controller.abort();
  }, [enabled, linesKey, lang, fulfillment, zip, couponCode, tipCents, requestedAt, revision]);

  return { quote, pricing };
}
