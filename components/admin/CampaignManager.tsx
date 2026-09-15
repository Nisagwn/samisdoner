"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatCents } from "@/lib/money";
import type { CouponRecord } from "@/lib/orders/coupons";
import { Badge, Button, ConfirmDialog, Field, Notice, Select, TextInput, Toggle } from "./ui";

/**
 * Kampanyalar ekranı (eskiden "İndirim kuponları").
 *
 * Kupon tek bir şey yapabiliyordu: kodu yazana sepetten yüzde ya da sabit
 * tutar indirmek. Dönercinin gerçekte yaptığı kampanyalar ise çoğunlukla
 * koda bağlı değil — "ayın ürünü", "Döner + Pommes + Ayran menüsü 9,90 €".
 * Bu ekran dört türü tek listede yönetiyor ve her birinin kodlu mu otomatik
 * mi çalışacağını ayrıca soruyor.
 *
 * TASARIM KARARLARI
 *
 * 1. **Önce tür seçilir.** Formun geri kalanı türe göre değişiyor (ürün
 *    listesi, "kampanya fiyatı" mı "indirim oranı" mı); türü sonda sormak,
 *    doldurulmuş alanların anlamını sonradan değiştirmek olurdu.
 *
 * 2. **Ekleme formu kapalı başlar.** Kampanya nadiren oluşturulur, sık
 *    okunur: ekranı açan kişi çoğunlukla "hangi kampanyalar açık" diye
 *    bakıyordur.
 *
 * 3. **Kaldırma düğmesi tek, sonucu iki türlü.** İşletmecinin istediği şey
 *    "bu kampanya artık çalışmasın"; kullanılmış olup olmamasına göre
 *    silinmesi ya da pasifleşmesi teknik bir ayrıntı. Sunucu hangisini
 *    yaptığını söyler, ekran da onu bildirir.
 *
 * 4. **Kullanım sayacı düzenlenemez.** Sayı kullanımın kendisinden doğuyor.
 *
 * Tutarlar panelde Euro girilir, sunucuya cent gider — panelin geri kalanıyla
 * aynı (bkz. ZoneManager).
 */

/** Ürün seçicisinin gördüğü ürün. */
export type CampaignProductOption = {
  id: string;
  label: string;
  /** Menüde görünmüyorsa (pasif, tükendi) seçilebilir ama işaretli. */
  hidden: boolean;
  /** Boysuz üründe taban fiyat. */
  priceCents: number;
  variants: { size: string; priceCents: number }[];
};

type Kind = CouponRecord["kind"];

const KINDS: { kind: Kind; label: string; example: string }[] = [
  {
    kind: "PRODUCT_PRICE",
    label: "Ürüne özel fiyat",
    example: "Ayın ürünü — ör. bu ay Dürüm 6,50 €",
  },
  {
    kind: "BUNDLE_PRICE",
    label: "Menü fiyatı",
    example: "Ürün birleşimi — ör. Döner + Pommes + Ayran birlikte 9,90 €",
  },
  { kind: "PERCENT", label: "Sepette yüzde indirim", example: "ör. bütün siparişlerde %10" },
  { kind: "FIXED", label: "Sepette sabit indirim", example: "ör. 25 € üzeri siparişte 3 € indirim" },
];

const KIND_LABEL = Object.fromEntries(KINDS.map((entry) => [entry.kind, entry.label])) as Record<
  Kind,
  string
>;

const isItemKind = (kind: Kind) => kind === "PRODUCT_PRICE" || kind === "BUNDLE_PRICE";

type ItemForm = { productId: string; variantSize: string; qty: string };

type Form = {
  kind: Kind;
  /** true = kod yok, koşulları tutan her sepete uygulanır. */
  automatic: boolean;
  code: string;
  title: string;
  titleTr: string;
  /** Yüzde türünde yüzde, diğerlerinde Euro. İkisi de metin: kutu metindir. */
  value: string;
  items: ItemForm[];
  minOrder: string;
  maxDiscount: string;
  fulfillment: "" | "DELIVERY" | "PICKUP";
  /** "2026-09-20T18:00" — `datetime-local` kutusunun biçimi. */
  startsAt: string;
  expiresAt: string;
  maxRedemptions: string;
  active: boolean;
};

const EMPTY_ITEM: ItemForm = { productId: "", variantSize: "", qty: "1" };

const EMPTY: Form = {
  kind: "PRODUCT_PRICE",
  automatic: true,
  code: "",
  title: "",
  titleTr: "",
  value: "",
  items: [EMPTY_ITEM],
  minOrder: "0,00",
  maxDiscount: "0,00",
  fulfillment: "",
  startsAt: "",
  expiresAt: "",
  maxRedemptions: "0",
  active: true,
};

/* ------------------------------------------------------------ dönüşümler */

/** 1500 → "15,00" */
function centsToInput(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2).replace(".", ",");
}

/** "15,00" → 1500. Bozuk girdi 0 sayılır; sunucu zaten yeniden doğruluyor. */
function inputToCents(value: string): number {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

/**
 * `datetime-local` kutusu ile ISO arasındaki çevrim.
 *
 * Kutu **yerel** duvar saati verir ve saat dilimi taşımaz; sunucu ISO bekler.
 * Panel işletmenin bilgisayarından açıldığı için tarayıcının yerel saat
 * dilimini varsaymak doğru: işletmeci "akşam 6" yazdığında kendi saatini
 * kastediyor.
 */
function localToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoToLocal(date: Date | null): string {
  if (!date) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** Menü fiyatı en az iki satırla açılır: tek satırlık "menü" yoktur. */
function padItems(kind: Kind, items: ItemForm[]): ItemForm[] {
  if (kind === "BUNDLE_PRICE" && items.length < 2) {
    return [...items, ...Array.from({ length: 2 - items.length }, () => EMPTY_ITEM)];
  }
  return items.length > 0 ? items : [EMPTY_ITEM];
}

function toForm(coupon: CouponRecord): Form {
  return {
    kind: coupon.kind,
    automatic: coupon.code === null,
    code: coupon.code ?? "",
    title: coupon.title,
    titleTr: coupon.titleTr,
    value: coupon.kind === "PERCENT" ? String(coupon.value) : centsToInput(coupon.value),
    items: padItems(
      coupon.kind,
      coupon.items.map((item) => ({
        productId: item.productId,
        variantSize: item.variantSize ?? "",
        qty: String(item.qty),
      }))
    ),
    minOrder: centsToInput(coupon.minOrderCents),
    maxDiscount: centsToInput(coupon.maxDiscountCents),
    fulfillment: coupon.fulfillment ?? "",
    startsAt: isoToLocal(coupon.startsAt),
    expiresAt: isoToLocal(coupon.expiresAt),
    maxRedemptions: String(coupon.maxRedemptions),
    active: coupon.active,
  };
}

/** Formu sunucunun beklediği gövdeye çevirir. */
function toBody(form: Form) {
  return {
    code: form.automatic ? "" : form.code.trim().toUpperCase(),
    kind: form.kind,
    title: form.title.trim(),
    titleTr: form.titleTr.trim(),
    value: form.kind === "PERCENT" ? Number(form.value) || 0 : inputToCents(form.value),
    items: isItemKind(form.kind)
      ? form.items
          .filter((item) => item.productId !== "")
          .map((item) => ({
            productId: item.productId,
            variantSize: item.variantSize,
            qty: Math.max(1, Number(item.qty) || 1),
          }))
      : [],
    minOrderCents: inputToCents(form.minOrder),
    maxDiscountCents: form.kind === "PERCENT" ? inputToCents(form.maxDiscount) : 0,
    fulfillment: form.fulfillment === "" ? null : form.fulfillment,
    startsAt: localToIso(form.startsAt),
    expiresAt: localToIso(form.expiresAt),
    maxRedemptions: Number(form.maxRedemptions) || 0,
    active: form.active,
  };
}

/** Kalemin kampanyasız fiyatı; ürün/boy bulunamazsa null. */
function regularCents(
  item: { productId: string; variantSize?: string },
  byId: Map<string, CampaignProductOption>
): number | null {
  const product = byId.get(item.productId);
  if (!product) return null;
  if (!item.variantSize) return product.priceCents;
  return product.variants.find((variant) => variant.size === item.variantSize)?.priceCents ?? null;
}

/* ------------------------------------------------------------------ ekran */

export default function CampaignManager({
  coupons,
  products,
}: {
  coupons: CouponRecord[];
  products: CampaignProductOption[];
}) {
  const router = useRouter();
  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Form>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Form>(EMPTY);
  const [pendingRetire, setPendingRetire] = useState<CouponRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "İşlem başarısız oldu.");
        return null;
      }
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      router.refresh();
      return data;
    } catch {
      setError("Sunucuya ulaşılamadı.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function addCampaign(event: React.FormEvent) {
    event.preventDefault();
    if (await send("/api/admin/coupons", "POST", toBody(draft))) {
      setDraft(EMPTY);
      setAdding(false);
    }
  }

  async function saveEdit(id: string) {
    if (await send(`/api/admin/coupons/${encodeURIComponent(id)}`, "PATCH", toBody(editing))) {
      setEditingId(null);
    }
  }

  async function confirmRetire() {
    if (!pendingRetire) return;
    const result = await send(
      `/api/admin/coupons/${encodeURIComponent(pendingRetire.id)}`,
      "DELETE"
    );
    if (result) {
      // Silme ile pasifleştirme aynı düğmeden çıkar; hangisi olduğu
      // söylenmezse işletmeci listede duran kampanyayı hata sanır.
      setNotice(
        result.outcome === "deleted"
          ? "Kampanya silindi."
          : "Kampanya kullanılmış olduğu için silinmedi, kapatıldı. Artık hiçbir siparişe uygulanmaz."
      );
      setPendingRetire(null);
    }
  }

  /** Ekleme ve düzenleme aynı alanları kullanır; tek yerde tanımlanır. */
  const fields = (form: Form, set: (next: Form) => void) => {
    const setItem = (index: number, next: ItemForm) =>
      set({ ...form, items: form.items.map((item, i) => (i === index ? next : item)) });

    // Menü fiyatında "ayrı ayrı alsa ne öderdi" hesabı: fiyatın gerçekten bir
    // fırsat olup olmadığını işletmeci kaydetmeden görsün.
    const bundleRegular =
      form.kind === "BUNDLE_PRICE"
        ? form.items.reduce<number | null>((sum, item) => {
            if (sum === null || item.productId === "") return sum;
            const price = regularCents(
              { productId: item.productId, variantSize: item.variantSize || undefined },
              byId
            );
            return price === null ? null : sum + price * Math.max(1, Number(item.qty) || 1);
          }, 0)
        : null;
    const valueCents = inputToCents(form.value);

    return (
      <div className="space-y-6">
        {/* 1 — tür */}
        <fieldset>
          <legend className="tag mb-2 block text-smoke">Kampanya türü</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {KINDS.map((entry) => {
              const selected = form.kind === entry.kind;
              return (
                <button
                  key={entry.kind}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() =>
                    set({
                      ...form,
                      kind: entry.kind,
                      items: padItems(entry.kind, form.items),
                      // Değerin anlamı türle değişiyor (yüzde ↔ Euro);
                      // eski sayı yeni anlamıyla kalırsa "%650" doğar.
                      value: entry.kind === form.kind ? form.value : entry.kind === "PERCENT" ? "10" : "",
                    })
                  }
                  className={`focus-ring border px-4 py-3 text-left transition-colors ${
                    selected
                      ? "border-amber bg-amber/10"
                      : "border-line bg-void hover:border-smoke"
                  }`}
                >
                  <span className={`tag block ${selected ? "text-amber" : "text-bone"}`}>
                    {entry.label}
                  </span>
                  <span className="mt-1 block text-xs text-smoke">{entry.example}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* 2 — nasıl uygulanır */}
        <fieldset>
          <legend className="tag mb-2 block text-smoke">Nasıl uygulanır</legend>
          <div className="flex flex-wrap gap-2">
            <Toggle
              checked={form.automatic}
              onChange={() => set({ ...form, automatic: true })}
              onLabel="● OTOMATİK — KOD GEREKMEZ"
              offLabel="○ OTOMATİK — KOD GEREKMEZ"
            />
            <Toggle
              checked={!form.automatic}
              onChange={() => set({ ...form, automatic: false })}
              onLabel="● MÜŞTERİ KOD GİRİNCE"
              offLabel="○ MÜŞTERİ KOD GİRİNCE"
            />
          </div>
          <p className="mt-1.5 text-xs text-smoke/70">
            {form.automatic
              ? "Koşulları tutan her sepete kendiliğinden uygulanır ve menü sayfasında duyurulur."
              : "Yalnızca ödeme ekranında kodu yazan müşteriye uygulanır; menüde duyurulmaz."}
          </p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          {!form.automatic && (
            <Field label="Kod" hint="Yalnızca harf ve rakam. Müşteri bunu yazacak.">
              <TextInput
                value={form.code}
                onChange={(e) => set({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="DONER10"
                maxLength={40}
              />
            </Field>
          )}
          <Field
            label={form.automatic ? "Kampanya adı — Türkçe" : "Kampanya adı — Türkçe (isteğe bağlı)"}
            hint="Müşteri menüde ve sepette bu adı görür."
          >
            <TextInput
              value={form.titleTr}
              onChange={(e) => set({ ...form, titleTr: e.target.value })}
              placeholder="Ayın ürünü: Dürüm"
              maxLength={80}
            />
          </Field>
          <Field label="Kampanya adı — Almanca" hint="Boş bırakılırsa Türkçesi gösterilir.">
            <TextInput
              value={form.title}
              onChange={(e) => set({ ...form, title: e.target.value })}
              placeholder="Monatsangebot: Dürüm"
              maxLength={80}
            />
          </Field>
        </div>

        {/* 3 — ürünler */}
        {isItemKind(form.kind) && (
          <fieldset>
            <legend className="tag mb-2 block text-smoke">
              {form.kind === "BUNDLE_PRICE" ? "Menüdeki ürünler" : "Kampanya fiyatına inecek ürün(ler)"}
            </legend>
            <ul className="space-y-2">
              {form.items.map((item, index) => {
                const product = byId.get(item.productId);
                return (
                  <li key={index} className="flex flex-wrap items-center gap-2">
                    <Select
                      aria-label={`${index + 1}. ürün`}
                      value={item.productId}
                      onChange={(e) => setItem(index, { ...item, productId: e.target.value, variantSize: "" })}
                      className="min-w-0 flex-1 sm:min-w-[240px]"
                    >
                      <option value="">Ürün seçin…</option>
                      {products.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                          {option.hidden ? " (menüde görünmüyor)" : ""}
                        </option>
                      ))}
                    </Select>
                    {product && product.variants.length > 0 && (
                      <Select
                        aria-label={`${index + 1}. ürünün boyu`}
                        value={item.variantSize}
                        onChange={(e) => setItem(index, { ...item, variantSize: e.target.value })}
                        className="w-auto"
                      >
                        <option value="">Bütün boylar</option>
                        {product.variants.map((variant) => (
                          <option key={variant.size} value={variant.size}>
                            {variant.size} — {formatCents(variant.priceCents)}
                          </option>
                        ))}
                      </Select>
                    )}
                    {form.kind === "BUNDLE_PRICE" && (
                      <TextInput
                        aria-label={`${index + 1}. ürünün adedi`}
                        value={item.qty}
                        onChange={(e) => setItem(index, { ...item, qty: e.target.value })}
                        inputMode="numeric"
                        className="w-16"
                      />
                    )}
                    {form.items.length > (form.kind === "BUNDLE_PRICE" ? 2 : 1) && (
                      <button
                        type="button"
                        onClick={() => set({ ...form, items: form.items.filter((_, i) => i !== index) })}
                        className="focus-ring tag px-2 py-2 text-smoke hover:text-flame"
                        aria-label={`${index + 1}. ürünü çıkar`}
                      >
                        ✕
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => set({ ...form, items: [...form.items, EMPTY_ITEM] })}
              className="focus-ring tag mt-2 text-smoke underline underline-offset-4 hover:text-amber"
            >
              + ÜRÜN EKLE
            </button>
            <p className="mt-1.5 text-xs text-smoke/70">
              {form.kind === "BUNDLE_PRICE"
                ? "Bu ürünlerin hepsi sepetteyse set başına menü fiyatı ödenir; iki set varsa iki kez. Ekstra seçimler (peynir vb.) ayrıca ücretlidir."
                : "Seçilen her ürünün adedi kampanya fiyatına iner. Boy seçmezseniz bütün boylar bu fiyata iner. Ekstra seçimler ayrıca ücretlidir."}
            </p>
          </fieldset>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={
              {
                PERCENT: "İndirim oranı (%)",
                FIXED: "İndirim tutarı (€)",
                PRODUCT_PRICE: "Kampanya fiyatı — adet başına (€)",
                BUNDLE_PRICE: "Menünün toplam fiyatı (€)",
              }[form.kind]
            }
            hint={
              form.kind === "PERCENT"
                ? "1–100 arası. Yemeğin bedelinden düşülür, kurye ücretinden değil."
                : form.kind === "FIXED"
                  ? "Yemeğin bedelinden düşülür; onu geçemez."
                  : form.kind === "BUNDLE_PRICE" && bundleRegular !== null && bundleRegular > 0
                    ? `Ayrı ayrı: ${formatCents(bundleRegular)}${
                        valueCents > 0 && valueCents < bundleRegular
                          ? ` — müşteri set başına ${formatCents(bundleRegular - valueCents)} kazanır.`
                          : valueCents >= bundleRegular
                            ? " — menü fiyatı bundan ucuz olmalı, yoksa uygulanmaz."
                            : ""
                      }`
                    : "Ürünün normal fiyatından ucuz olmalı; değilse indirim uygulanmaz."
            }
          >
            <TextInput
              value={form.value}
              onChange={(e) => set({ ...form, value: e.target.value })}
              inputMode="decimal"
              placeholder={form.kind === "PERCENT" ? "10" : "6,50"}
              required
            />
          </Field>

          {/* Tavan yalnızca yüzde indiriminde anlamlı: "%50 ama en fazla 5 €". */}
          {form.kind === "PERCENT" && (
            <Field label="En fazla indirim (€)" hint="0 = sınır yok.">
              <TextInput
                value={form.maxDiscount}
                onChange={(e) => set({ ...form, maxDiscount: e.target.value })}
                inputMode="decimal"
              />
            </Field>
          )}

          <Field label="Asgari sepet tutarı (€)" hint="0 = eşik yok.">
            <TextInput
              value={form.minOrder}
              onChange={(e) => set({ ...form, minOrder: e.target.value })}
              inputMode="decimal"
            />
          </Field>

          <Field label="Geçerli olduğu sipariş türü">
            <Select
              value={form.fulfillment}
              onChange={(e) => set({ ...form, fulfillment: e.target.value as Form["fulfillment"] })}
            >
              <option value="">Teslimat ve gel-al</option>
              <option value="DELIVERY">Yalnızca teslimat</option>
              <option value="PICKUP">Yalnızca gel-al</option>
            </Select>
          </Field>

          <Field label="Başlangıç" hint="Boş bırakılırsa hemen geçerli olur.">
            <TextInput
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => set({ ...form, startsAt: e.target.value })}
            />
          </Field>

          <Field label="Bitiş" hint="Boş bırakılırsa süresiz. Ayın ürünü için ayın son günü.">
            <TextInput
              type="datetime-local"
              value={form.expiresAt}
              onChange={(e) => set({ ...form, expiresAt: e.target.value })}
            />
          </Field>

          <Field label="Kullanım sınırı" hint="Toplam kaç siparişte kullanılabilir. 0 = sınırsız.">
            <TextInput
              value={form.maxRedemptions}
              onChange={(e) => set({ ...form, maxRedemptions: e.target.value })}
              inputMode="numeric"
            />
          </Field>

          <Field label="Durum">
            <Toggle
              checked={form.active}
              onChange={(next) => set({ ...form, active: next })}
              onLabel="AÇIK"
              offLabel="KAPALI"
            />
          </Field>
        </div>
      </div>
    );
  };

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[640px] text-sm leading-relaxed text-smoke">
          Otomatik kampanyalar koşulları tutan her sepete kendiliğinden uygulanır; kodlu olan
          yalnızca kodu yazana. Aynı sepette birkaçı birlikte geçebilir, ama bir ürün iki kez
          indirim almaz: önce menü fiyatları, sonra ürüne özel fiyatlar, en son sepet indirimi
          uygulanır.
        </p>
        <Button
          variant={adding ? "ghost" : "primary"}
          onClick={() => {
            setAdding(!adding);
            setError(null);
          }}
        >
          {adding ? "VAZGEÇ" : "+ YENİ KAMPANYA"}
        </Button>
      </div>

      {error && <Notice kind="error" message={error} />}
      {notice && <Notice kind="success" message={notice} />}

      {adding && (
        <form onSubmit={addCampaign} className="mb-6 mt-4 border border-line bg-panel p-5">
          {fields(draft, setDraft)}
          <div className="mt-6 flex gap-3">
            <Button type="submit" disabled={busy}>
              KAYDET
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              VAZGEÇ
            </Button>
          </div>
        </form>
      )}

      {coupons.length === 0 ? (
        <p className="mt-4 border border-line bg-panel px-5 py-8 text-center text-sm text-smoke">
          Henüz kampanya yok. Ayın ürünü, menü fiyatı ya da indirim kodu açmak için yukarıdaki
          düğmeyi kullanın.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {coupons.map((coupon) => (
            <li key={coupon.id} className="border border-line bg-panel">
              {editingId === coupon.id ? (
                <div className="p-5">
                  {fields(editing, setEditing)}
                  <div className="mt-6 flex gap-3">
                    <Button onClick={() => saveEdit(coupon.id)} disabled={busy}>
                      KAYDET
                    </Button>
                    <Button variant="ghost" onClick={() => setEditingId(null)}>
                      VAZGEÇ
                    </Button>
                  </div>
                </div>
              ) : (
                <CampaignRow
                  coupon={coupon}
                  byId={byId}
                  onEdit={() => {
                    setEditingId(coupon.id);
                    setEditing(toForm(coupon));
                    setError(null);
                    setNotice(null);
                  }}
                  onRetire={() => setPendingRetire(coupon)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingRetire !== null}
        title="Kampanya kaldırılsın mı?"
        message={
          pendingRetire
            ? "Kampanya artık hiçbir siparişe uygulanmayacak. " +
              (pendingRetire.redeemedCount > 0
                ? "Kullanıldığı için silinmez, kapatılır — sipariş geçmişi kaydına bakıyor."
                : "Hiç kullanılmadığı için tamamen silinir.")
            : ""
        }
        confirmLabel="KALDIR"
        onConfirm={confirmRetire}
        onCancel={() => setPendingRetire(null)}
      />
    </section>
  );
}

/**
 * Listedeki tek satır.
 *
 * Kuralın tamamı tek bakışta okunabilmeli: ne olduğu, ne kadar indirdiği,
 * nasıl uygulandığı, hangi koşullarda geçerli olduğu ve kaç kez kullanıldığı.
 */
function CampaignRow({
  coupon,
  byId,
  onEdit,
  onRetire,
}: {
  coupon: CouponRecord;
  byId: Map<string, CampaignProductOption>;
  onEdit: () => void;
  onRetire: () => void;
}) {
  const itemName = (item: CouponRecord["items"][number]) => {
    const product = byId.get(item.productId);
    const name = product ? product.label : "silinmiş ürün";
    return item.variantSize ? `${name} (${item.variantSize})` : name;
  };

  const rule =
    coupon.kind === "PERCENT"
      ? `Sepete %${coupon.value} indirim` +
        (coupon.maxDiscountCents > 0 ? ` (en fazla ${formatCents(coupon.maxDiscountCents)})` : "")
      : coupon.kind === "FIXED"
        ? `Sepetten ${formatCents(coupon.value)} indirim`
        : coupon.kind === "PRODUCT_PRICE"
          ? `${coupon.items.map(itemName).join(", ")} → adedi ${formatCents(coupon.value)}`
          : `${coupon.items.map((item) => `${item.qty}× ${itemName(item)}`).join(" + ")} → birlikte ${formatCents(coupon.value)}`;

  const conditions: string[] = [coupon.code === null ? "Otomatik" : `Kod: ${coupon.code}`];
  if (coupon.minOrderCents > 0) conditions.push(`min. ${formatCents(coupon.minOrderCents)}`);
  if (coupon.fulfillment === "DELIVERY") conditions.push("yalnızca teslimat");
  if (coupon.fulfillment === "PICKUP") conditions.push("yalnızca gel-al");
  if (coupon.startsAt) conditions.push(`${formatDate(coupon.startsAt)} itibarıyla`);
  if (coupon.expiresAt) conditions.push(`${formatDate(coupon.expiresAt)} tarihine kadar`);

  const usage =
    coupon.maxRedemptions > 0
      ? `${coupon.redeemedCount} / ${coupon.maxRedemptions} kullanım`
      : `${coupon.redeemedCount} kullanım`;

  // Süresi geçmiş kampanya "açık" görünmemeli: kayıt aktif olsa bile artık
  // çalışmıyor ve panelde yeşil bir rozet işletmeciyi yanıltır.
  const now = Date.now();
  const expired = coupon.expiresAt !== null && coupon.expiresAt.getTime() <= now;
  const upcoming = coupon.startsAt !== null && coupon.startsAt.getTime() > now;
  const exhausted = coupon.maxRedemptions > 0 && coupon.redeemedCount >= coupon.maxRedemptions;
  const heading = coupon.titleTr || coupon.title || coupon.code || KIND_LABEL[coupon.kind];

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-base font-bold text-bone">{heading}</span>
          <Badge tone="off">{KIND_LABEL[coupon.kind]}</Badge>
          {!coupon.active ? (
            <Badge tone="off">KAPALI</Badge>
          ) : expired ? (
            <Badge tone="warn">SÜRESİ DOLDU</Badge>
          ) : exhausted ? (
            <Badge tone="warn">HAKKI DOLDU</Badge>
          ) : upcoming ? (
            <Badge tone="warn">HENÜZ BAŞLAMADI</Badge>
          ) : (
            <Badge tone="on">AÇIK</Badge>
          )}
        </div>
        <p className="mt-1.5 text-sm text-amber">{rule}</p>
        <p className="mt-1 text-xs text-smoke">
          {conditions.join(" · ")} — {usage}
        </p>
      </div>

      <div className="flex shrink-0 gap-2">
        <Button variant="ghost" onClick={onEdit}>
          DÜZENLE
        </Button>
        <Button variant="danger" onClick={onRetire}>
          KALDIR
        </Button>
      </div>
    </div>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
