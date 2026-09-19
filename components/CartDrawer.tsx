"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { lineKey, useCart, type CartLine } from "@/lib/cart";
import { formatCents } from "@/lib/money";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Button, QtyStepper } from "@/components/ui";
import { useScrollLock } from "@/lib/useScrollLock";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { thresholdProgress } from "@/lib/menu/progress";
import ProductDialog, { type ProductDraft } from "@/components/ProductDialog";
import type { MenuStatus } from "@/app/api/menu/status/route";
import type { MenuItem } from "@/data/speisekarte";
import type { MenuItemsResponse } from "@/app/api/menu/items/route";

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
  const {
    lines,
    count,
    quote,
    pricing,
    isOpen,
    fulfillment,
    setFulfillment,
    setQty,
    remove,
    replace,
    add,
    lastRemoved,
    undoRemove,
    dismissUndo,
    closeCart,
  } = useCart();
  const router = useRouter();

  const [status, setStatus] = useState<MenuStatus | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  /** Düzenlenmekte olan satır ve onun ürün tarifi; ikisi birlikte gelir. */
  const [editing, setEditing] = useState<{ line: CartLine; item: MenuItem } | null>(null);
  /** Çapraz satış önerileri; sepet değiştikçe tazelenir. */
  const [suggestions, setSuggestions] = useState<MenuItem[]>([]);

  /** Satır anahtarına göre sunucudan gelen fiyatlar. */
  const priced = useMemo(
    () => new Map((quote?.lines ?? []).map((l) => [l.key, l] as const)),
    [quote]
  );

  const hasUnavailable = quote?.hasUnavailable ?? false;
  const totalsReady = quote !== null && pricing !== "error";

  /*
   * Satır adları, satır sepetten çıktıktan sonra da lazım.
   *
   * "Geri al" şeridi silinen satırı adıyla anmalı ("„Döner“ entfernt"), ama o
   * satır artık ne sepette ne de teklifte. Ad tek kaynaktan — sunucunun
   * fiyatladığı satırdan — geliyor, dolayısıyla burada biriktiriliyor;
   * istemcide ikinci bir ad üretmek, dil değiştiğinde ikisinin ayrışması
   * demekti.
   */
  const labels = useRef(new Map<string, string>());
  useEffect(() => {
    for (const line of quote?.lines ?? []) labels.current.set(line.key, line.label);
  }, [quote]);

  // Çekmece açıkken arkadaki sayfa kaymaz; bkz. lib/useScrollLock.ts.
  useScrollLock(isOpen);

  // Açılınca odak içeri alınır: kapatma düğmesi, çekmecenin ilk durağı.
  useEffect(() => {
    if (!isOpen) return;
    closeRef.current?.focus();
  }, [isOpen]);

  /* Escape kapatır, Tab çekmecenin içinde döner; bkz. lib/useFocusTrap.ts.
     Daha önce yalnızca Escape dinleniyordu: `aria-modal="true"` yazılı olduğu
     hâlde Tab odağı arkadaki menüye taşıyordu. */
  useFocusTrap(isOpen, drawerRef, closeCart);

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

  /*
   * Çapraz satış.
   *
   * Yalnızca sepette bir şey varken ve çekmece açıkken çekilir: boş sepete
   * "yanına ne alırsın" sormak anlamsız, kapalı çekmeceye öneri yüklemek ise
   * hiç görülmeyecek bir istek. Sepetteki ürünler dışlanır — zaten aldığı şeyi
   * önermek, önerinin tamamına olan güveni bitirir.
   */
  const productIds = useMemo(() => lines.map((l) => l.productId).join(","), [lines]);

  useEffect(() => {
    if (!isOpen || lines.length === 0) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();

    fetch(`/api/menu/items?suggest=3&exclude=${encodeURIComponent(productIds)}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("items"))))
      .then((data: MenuItemsResponse) => setSuggestions(data.items))
      .catch(() => {
        // Öneri bir süs: yüklenemezse şerit hiç çizilmez, akış etkilenmez.
      });

    return () => controller.abort();
  }, [isOpen, lines.length, productIds]);

  /**
   * "Geri al" teklifi kendiliğinden kapanır.
   *
   * Süresiz duran bir geri alma şeridi, bir sonraki oturumda hâlâ orada olur ve
   * müşteri neyi geri alacağını unutmuş olur. Altı saniye, yanlış dokunuşu fark
   * edip düzeltmeye yeter.
   */
  useEffect(() => {
    if (!lastRemoved) return;
    const timer = setTimeout(dismissUndo, 6000);
    return () => clearTimeout(timer);
  }, [lastRemoved, dismissUndo]);

  /** Satırı düzenlemek için ürünün güncel tarifini çeker. */
  const startEditing = useCallback(async (line: CartLine) => {
    try {
      const response = await fetch(`/api/menu/items?ids=${encodeURIComponent(line.productId)}`);
      if (!response.ok) return;
      const data = (await response.json()) as MenuItemsResponse;
      const item = data.items[0];
      // Ürün menüden kalkmışsa pencere açılmaz: satır zaten "nicht verfügbar"
      // işaretli görünüyor ve tek yapılabilecek şey onu silmek.
      if (item) setEditing({ line, item });
    } catch {
      // Ağ hatası: düzenleme açılmaz, sepet olduğu gibi kalır.
    }
  }, []);

  const goToCheckout = () => {
    closeCart();
    router.push("/checkout");
  };

  /* Kapalı çekmece DOM'da kalır — kapanma animasyonu (`translate-x-full`)
     ancak böyle çalışır. Ama ekranın dışında durması onu erişilemez yapmıyordu:
     kapatma, adet, kaldır ve "Zur Kasse" düğmeleri klavyeyle sırayla
     geziliyordu ve `role="dialog" aria-modal="true"` ekran okuyucuya sepet
     kapalıyken de "açık pencere" diyordu. İki nitelik bunu kapatır:
     `inert` odağı ve işaretçiyi keser, `aria-hidden` erişilebilirlik
     ağacından çıkarır. Açıkken ikisi de yazılmaz. */
  const closedProps = (
    isOpen ? {} : { inert: "", "aria-hidden": true }
  ) as HTMLAttributes<HTMLDivElement>;

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
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.cart.title}
        {...closedProps}
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
                      <div className="flex items-center">
                        {/* Satırı yeniden yapılandırmak: sos değiştirmek için
                            silip menüye dönmek, seçenekli bir üründe dokuz
                            dokunuş demekti. */}
                        <button
                          onClick={() => void startEditing(line)}
                          className="focus-ring tag min-h-[44px] px-2 text-smoke transition-colors hover:text-amber"
                        >
                          {t.ordering.cart.editLine}
                        </button>
                        <button
                          onClick={() => remove(key)}
                          className="focus-ring tag min-h-[44px] px-2 text-smoke transition-colors hover:text-flame"
                        >
                          {t.cart.removeBtn}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* çapraz satış — "Dazu passt" */}
          {lines.length > 0 && suggestions.length > 0 && (
            <div className="mt-6 border-t border-line pt-5">
              <p className="tag mb-3 text-smoke">{t.ordering.cart.suggestionsTitle}</p>
              <ul className="space-y-2">
                {suggestions.map((item) => (
                  <li
                    key={item.productId}
                    className="flex items-center justify-between gap-3 border border-line bg-void/35 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-bone">{item.name}</p>
                      {item.price && (
                        <p className="font-mono text-xs text-amber tabular-nums">{item.price}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        add({
                          kind: "product",
                          productId: item.productId as string,
                          ...(item.variants?.[0] ? { variantSize: item.variants[0].size } : {}),
                        })
                      }
                      className="focus-ring tag min-h-[44px] shrink-0 border border-line px-3 text-smoke transition-colors hover:border-amber hover:text-amber"
                    >
                      {t.ordering.cart.suggestionsAdd}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Geri alma şeridi listenin üstünde değil altında: silinen satırın
            bulunduğu yer değişmiş olabilir, ama alt şerit her zaman aynı
            yerde. */}
        {lastRemoved && (
          <div
            role="status"
            className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-void/60 px-6 py-3"
          >
            <p className="min-w-0 truncate text-xs text-smoke">
              {t.ordering.cart.removed.replace(
                "{name}",
                labels.current.get(lineKey(lastRemoved)) ?? lastRemoved.productId
              )}
            </p>
            <button
              type="button"
              onClick={undoRemove}
              className="focus-ring tag shrink-0 border border-amber px-3 py-2 text-amber transition-colors hover:bg-amber hover:text-void"
            >
              {t.ordering.cart.undo}
            </button>
          </div>
        )}

        {lines.length > 0 && (
          <div className="shrink-0 border-t border-line px-6 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {/* Teslim biçimi burada da sorulur: teslimat ücreti ve minimum
                sepet tutarı buna bağlı, dolayısıyla sepetteki eşik çubuğu
                ancak seçim bilinirken doğru olabilir. Posta kodu ödeme
                adımında; bu yüzden burada yalnızca iki seçenek var. */}
            {status && status.deliveryEnabled && status.pickupEnabled && (
              <div className="mb-4">
                <div
                  role="group"
                  aria-label={t.cart.fulfillmentTitle}
                  className="grid grid-cols-2 gap-px border border-line bg-line"
                >
                  {(["DELIVERY", "PICKUP"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setFulfillment(mode)}
                      aria-pressed={fulfillment === mode}
                      className={`focus-ring tag min-h-[44px] px-3 transition-colors ${
                        fulfillment === mode
                          ? "bg-amber/15 text-amber"
                          : "bg-void text-smoke hover:text-bone"
                      }`}
                    >
                      {mode === "DELIVERY"
                        ? t.cart.fulfillmentDelivery
                        : t.cart.fulfillmentPickup}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-smoke/60">
                  {fulfillment === "DELIVERY"
                    ? t.ordering.cart.zipHint
                    : t.ordering.cart.fulfillmentHint}
                </p>
              </div>
            )}

            {/* eşik çubukları */}
            {fulfillment === "DELIVERY" && totalsReady && (
              <Thresholds quote={quote} status={status} />
            )}

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

            {/* Otomatik kampanyalar (ayın ürünü, menü fiyatı) burada da
                görünür: müşteri menü setini tamamladığında kazancı sepette
                görsün, ödeme ekranında sürpriz olarak değil. */}
            {totalsReady && quote.discountCents > 0 && (
              <p className="-mt-2 mb-4 flex justify-between gap-3 text-xs text-herb">
                <span>{t.ordering.cart.campaignSavings}</span>
                <span className="font-mono tabular-nums">−{formatCents(quote.discountCents)}</span>
              </p>
            )}

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

      {editing && (
        <ProductDialog
          item={editing.item}
          mode="edit"
          initial={{
            variantSize: editing.line.variantSize,
            options: editing.line.options ?? [],
            note: editing.line.note ?? "",
            qty: editing.line.qty,
          }}
          onClose={() => setEditing(null)}
          onSubmit={(draft: ProductDraft) => {
            replace(lineKey(editing.line), {
              kind: "product",
              productId: editing.line.productId,
              ...(draft.variantSize ? { variantSize: draft.variantSize } : {}),
              ...(draft.options.length > 0 ? { options: draft.options } : {}),
              ...(draft.note ? { note: draft.note } : {}),
              qty: draft.qty,
            });
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Eşik çubukları — minimum sepet ve ücretsiz teslimat.
 *
 * İkisi de aynı görsel dili kullanır ama farklı şey söyler: biri **engel**
 * (altındaysan sipariş veremezsin), diğeri **teşvik** (altındaysan ücret
 * ödersin). Bu yüzden renkleri ayrı ve engelin metni her zaman önce gelir.
 *
 * Posta kodu seçilmemişken bölgeye özgü eşik bilinmez. O durumda bölgelerin
 * **en düşük** eşiği "…'dan başlar" diye gösterilir: müşteri neyle karşı
 * karşıya olduğunu bilir, ama kesin sayı ödeme adımında netleşir. Hiçbir şey
 * göstermemek, sepeti doldurup ödeme adımında duvara toslamak demekti.
 */
function Thresholds({
  quote,
  status,
}: {
  quote: NonNullable<ReturnType<typeof useCart>["quote"]>;
  status: MenuStatus | null;
}) {
  const { t } = useLanguage();
  const c = t.ordering.cart;

  const zone = quote.zone;
  const subtotal = quote.subtotalCents;

  // Bölge biliniyorsa kesin eşik, bilinmiyorsa en düşük bölge eşiği.
  const minThreshold = zone ? zone.minOrderCents : (status?.minOrderFromCents ?? 0);
  const freeThreshold = zone ? zone.freeOverCents : (status?.freeDeliveryFromCents ?? 0);

  const min = thresholdProgress(subtotal, minThreshold);
  const free = thresholdProgress(subtotal, freeThreshold);

  if (!min.active && !free.active) return null;

  return (
    <div className="mb-4 space-y-3">
      {min.active && (
        <Bar
          tone={min.reached ? "herb" : "flame"}
          percent={min.percent}
          label={
            min.reached
              ? c.minOrderReached
              : zone
                ? c.minOrderRemaining.replace("{amount}", formatCents(min.remainingCents))
                : c.minOrderGeneric.replace("{amount}", formatCents(minThreshold))
          }
        />
      )}
      {free.active && (
        <Bar
          tone={free.reached ? "herb" : "amber"}
          percent={free.percent}
          label={
            free.reached
              ? c.freeDeliveryReached
              : zone
                ? c.freeDeliveryRemaining.replace("{amount}", formatCents(free.remainingCents))
                : c.freeDeliveryGeneric.replace("{amount}", formatCents(freeThreshold))
          }
        />
      )}
    </div>
  );
}

const BAR_TONES = {
  flame: { text: "text-flame", fill: "bg-flame" },
  amber: { text: "text-amber", fill: "bg-amber" },
  herb: { text: "text-herb", fill: "bg-herb" },
} as const;

function Bar({
  tone,
  percent,
  label,
}: {
  tone: keyof typeof BAR_TONES;
  percent: number;
  label: string;
}) {
  const style = BAR_TONES[tone];
  return (
    <div>
      <p className={`tag mb-1.5 ${style.text}`}>{label}</p>
      {/* Çubuk `progressbar`: ekran okuyucu yüzdeyi de duyabilsin. Metin zaten
          tam bilgiyi taşıdığı için çubuğun kendisi `aria-hidden` değil,
          etiketli bir ölçü olarak sunuluyor. */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={label}
        className="h-1.5 w-full overflow-hidden bg-line"
      >
        <div
          className={`h-full transition-[width] duration-500 ${style.fill}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
