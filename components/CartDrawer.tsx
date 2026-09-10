"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { lineKey, useCart } from "@/lib/cart";
import { formatCents } from "@/lib/money";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Button, QtyStepper } from "@/components/ui";
import { useScrollLock } from "@/lib/useScrollLock";
import type { MenuStatus } from "@/app/api/menu/status/route";

/**
 * Sepet çekmecesi — yalnızca sepet.
 *
 * Bu dosya eskiden ödeme akışının tamamını taşıyordu: adres formu, teslimat
 * bölgesi seçimi, yasal metin ve sipariş düğmesi 420 piksellik sabit genişlikte
 * bir çekmecenin içindeydi ve dosyada tek bir duyarlı sınıf yoktu. Siparişlerin
 * çoğu telefondan geldiği için form artık tam sayfada: `/checkout`.
 *
 * Çekmeceye kalan iş, adının söylediği şey: ne aldığını göster, adedi
 * değiştirtir, ara toplamı söyle, ödemeye gönder.
 *
 * Tutar hesaplanmaz — **tek bir toplama işlemi bile yok.** Satır fiyatı ve ara
 * toplam `/api/menu/quote` yanıtından okunur.
 *
 * Genel toplam burada gösterilmez, bilinçli olarak: teslimat ücreti posta kodu
 * seçilmeden bilinmez, seçim ise ödeme sayfasında yapılır. Eksik bir toplamı
 * "toplam" diye göstermek, ödeme adımında tutarın büyümesi demekti.
 */
export default function CartDrawer() {
  const { t } = useLanguage();
  const { lines, count, quote, pricing, isOpen, setQty, remove, closeCart } = useCart();
  const router = useRouter();

  const [status, setStatus] = useState<MenuStatus | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /** Satır anahtarına göre sunucudan gelen fiyatlar. */
  const priced = useMemo(
    () => new Map((quote?.lines ?? []).map((l) => [l.key, l] as const)),
    [quote]
  );

  const hasUnavailable = quote?.hasUnavailable ?? false;
  const totalsReady = quote !== null && pricing !== "error";

  // Çekmece açıkken arkadaki sayfa kaymaz; bkz. lib/useScrollLock.ts.
  useScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCart();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, closeCart]);

  /*
   * İşletme durumu çekmece açıldığında yüklenir.
   *
   * Sepet boşken de gerekli: "şu an kapalıyız" uyarısını müşteri sepeti
   * doldurduktan sonra değil, en başta görmeli. Sayfa yüklenirken çekmek ise
   * hiç sipariş vermeyecek ziyaretçi için bedava bir istek olurdu.
   */
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();

    fetch("/api/menu/status", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("status"))))
      .then((data: MenuStatus) => setStatus(data))
      .catch(() => {
        // Durum okunamadı: uyarı gösteremeyiz ama akışı engellemeyiz;
        // kesin karar zaten sunucuda, sipariş oluşturulurken veriliyor.
      });

    return () => controller.abort();
  }, [isOpen]);

  /** Sipariş alınamıyorsa sebebini söyleyen üst bant; alınabiliyorsa null. */
  const blockingNotice = (() => {
    if (status && !status.orderingEnabled) return t.cart.statusPaused;
    if (status && !status.open) return t.cart.statusClosed;
    return null;
  })();

  const goToCheckout = () => {
    closeCart();
    router.push("/checkout");
  };

  return (
    <>
      <div
        onClick={closeCart}
        aria-hidden
        className={`fixed inset-0 z-[70] bg-void/70 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.cart.title}
        /* duration-300: Tailwind ölçeğinde 400 yok — eski `duration-400`
           hiçbir sınıf üretmiyordu ve çekmece 150 ms'de kayıyordu. */
        className={`ember-surface fixed right-0 top-0 z-[71] flex h-[100dvh] w-full max-w-[420px] flex-col border-l border-line shadow-[-28px_0_80px_rgba(0,0,0,0.45)] transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <p className="tag text-flame">{t.cart.title}</p>
            <p className="truncate font-display text-xl font-extrabold text-bone">
              {t.cart.heading.replace("{count}", String(count))}
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={closeCart}
            aria-label={t.cart.closeBtn}
            className="focus-ring h-11 w-11 shrink-0 border border-line text-smoke transition-colors hover:border-amber hover:text-amber"
          >
            ✕
          </button>
        </div>

        {blockingNotice && (
          <p
            role="alert"
            className="shrink-0 border-b border-flame/40 bg-flame/10 px-6 py-3 text-sm text-flame"
          >
            {blockingNotice}
          </p>
        )}

        {/*
          Kaydırılabilir tek alan burasıdır.

          `min-h-0` esnek düzende şart: onsuz bu kutu içeriği kadar büyüyüp
          çekmecenin dışına taşıyor, alttaki toplam şeridi ekrandan çıkıyor ve
          liste hiç kaymıyordu. `overscroll-contain` ise listenin sonuna
          gelindiğinde hareketin arkadaki sayfaya atlamasını keser.
        */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
          {lines.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-smoke">{t.cart.empty}</p>
              {/* Boş sepetin tek çıkışı menüdür. Yanında bir de "kendi
                  dönerini kur" bağlantısı vardı; o bölüm kaldırıldı ve tek
                  düğme kaldı. */}
              <a
                href="/speisekarte"
                onClick={closeCart}
                className="focus-ring tag inline-flex min-h-[44px] items-center border border-amber bg-amber/10 px-4 text-amber transition-colors hover:bg-amber hover:text-void"
              >
                {t.nav.menu} →
              </a>
            </div>
          ) : (
            <ul className="space-y-4">
              {lines.map((line) => {
                const key = lineKey(line);
                const info = priced.get(key);
                return (
                  <li
                    key={key}
                    className={`border p-4 ${
                      info?.unavailable ? "border-flame/50 bg-flame/5" : "border-line bg-void/35"
                    }`}
                  >
                    <div className="mb-1 flex justify-between gap-3">
                      <p className="min-w-0 font-display text-sm font-semibold text-bone">
                        {info?.label ?? "…"}
                      </p>
                      <p className="shrink-0 font-mono text-sm text-bone tabular-nums">
                        {info ? formatCents(info.lineCents) : "—"}
                      </p>
                    </div>
                    {info?.detail && <p className="mb-3 text-xs text-smoke">{info.detail}</p>}
                    {info?.unavailable && (
                      <p className="tag mb-3 text-flame">{t.cart.unavailableItem}</p>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <QtyStepper
                        qty={line.qty}
                        onChange={(next) => setQty(key, next)}
                        labels={{
                          decrease: t.cart.decreaseQty,
                          increase: t.cart.increaseQty,
                        }}
                      />
                      <button
                        onClick={() => remove(key)}
                        className="focus-ring tag min-h-[44px] px-2 text-smoke transition-colors hover:text-flame"
                      >
                        {t.cart.removeBtn}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {lines.length > 0 && (
          <div className="shrink-0 border-t border-line px-6 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {pricing === "error" && (
              <p role="alert" className="mb-3 text-xs text-flame">
                {t.cart.priceError}
              </p>
            )}
            {hasUnavailable && (
              <p role="alert" className="mb-3 text-xs text-flame">
                {t.cart.unavailableHint}
              </p>
            )}

            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="tag text-smoke">{t.cart.subtotal}</span>
              <span className="font-display text-2xl font-extrabold text-amber tabular-nums">
                {totalsReady ? formatCents(quote.subtotalCents) : "—"}
              </span>
            </div>

            {/* Ücretler ödeme sayfasında, posta kodu seçildikten sonra
                netleşir. Burada söylenmezse müşteri tutarın orada büyümesini
                sürpriz olarak yaşar. */}
            <p className="mb-4 text-[11px] leading-relaxed text-smoke/60">
              {t.cart.summaryVatIncluded}
            </p>

            <Button
              variant="primary"
              onClick={goToCheckout}
              disabled={!totalsReady || quote.subtotalCents <= 0 || hasUnavailable}
              className="w-full text-xs tracking-wider"
            >
              {t.cart.toCheckoutBtn}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
