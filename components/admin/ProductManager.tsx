"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ADDITIVES,
  ADDITIVE_LABELS,
  ALLERGENS,
  ALLERGEN_LABELS,
  VAT_RATES,
  formatPrice,
  hasLegalInfo,
  type Additive,
  type Allergen,
  type Category,
  type Product,
  type Variant,
} from "@/lib/admin/types";
import { useScrollLock } from "@/lib/useScrollLock";
import {
  Badge,
  Button,
  CheckGrid,
  ConfirmDialog,
  Field,
  Notice,
  Select,
  TextArea,
  TextInput,
  Toggle,
} from "./ui";

type Draft = {
  no: string;
  name: string;
  nameTr: string;
  description: string;
  descriptionTr: string;
  categoryId: string;
  price: string;
  discountPrice: string;
  image: string;
  active: boolean;
  inStock: boolean;
  showOnHome: boolean;
  featured: boolean;
  sortOrder: string;
  variants: { size: string; price: string }[];

  /* --- yasal bilgi (LMIV / ZZulV / UStG / BGB) --- */
  vatRate: number;
  allergens: Allergen[];
  additives: Additive[];
  allergenInfoConfirmed: boolean;
  isPerishable: boolean;
};

/** Izgaralar sabit listelerden kurulur; panel Türkçe olduğu için TR etiket. */
const ALLERGEN_OPTIONS = ALLERGENS.map((code) => ({
  code,
  label: `${ALLERGEN_LABELS[code].tr} · ${ALLERGEN_LABELS[code].de}`,
}));

const ADDITIVE_OPTIONS = ADDITIVES.map((code) => ({
  code,
  label: `${ADDITIVE_LABELS[code].tr} · ${ADDITIVE_LABELS[code].de}`,
}));

/** Müşteri tarafındaki `isVisible` kuralının arayüzdeki karşılığı. */
function visibleOnSite(p: Product): boolean {
  return p.active && p.inStock && p.showOnHome;
}

function emptyDraft(categoryId: string): Draft {
  return {
    no: "",
    name: "",
    nameTr: "",
    description: "",
    descriptionTr: "",
    categoryId,
    price: "",
    discountPrice: "",
    image: "",
    active: true,
    inStock: true,
    showOnHome: true,
    featured: false,
    sortOrder: "",
    variants: [],
    /* Yeni ürün varsayılanı yemektir: %7 KDV, çabuk bozulan.
       İçecek eklerken ikisi de değiştirilmeli — bu yüzden formda ikisi de
       görünür alan, gizli varsayılan değil. */
    vatRate: 7,
    allergens: [],
    additives: [],
    allergenInfoConfirmed: false,
    isPerishable: true,
  };
}

function toDraft(product: Product): Draft {
  return {
    no: product.no,
    name: product.name,
    nameTr: product.nameTr,
    description: product.description,
    descriptionTr: product.descriptionTr,
    categoryId: product.categoryId,
    price: String(product.price).replace(".", ","),
    discountPrice:
      product.discountPrice === null ? "" : String(product.discountPrice).replace(".", ","),
    image: product.image ?? "",
    active: product.active,
    inStock: product.inStock,
    showOnHome: product.showOnHome,
    featured: product.featured,
    sortOrder: String(product.sortOrder),
    variants: product.variants.map((v) => ({
      size: v.size,
      price: String(v.price).replace(".", ","),
    })),
    vatRate: product.vatRate,
    allergens: product.allergens,
    additives: product.additives,
    allergenInfoConfirmed: product.allergenInfoConfirmed,
    isPerishable: product.isPerishable,
  };
}

/** Formdaki metin alanlarını API'nin beklediği tiplere çevirir. */
function toPayload(draft: Draft) {
  const variants: { size: string; price: number }[] = draft.variants
    .filter((v) => v.price.trim() !== "")
    .map((v) => ({ size: v.size.trim(), price: Number(v.price.replace(",", ".")) }));

  return {
    no: draft.no.trim(),
    name: draft.name.trim(),
    nameTr: draft.nameTr.trim(),
    description: draft.description.trim(),
    descriptionTr: draft.descriptionTr.trim(),
    categoryId: draft.categoryId,
    price: Number(draft.price.replace(",", ".")),
    discountPrice: draft.discountPrice.trim() === "" ? null : Number(draft.discountPrice.replace(",", ".")),
    image: draft.image.trim() === "" ? null : draft.image.trim(),
    active: draft.active,
    inStock: draft.inStock,
    showOnHome: draft.showOnHome,
    featured: draft.featured,
    // Boş bırakılırsa mevcut sıra korunur (yeni üründe listenin sonuna eklenir).
    ...(draft.sortOrder.trim() === "" ? {} : { sortOrder: Number(draft.sortOrder.trim()) }),
    variants,
    vatRate: draft.vatRate,
    allergens: draft.allergens,
    additives: draft.additives,
    allergenInfoConfirmed: draft.allergenInfoConfirmed,
    isPerishable: draft.isPerishable,
  };
}

export default function ProductManager({
  initialProducts,
  categories,
  imageOptions,
}: {
  initialProducts: Product[];
  categories: Category[];
  imageOptions: string[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<Product | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null);

  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories]
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return initialProducts.filter((p) => {
      if (categoryFilter && p.categoryId !== categoryFilter) return false;
      if (
        needle &&
        !`${p.no} ${p.name} ${p.nameTr}`.toLowerCase().includes(needle)
      ) {
        return false;
      }
      if (statusFilter === "visible" && !visibleOnSite(p)) return false;
      if (statusFilter === "hidden" && visibleOnSite(p)) return false;
      if (statusFilter === "outofstock" && p.inStock) return false;
      return true;
    });
  }, [initialProducts, categoryFilter, search, statusFilter]);

  async function send(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "İşlem başarısız oldu.");
        return false;
      }
      // sunucu bileşenlerini tazele: liste ve dashboard güncellensin
      router.refresh();
      return true;
    } catch {
      setError("Sunucuya ulaşılamadı.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    const payload = toPayload(draft);
    const ok = editing
      ? await send(`/api/admin/products/${encodeURIComponent(editing.id)}`, "PATCH", payload)
      : await send("/api/admin/products", "POST", payload);
    if (ok) {
      setDraft(null);
      setEditing(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const ok = await send(
      `/api/admin/products/${encodeURIComponent(pendingDelete.id)}`,
      "DELETE"
    );
    if (ok) setPendingDelete(null);
  }

  const noCategories = categories.length === 0;

  return (
    <div className="max-w-[1200px] min-w-0">
      <header className="flex flex-wrap items-end justify-between gap-5 mb-8">
        <div>
          <p className="tag text-flame mb-2">Katalog</p>
          <h1 className="font-display font-extrabold text-3xl md:text-4xl text-bone">Ürünler</h1>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setDraft(emptyDraft(categories[0]?.id ?? ""));
            setError(null);
          }}
          disabled={noCategories}
        >
          + YENİ ÜRÜN
        </Button>
      </header>

      {noCategories && (
        <div className="mb-6">
          <Notice
            kind="error"
            message="Ürün ekleyebilmek için önce en az bir kategori oluşturmalısınız."
          />
        </div>
      )}

      {error && !draft && (
        <div className="mb-6">
          <Notice kind="error" message={error} />
        </div>
      )}

      {/* filtreler */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 mb-6">
        <TextInput
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ürün adında ara…"
          aria-label="Ürün ara"
          className="sm:max-w-[280px]"
        />
        <Select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Kategoriye göre filtrele"
          className="sm:max-w-[240px]"
        >
          <option value="">Tüm kategoriler</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Duruma göre filtrele"
          className="sm:max-w-[220px]"
        >
          <option value="">Tüm durumlar</option>
          <option value="visible">Menüde görünenler</option>
          <option value="hidden">Menüde görünmeyenler</option>
          <option value="outofstock">Tükenenler</option>
        </Select>
        <span className="tag text-smoke self-center tabular-nums">
          {visible.length} / {initialProducts.length} ürün
        </span>
      </div>

      {/* liste
          Satır sabit bir yatay şerit değil: üstte kimlik+fiyat bloğu, altında
          rozetler ve işlemler. Her grup kendi içinde sarmalandığı için hiçbir
          genişlikte yatay taşma olmaz ve tüm işlemler erişilebilir kalır
          (önceki sürümde `shrink-0` + `flex-wrap` birlikte kullanıldığından
          satır ne daralabiliyor ne de sarmalanabiliyordu). */}
      <ul className="border border-line divide-y divide-line">
        {visible.map((product) => (
          <li key={product.id} className="bg-char p-4 md:p-5">
            <div className="flex flex-wrap items-start gap-4">
              <div className="relative w-14 h-14 shrink-0 border border-line bg-panel overflow-hidden">
                {product.image ? (
                  <Image src={product.image} alt="" fill sizes="56px" className="object-cover" />
                ) : (
                  <span className="absolute inset-0 grid place-items-center tag text-smoke/50">
                    —
                  </span>
                )}
              </div>

              <div className="flex-1 min-w-[180px]">
                <p className="font-display font-bold text-bone [overflow-wrap:anywhere]">
                  {product.no && (
                    <span className="font-mono text-sm text-flame mr-2 tabular-nums">
                      {product.no}
                    </span>
                  )}
                  {product.name}
                </p>
                <p className="tag text-smoke mt-1 [overflow-wrap:anywhere]">
                  {categoryName.get(product.categoryId) ?? product.categoryId}
                  <span className="text-smoke/50"> · sıra {product.sortOrder}</span>
                  {product.nameTr && <span className="text-smoke/50"> · TR: {product.nameTr}</span>}
                </p>
                {product.description && (
                  <p className="text-xs text-smoke/70 mt-1.5 line-clamp-2">{product.description}</p>
                )}
              </div>

              <div className="ml-auto text-right shrink-0">
                {product.discountPrice !== null ? (
                  <>
                    <p className="font-display font-bold text-amber tabular-nums">
                      {formatPrice(product.discountPrice)}
                    </p>
                    <p className="text-xs text-smoke line-through tabular-nums">
                      {formatPrice(product.price)}
                    </p>
                  </>
                ) : (
                  <p className="font-display font-bold text-bone tabular-nums">
                    {formatPrice(product.price)}
                  </p>
                )}
                {product.variants.length > 1 && (
                  <p className="tag text-smoke/70 mt-1">{product.variants.length} varyasyon</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Badge tone={product.active ? "on" : "off"}>
                {product.active ? "AKTİF" : "PASİF"}
              </Badge>
              <Badge tone={product.inStock ? "on" : "warn"}>
                {product.inStock ? "STOKTA" : "TÜKENDİ"}
              </Badge>
              <Badge tone={product.showOnHome ? "on" : "off"}>
                {product.showOnHome ? "MENÜDE" : "MENÜDE DEĞİL"}
              </Badge>
              {product.featured && <Badge tone="on">ÖNE ÇIKAN</Badge>}
              {!visibleOnSite(product) && <Badge tone="warn">SİTEDE GÖRÜNMÜYOR</Badge>}
            </div>

            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-line/60">
              {/*
                Satırda anlık aç/kapa düğmesi YOK.

                Eskiden "GİZLE", "TÜKENDİ", "MENÜDEN ÇIKAR", "ÖNE ÇIKAR"
                düğmeleri tek dokunuşla canlı siteyi değiştiriyordu: onay yok,
                geri alma yok ve dar ekranda yanlış düğmeye basmak çok kolaydı.
                Artık bu dört anahtar da ürünün kendi düzenleme formunda —
                hepsi birlikte değişir, gözden geçirilir ve tek bir "KAYDET"
                ile yayına girer.
              */}
              <button
                onClick={() => {
                  setEditing(product);
                  setDraft(toDraft(product));
                  setError(null);
                }}
                className="focus-ring tag border border-amber px-3 py-2 text-amber transition-colors hover:bg-amber hover:text-void"
              >
                DÜZENLE
              </button>
              <button
                onClick={() => setPendingDelete(product)}
                className="focus-ring tag border border-flame/50 px-3 py-2 text-flame hover:bg-flame hover:text-void transition-colors sm:ml-auto"
              >
                SİL
              </button>
            </div>
          </li>
        ))}

        {visible.length === 0 && (
          <li className="bg-char px-5 py-10 text-center text-sm text-smoke">
            Aramanla eşleşen ürün yok.
          </li>
        )}
      </ul>

      {/* ekleme / düzenleme formu */}
      {draft && (
        <ProductForm
          draft={draft}
          setDraft={setDraft}
          categories={categories}
          imageOptions={imageOptions}
          editing={editing}
          error={error}
          busy={busy}
          onCancel={() => {
            setDraft(null);
            setEditing(null);
            setError(null);
          }}
          onSave={saveDraft}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Ürünü sil"
        message={`"${pendingDelete?.name ?? ""}" ürününü silmek istediğinize emin misiniz? Bu işlem geri alınamaz. Ürünü sadece satıştan kaldırmak istiyorsanız "GİZLE" seçeneğini kullanabilirsiniz.`}
        confirmLabel="EVET, SİL"
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- form */

function ProductForm({
  draft,
  setDraft,
  categories,
  imageOptions,
  editing,
  error,
  busy,
  onCancel,
  onSave,
}: {
  draft: Draft;
  setDraft: (next: Draft) => void;
  categories: Category[];
  imageOptions: string[];
  editing: Product | null;
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  useScrollLock(true);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value });

  const setVariant = (index: number, patch: Partial<{ size: string; price: string }>) => {
    const variants = draft.variants.map((v, i) => (i === index ? { ...v, ...patch } : v));
    setDraft({ ...draft, variants });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editing ? "Ürünü düzenle" : "Yeni ürün"}
      className="fixed inset-0 z-[75] overflow-y-auto overscroll-contain bg-void/85 backdrop-blur-sm"
    >
      {/* Kaydırma dış kutuda, ortalama içte — uzun formda pencerenin üstü
          ekranın dışına itilmesin diye; bkz. iptal penceresi. */}
      <div className="flex min-h-full items-center justify-center p-4 md:p-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
        className="w-full max-w-[720px] ember-surface border border-line p-6 md:p-9"
      >
        <h2 className="font-display font-extrabold text-2xl text-bone mb-7">
          {editing ? "Ürünü düzenle" : "Yeni ürün"}
        </h2>

        <div className="space-y-5">
          <div className="grid sm:grid-cols-[110px_1fr] gap-5">
            <Field label="Menü no" hint="Menüdeki sipariş numarası.">
              <TextInput
                maxLength={8}
                value={draft.no}
                onChange={(e) => set("no", e.target.value)}
                placeholder="01"
              />
            </Field>

            <Field label="Ürün adı (DE)">
              <TextInput
                required
                maxLength={120}
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Drehspieß"
              />
            </Field>
          </div>

          <Field label="Ürün adı (TR)" hint="Boş bırakılırsa Türkçe sitede Almanca ad kullanılır.">
            <TextInput
              maxLength={120}
              value={draft.nameTr}
              onChange={(e) => set("nameTr", e.target.value)}
              placeholder="Döner"
            />
          </Field>

          <Field label="Açıklama (DE)">
            <TextArea
              maxLength={400}
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Putenfleisch, Salat und Soße"
            />
          </Field>

          <Field label="Açıklama (TR)" hint="Boş bırakılırsa Almanca açıklama gösterilir.">
            <TextArea
              maxLength={400}
              value={draft.descriptionTr}
              onChange={(e) => set("descriptionTr", e.target.value)}
              placeholder="Hindi eti, salata ve sos"
            />
          </Field>

          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Kategori">
              <Select
                required
                value={draft.categoryId}
                onChange={(e) => set("categoryId", e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Görsel" hint="Boş bırakılırsa görsel gösterilmez.">
              <Select value={draft.image} onChange={(e) => set("image", e.target.value)}>
                <option value="">Görsel yok</option>
                {imageOptions.map((src) => (
                  <option key={src} value={src}>
                    {src.replace("/assets/", "")}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Fiyat (€)">
              <TextInput
                required
                inputMode="decimal"
                value={draft.price}
                onChange={(e) => set("price", e.target.value)}
                placeholder="7,00"
              />
            </Field>

            <Field label="İndirimli fiyat (€)" hint="Boş bırakılırsa indirim uygulanmaz.">
              <TextInput
                inputMode="decimal"
                value={draft.discountPrice}
                onChange={(e) => set("discountPrice", e.target.value)}
                placeholder="—"
              />
            </Field>
          </div>

          <Field
            label="Menüdeki sıra"
            hint="Küçük sayı üstte görünür. Boş bırakılırsa mevcut sıra korunur."
          >
            <TextInput
              inputMode="numeric"
              value={draft.sortOrder}
              onChange={(e) => set("sortOrder", e.target.value)}
              placeholder="0"
              className="sm:max-w-[160px]"
            />
          </Field>

          {/* boyut varyasyonları */}
          <div>
            <span className="tag text-smoke block mb-2">
              Boyut varyasyonları (kl. / gr. / 0,5 l …)
            </span>
            <div className="space-y-2">
              {draft.variants.map((variant, index) => (
                <div key={index} className="flex gap-2">
                  <TextInput
                    value={variant.size}
                    onChange={(e) => setVariant(index, { size: e.target.value })}
                    placeholder="kl."
                    aria-label={`Varyasyon ${index + 1} adı`}
                    className="flex-1"
                  />
                  <TextInput
                    inputMode="decimal"
                    value={variant.price}
                    onChange={(e) => setVariant(index, { price: e.target.value })}
                    placeholder="7,00"
                    aria-label={`Varyasyon ${index + 1} fiyatı`}
                    className="w-28"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        variants: draft.variants.filter((_, i) => i !== index),
                      })
                    }
                    aria-label={`Varyasyon ${index + 1} sil`}
                    className="focus-ring tag border border-line px-3 text-smoke hover:border-flame hover:text-flame transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setDraft({ ...draft, variants: [...draft.variants, { size: "", price: "" }] })
              }
              className="focus-ring tag border border-line px-3 py-2 mt-2 text-smoke hover:border-amber hover:text-amber transition-colors"
            >
              + VARYASYON EKLE
            </button>
          </div>

          <div className="flex flex-wrap gap-3">
            <Toggle
              checked={draft.active}
              onChange={(v) => set("active", v)}
              onLabel="AKTİF — SİTEDE GÖRÜNÜR"
              offLabel="PASİF — SİTEDE GİZLİ"
            />
            <Toggle
              checked={draft.inStock}
              onChange={(v) => set("inStock", v)}
              onLabel="STOKTA"
              offLabel="TÜKENDİ"
            />
            <Toggle
              checked={draft.showOnHome}
              onChange={(v) => set("showOnHome", v)}
              onLabel="MENÜDE GÖSTER"
              offLabel="MENÜDE GİZLE"
            />
            <Toggle
              checked={draft.featured}
              onChange={(v) => set("featured", v)}
              onLabel="ÖNE ÇIKAN — VİTRİNDE"
              offLabel="ÖNE ÇIKAN DEĞİL"
            />
          </div>

          <p className="text-xs text-smoke/70 border border-line bg-void px-4 py-3">
            Ürünün müşteri menüsünde görünmesi için üç anahtarın da açık olması
            gerekir: aktif, stokta ve menüde göster. Biri kapatıldığında ürün
            kaydedilir kaydedilmez menüden düşer; tekrar açıldığında geri gelir.
          </p>

          <p className="text-xs text-smoke/70 border border-line bg-void px-4 py-3">
            <span className="text-amber">Öne çıkan</span> ayrı bir şeydir: ürünü
            menüde tutmaz, ana sayfadaki ve karta sayfasının üstündeki kısa
            vitrine alır. Menüden düşmüş bir ürün işaretli olsa bile vitrinde
            görünmez. Hiçbir ürün işaretlenmemişse vitrin menü sırasına göre
            kendiliğinden doldurulur.
          </p>

          {/* --------------------------------------------- yasal bilgi */}
          <div className="border-t border-line pt-6">
            <h3 className="font-display text-sm font-bold text-bone">Yasal bilgi</h3>
            <p className="mt-1.5 mb-4 max-w-[70ch] text-xs leading-relaxed text-smoke">
              Bu alanlar menüde ve fişte doğrudan görünür. Alerjen bildirimi
              (LMIV Ek II) sipariş <strong className="text-bone">bağlayıcı hale
              gelmeden önce</strong> verilmek zorundadır; katkı maddesi bildirimi
              (ZZulV) yazılı olmak zorundadır — &quot;personele sorunuz&quot; katkı
              maddelerinde geçerli bir bildirim değildir.
            </p>

            <div className="space-y-4">
              <Field
                label="KDV oranı"
                hint="Yemek %7, içecek %19 (§ 12 Abs. 2 Nr. 15 UStG, 01.01.2026'dan beri). Fişte ve KDV dökümünde bu oran görünür."
              >
                <Select
                  value={String(draft.vatRate)}
                  onChange={(e) => set("vatRate", Number(e.target.value))}
                  className="sm:max-w-[280px]"
                >
                  {VAT_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      %{rate} — {rate === 7 ? "yemek" : "içecek"}
                    </option>
                  ))}
                </Select>
              </Field>

              <CheckGrid
                legend="Alerjenler (LMIV Ek II)"
                hint="Üründe bulunan maddeleri işaretleyin. Hiçbiri yoksa aşağıdaki beyanı açın — boş liste tek başına 'madde yok' anlamına gelmez."
                options={ALLERGEN_OPTIONS}
                selected={draft.allergens}
                onChange={(next) => set("allergens", next)}
              />

              <CheckGrid
                legend="Katkı maddeleri (ZZulV)"
                hint="İşlevsel sınıf yeterlidir, tek tek E-numarası gerekmez."
                options={ADDITIVE_OPTIONS}
                selected={draft.additives}
                onChange={(next) => set("additives", next)}
              />

              <div className="flex flex-wrap gap-3">
                {/*
                  Bu anahtar "boş liste" ile "madde yok"u ayırır ve bilinçli bir
                  beyandır: kapalıyken ürün menüde "lütfen sorunuz" uyarısıyla
                  çıkar, açıkken "bildirimi zorunlu madde içermez" der. İkisini
                  karıştırmak alerjik müşteride doğrudan sağlık riski.
                */}
                <Toggle
                  checked={draft.allergenInfoConfirmed}
                  onChange={(v) => set("allergenInfoConfirmed", v)}
                  onLabel="BEYAN EDİLDİ — BİLDİRİMİ ZORUNLU MADDE YOK"
                  offLabel="BEYAN EDİLMEDİ — BİLGİ EKSİK"
                />
                <Toggle
                  checked={draft.isPerishable}
                  onChange={(v) => set("isPerishable", v)}
                  onLabel="ÇABUK BOZULAN — CAYMA HAKKI İSTİSNASI"
                  offLabel="ÇABUK BOZULMAZ — CAYMA HAKKI VAR"
                />
              </div>

              {!hasLegalInfo({
                allergens: draft.allergens,
                allergenInfoConfirmed: draft.allergenInfoConfirmed,
              }) && (
                <Notice
                  kind="error"
                  message="Bu üründe alerjen bilgisi eksik: ya en az bir madde işaretleyin ya da 'bildirimi zorunlu madde yok' beyanını açın. Eksik bırakılırsa ürün menüde uyarıyla görünür."
                />
              )}

              <p className="border border-line bg-void px-4 py-3 text-xs leading-relaxed text-smoke/70">
                <span className="text-amber">Çabuk bozulan</span> işareti cayma
                hakkıyla ilgilidir (§ 312g Abs. 2 Nr. 1 BGB): hazırlanan yemek
                istisnaya girer, kapalı şişe içecek girmez — içecek eklerken bu
                işaret kaldırılmalı.
              </p>
            </div>
          </div>

          {error && <Notice kind="error" message={error} />}
        </div>

        <div className="flex flex-wrap gap-3 justify-end mt-9 pt-6 border-t border-line">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="focus-ring tag border border-line text-bone px-4 py-2.5 font-semibold hover:border-amber hover:text-amber transition-colors disabled:opacity-40"
          >
            VAZGEÇ
          </button>
          <Button type="submit" disabled={busy}>
            {busy ? "KAYDEDİLİYOR…" : "KAYDET"}
          </Button>
        </div>
      </form>
      </div>
    </div>
  );
}
