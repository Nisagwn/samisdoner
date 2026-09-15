"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MenuItem, MenuVariant } from "@/data/speisekarte";
import { formatCents } from "@/lib/money";
import {
  choiceLabel,
  defaultSelection,
  groupLabel,
  isRequiredGroup,
  isSingleChoice,
  missingRequiredGroups,
  normalizeNote,
  normalizeSelection,
  selectionSurchargeCents,
  type OptionGroup,
} from "@/lib/menu/options";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { useScrollLock } from "@/lib/useScrollLock";
import { Button, QtyStepper, TextArea } from "@/components/ui";
import ProductBadges from "@/components/ProductBadges";
import AllergenWarning from "@/components/legal/AllergenWarning";

/**
 * Ürün penceresi — "ne alıyorum" sorusunun tek cevap yeri.
 *
 * Menü satırı bir ürünü **tanıtır**; bu pencere onu **yapılandırır**: boy, et
 * türü, soslar, ekstralar, adet ve mutfağa not. Ayrı bir sayfa değil bir
 * pencere olması bilinçli — müşteri menüdeki yerini kaybetmeden seçim yapıp
 * listeye geri dönebilmeli, özellikle telefonda.
 *
 * FİYAT
 *
 * Penceredeki tutar bir **ön izlemedir**, tahsil edilen tutar değil: taban
 * fiyat + seçilen ek ücretler, adetle çarpılır. Aynı hesap sunucuda
 * (`priceProductLine`) birebir tekrarlanır ve sepetteki satır fiyatı oradan
 * gelir. Ekranda sessiz bir toplam göstermemek için burada da yapılıyor —
 * "ekstra peynir ne kadar tutuyor" sorusunun cevabı sepete eklemeden önce
 * görünmeli (PAngV § 3: müşteri toplam fiyatı sipariş öncesinde bilmeli).
 *
 * ERİŞİLEBİLİRLİK
 *
 * Pencere klavyeyle açılıp kapanır (Esc), odak içeride tuzaklanır ve Tab
 * döngüsü pencerenin dışına çıkmaz. Zorunlu gruplar `aria-required` ile
 * işaretlenir, eksik seçim düğmeyi kilitler ve sebebi `role="alert"` ile
 * okunur — kilitli bir düğmeyi sebepsiz bırakmak, ekran okuyucu kullanan
 * müşteriyi çıkmaza sokar.
 */

export type ProductDraft = {
  variantSize?: string;
  options: string[];
  note: string;
  qty: number;
};

type Props = {
  item: MenuItem;
  /** "add" sepete ekler, "edit" mevcut satırı değiştirir; fark yalnızca düğme yazısında. */
  mode: "add" | "edit";
  /** Düzenlemede satırın mevcut hâli; eklemede varsayılanlar kullanılır. */
  initial?: Partial<ProductDraft>;
  onClose: () => void;
  onSubmit: (draft: ProductDraft) => void;
};

/** Odak tuzağının hedef alabileceği elemanlar. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

export default function ProductDialog({ item, mode, initial, onClose, onSubmit }: Props) {
  const { t, lang } = useLanguage();
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  const groups: OptionGroup[] = useMemo(() => item.optionGroups ?? [], [item.optionGroups]);
  const variants: MenuVariant[] = useMemo(() => item.variants ?? [], [item.variants]);

  const [variantSize, setVariantSize] = useState<string | undefined>(
    () => initial?.variantSize ?? variants[0]?.size
  );
  const [options, setOptions] = useState<string[]>(
    () => initial?.options ?? defaultSelection(groups)
  );
  const [note, setNote] = useState(() => initial?.note ?? "");
  const [qty, setQty] = useState(() => Math.max(1, initial?.qty ?? 1));
  /** Kilitli düğmeye basıldığında eksik grupları görünür kılar. */
  const [showErrors, setShowErrors] = useState(false);

  useScrollLock(true);

  // Pencere açılınca odak içeri alınır; kapanınca çağıran tarafın odağı geri
  // vermesi gerekmesin diye kapatma düğmesi seçilir (listeye dönen odak,
  // satırın kendisinde zaten duruyor).
  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const root = dialog.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null
      );
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Döngü elle kapatılır: pencere `position: fixed` olduğu için tarayıcı
      // sıradaki odağı arkadaki menüde arar ve müşteri pencereden "düşer".
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const name = lang === "tr" ? item.nameTr ?? item.name : item.name;
  const desc = lang === "tr" ? item.descTr ?? item.desc : item.desc;
  const dialogLang: "tr" | "de" = lang === "tr" ? "tr" : "de";

  const selectedVariant = variants.find((v) => v.size === variantSize) ?? variants[0];
  const baseCents = selectedVariant?.priceCents ?? item.baseCents ?? 0;
  const unitCents = baseCents + selectionSurchargeCents(groups, options);
  const totalCents = unitCents * qty;

  const missing = missingRequiredGroups(groups, options);
  const blocked = missing.length > 0;

  function toggle(group: OptionGroup, choiceId: string) {
    setOptions((prev) => {
      const inGroup = new Set(group.choices.map((c) => c.id));
      const others = prev.filter((id) => !inGroup.has(id));
      const mine = prev.filter((id) => inGroup.has(id));

      if (isSingleChoice(group)) {
        /*
         * Tek seçimde ikinci kez basmak seçimi kaldırır — ama yalnızca grup
         * isteğe bağlıysa. Zorunlu grupta "seçimi kaldır" diye bir durum yok:
         * müşteri fikrini değiştirirse başka bir seçeneğe basar.
         */
        if (mine[0] === choiceId && !isRequiredGroup(group)) return others;
        return normalizeSelection(groups, [...others, choiceId]);
      }

      if (mine.includes(choiceId)) {
        return normalizeSelection(groups, [...others, ...mine.filter((id) => id !== choiceId)]);
      }
      // Üst sınır dolduysa yeni seçim eklenmez; düğme zaten kilitli görünür.
      if (mine.length >= group.maxSelect) return prev;
      return normalizeSelection(groups, [...others, ...mine, choiceId]);
    });
    setShowErrors(false);
  }

  function submit() {
    if (blocked) {
      setShowErrors(true);
      return;
    }
    onSubmit({
      ...(selectedVariant ? { variantSize: selectedVariant.size } : {}),
      options: normalizeSelection(groups, options),
      note: normalizeNote(note),
      qty,
    });
  }

  /** Grup başlığının altındaki seçim sayısı kuralı. */
  function ruleText(group: OptionGroup): string {
    const { minSelect, maxSelect } = group;
    if (minSelect > 0 && minSelect === maxSelect) {
      return t.ordering.item.chooseExactly.replace("{min}", String(minSelect));
    }
    if (minSelect > 0) {
      return t.ordering.item.chooseMinMax
        .replace("{min}", String(minSelect))
        .replace("{max}", String(maxSelect));
    }
    return t.ordering.item.chooseUpTo.replace("{max}", String(maxSelect));
  }

  return (
    <div
      className="fixed inset-0 z-[80] overflow-y-auto overscroll-contain bg-void/85 backdrop-blur-sm"
      // Dış yüzeye tıklamak kapatır; içeriye tıklamak kapatmaz. `onClick`
      // hedefi kontrol edilmeseydi, pencere içindeki her tıklama kapatırdı.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* Kaydırma dış kutuda, ortalama içte: uzun seçenek listesinde pencerenin
          üstü ekranın dışına itilmesin. */}
      <div className="flex min-h-full items-end justify-center p-0 sm:items-center sm:p-6">
        <div
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-dialog-title"
          className="ember-surface w-full max-w-[560px] border border-line shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        >
          {/* başlık */}
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 md:px-7 md:py-5">
            <div className="min-w-0">
              {item.no && (
                <p className="font-mono text-xs text-flame tabular-nums">{item.no}</p>
              )}
              <h2
                id="product-dialog-title"
                className="font-display text-xl font-extrabold leading-tight text-bone md:text-2xl"
              >
                {name}
              </h2>
              <ProductBadges item={item} className="mt-2" />
            </div>
            <button
              ref={closeButton}
              type="button"
              onClick={onClose}
              aria-label={t.ordering.item.close}
              className="focus-ring h-11 w-11 shrink-0 border border-line text-smoke transition-colors hover:border-amber hover:text-amber"
            >
              ✕
            </button>
          </div>

          <div className="max-h-[68vh] overflow-y-auto overscroll-contain px-5 py-5 md:px-7">
            {item.image && (
              <div className="relative mb-5 aspect-[16/9] overflow-hidden border border-line bg-panel">
                <Image
                  src={item.image}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 100vw, 560px"
                  className="object-cover"
                />
              </div>
            )}

            {desc && <p className="text-sm leading-relaxed text-smoke">{desc}</p>}

            {/* boy seçimi — seçenek gruplarıyla aynı görsel dilde */}
            {variants.length > 0 && (
              <fieldset className="mt-6 border-t border-line pt-5">
                <legend className="tag text-bone">{t.menuGrid.sizeLabel}</legend>
                <p className="tag mt-1 text-smoke/70">{t.ordering.item.required}</p>
                <div className="mt-3 space-y-2">
                  {variants.map((variant) => (
                    <label
                      key={variant.size}
                      className={`flex cursor-pointer items-center gap-3 border px-3 py-3 transition-colors ${
                        variant.size === selectedVariant?.size
                          ? "border-amber bg-amber/10"
                          : "border-line hover:border-smoke"
                      }`}
                    >
                      <input
                        type="radio"
                        name="product-dialog-size"
                        value={variant.size}
                        checked={variant.size === selectedVariant?.size}
                        onChange={() => setVariantSize(variant.size)}
                        className="focus-ring h-4 w-4 shrink-0 accent-[#FFC247]"
                      />
                      <span className="min-w-0 flex-1 text-sm text-bone">{variant.size}</span>
                      <span className="shrink-0 font-mono text-sm text-amber tabular-nums">
                        {variant.price}
                      </span>
                    </label>
                  ))}
                </div>
                {/* PAngV § 4: hacme göre satılan boyda litre fiyatı görünmeli. */}
                {selectedVariant?.grundpreis && (
                  <p className="mt-2 font-mono text-[11px] text-smoke tabular-nums">
                    ({selectedVariant.grundpreis})
                  </p>
                )}
              </fieldset>
            )}

            {/* seçenek grupları */}
            {groups.map((group) => {
              const chosen = group.choices.filter((c) => options.includes(c.id));
              const single = isSingleChoice(group);
              const required = isRequiredGroup(group);
              const atMax = !single && chosen.length >= group.maxSelect;
              const isMissing = showErrors && missing.some((g) => g.id === group.id);

              return (
                <fieldset
                  key={group.id}
                  className="mt-6 border-t border-line pt-5"
                  aria-required={required || undefined}
                  aria-invalid={isMissing || undefined}
                >
                  <legend className="tag text-bone">{groupLabel(group, dialogLang)}</legend>
                  <p className="tag mt-1 text-smoke/70">
                    {required ? t.ordering.item.required : t.ordering.item.optional}
                    <span className="text-smoke/40"> · </span>
                    {ruleText(group)}
                    {!single && (
                      <>
                        <span className="text-smoke/40"> · </span>
                        {t.ordering.item.selectedCount
                          .replace("{count}", String(chosen.length))
                          .replace("{max}", String(group.maxSelect))}
                      </>
                    )}
                  </p>

                  <div className="mt-3 space-y-2">
                    {group.choices.map((choice) => {
                      const checked = options.includes(choice.id);
                      // Üst sınır dolduğunda yalnızca **seçilmemiş** kutular
                      // kilitlenir; seçilileri kilitlemek müşteriyi seçimini
                      // geri alamaz hâle getirirdi.
                      const disabled = atMax && !checked;

                      return (
                        <label
                          key={choice.id}
                          className={`flex items-center gap-3 border px-3 py-3 transition-colors ${
                            checked ? "border-amber bg-amber/10" : "border-line"
                          } ${
                            disabled
                              ? "cursor-not-allowed opacity-40"
                              : "cursor-pointer hover:border-smoke"
                          }`}
                        >
                          <input
                            type={single ? "radio" : "checkbox"}
                            name={single ? `group-${group.id}` : undefined}
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggle(group, choice.id)}
                            className="focus-ring h-4 w-4 shrink-0 accent-[#FFC247]"
                          />
                          <span className="min-w-0 flex-1 text-sm text-bone">
                            {choiceLabel(choice, dialogLang)}
                          </span>
                          <span className="shrink-0 font-mono text-xs tabular-nums text-smoke">
                            {choice.priceCents > 0
                              ? `+ ${formatCents(choice.priceCents)}`
                              : t.ordering.item.included}
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  {isMissing && (
                    <p role="alert" className="mt-2 text-xs text-flame">
                      {t.ordering.item.missingRequired.replace(
                        "{group}",
                        groupLabel(group, dialogLang)
                      )}
                    </p>
                  )}
                </fieldset>
              );
            })}

            {/* mutfağa not */}
            <div className="mt-6 border-t border-line pt-5">
              <label htmlFor="product-dialog-note" className="tag mb-2 block text-bone">
                {t.ordering.item.noteLabel}
              </label>
              <TextArea
                id="product-dialog-note"
                value={note}
                maxLength={140}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t.ordering.item.notePlaceholder}
                className="min-h-[72px]"
              />
              <p className="mt-1.5 text-xs text-smoke/70">{t.ordering.item.noteHint}</p>
            </div>

            {/* Alerjen bildirimi ürün seviyesinde de görünür: menünün en
                altındaki tek uyarıyı, pencereden sipariş veren müşteri hiç
                görmeyebilir (LMIV Art. 14 mesafeli satışta bilginin sipariş
                anında erişilebilir olmasını ister). */}
            <div className="mt-6">
              <AllergenWarning />
            </div>
          </div>

          {/* alt şerit: adet, canlı toplam, ekle */}
          <div className="border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-7">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <p className="tag text-smoke">{t.ordering.item.qtyLabel}</p>
                <div className="mt-2">
                  <QtyStepper
                    qty={qty}
                    onChange={(next) => setQty(Math.max(1, next))}
                    labels={{ decrease: t.cart.decreaseQty, increase: t.cart.increaseQty }}
                  />
                </div>
              </div>
              <div className="text-right">
                <p className="tag text-smoke">{t.ordering.item.unitPrice}</p>
                <p className="font-mono text-sm text-smoke tabular-nums">
                  {formatCents(unitCents)}
                </p>
              </div>
            </div>

            {showErrors && blocked && (
              <p role="alert" className="mb-3 text-xs text-flame">
                {t.ordering.item.missingRequired.replace(
                  "{group}",
                  groupLabel(missing[0], dialogLang)
                )}
              </p>
            )}

            <Button
              type="button"
              variant="primary"
              onClick={submit}
              // Düğme `disabled` YAPILMAZ: kilitli düğmeye odaklanılamaz ve
              // sebebi duyurulamaz. Bunun yerine basılabilir kalır, basınca
              // eksik grubu işaretler ve pencere oraya kaydırılır.
              aria-disabled={blocked || undefined}
              className={`w-full ${blocked ? "opacity-60" : ""}`}
            >
              {(mode === "edit"
                ? t.ordering.item.saveChanges
                : t.ordering.item.addForTotal
              ).replace("{amount}", formatCents(totalCents))}
            </Button>

            <p className="mt-3 text-[11px] leading-relaxed text-smoke/60">
              {t.ordering.item.priceNote}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
