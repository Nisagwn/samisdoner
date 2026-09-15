"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";
import { TIP_PRESET_PERCENTS, maxTipFor, parseTipInput, tipForPercent } from "@/lib/orders/tip";
import { Field, TextInput } from "@/components/ui";
import type { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * Trinkgeld — hazır yüzdeler + serbest tutar.
 *
 * Referans (Lieferando, Wolt, Uber Eats): hazır düğmeler kararı kolaylaştırır,
 * serbest alan "tam 2 €" demek isteyeni engellemez. Wolt bir adım daha ileri
 * gidip bahşişi siparişten sonra geri alınamaz sayıyor; bizde de aynı — sipariş
 * kayıtları append-only, verilen bahşiş yerinde kalır. İşletme siparişi iptal
 * ederse tahsil edilen tutarın **tamamı** (bahşiş dahil) iade edilir.
 *
 * Tutar burada **hesaplanmaz**: düğmeye basınca yüzdenin cent karşılığı
 * `tipForPercent` ile bulunup yukarı bildirilir, gerçek tutarı sunucu
 * `/api/menu/quote` yanıtında geri söyler. Özette görünen sayı her zaman
 * sunucudan gelen sayıdır.
 *
 * Görünürlük: bahşiş yalnızca online ödemede sorulur. Kapıda ödemede müşteri
 * bahşişi elden veriyor; ekranda ikinci kez sormak, aynı parayı iki kez
 * istemek gibi görünür.
 */
export function TipSelector({
  subtotalCents,
  tipCents,
  onChange,
  t,
}: {
  subtotalCents: number;
  /** Sunucunun onayladığı bahşiş; düğme vurgusu buna bakar. */
  tipCents: number;
  onChange: (cents: number) => void;
  t: ReturnType<typeof useLanguage>["t"];
}) {
  /** Serbest alan açık mı. Hazır yüzdeye basılınca kapanır. */
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState("");

  const f = t.orderFlow;
  const maxCents = maxTipFor(subtotalCents);

  /** Bir hazır yüzde şu an seçili mi. */
  const activePercent = TIP_PRESET_PERCENTS.find(
    (percent) => !custom && tipForPercent(subtotalCents, percent) === tipCents
  );

  return (
    <section aria-labelledby="tip-title" className="space-y-2">
      <h3 id="tip-title" className="tag text-smoke">
        {f.tipTitle}
      </h3>
      <p className="text-xs leading-relaxed text-smoke/70">{f.tipHint}</p>

      <div className="flex flex-wrap gap-2">
        {TIP_PRESET_PERCENTS.map((percent) => {
          const cents = tipForPercent(subtotalCents, percent);
          return (
            <TipChip
              key={percent}
              selected={activePercent === percent}
              onSelect={() => {
                setCustom(false);
                setDraft("");
                onChange(cents);
              }}
              label={percent === 0 ? f.tipNone : `${percent} %`}
              sub={percent === 0 ? "" : formatCents(cents)}
            />
          );
        })}
        <TipChip
          selected={custom}
          onSelect={() => setCustom(true)}
          label={f.tipCustom}
          sub=""
        />
      </div>

      {custom && (
        <Field label={f.tipCustomLabel} htmlFor="tip">
          <TextInput
            id="tip"
            inputMode="decimal"
            value={draft}
            placeholder="2,50"
            onChange={(e) => {
              setDraft(e.target.value);
              // Kelepçe sunucudakiyle aynı fonksiyondan (`parseTipInput` →
              // `clampTip`): ekranda kabul edilen tutarla tahsil edilen tutar
              // ayrışmasın.
              onChange(parseTipInput(e.target.value, subtotalCents));
            }}
          />
          <p className="mt-1 text-[11px] text-smoke/60">
            {f.tipMaxHint.replace("{amount}", formatCents(maxCents))}
          </p>
        </Field>
      )}
    </section>
  );
}

function TipChip({
  selected,
  onSelect,
  label,
  sub,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        "focus-ring flex min-h-[44px] flex-col items-center justify-center border px-3 py-1.5 transition-colors",
        selected
          ? "border-amber bg-amber/10 text-amber"
          : "border-line text-smoke hover:border-amber/60",
      ].join(" ")}
    >
      <span className="font-display text-xs font-extrabold">{label}</span>
      {sub && <span className="font-mono text-[10px] opacity-70">{sub}</span>}
    </button>
  );
}
