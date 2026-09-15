"use client";

import { Field, Select } from "@/components/ui";
import type { OrderOptions } from "@/app/api/orders/options/route";
import type { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * Teslim zamanı seçimi — "en kısa sürede" ya da ileri saat (Vorbestellung).
 *
 * Referans (Lieferando): müşteri tahmini varış saatine dokununca saatler
 * listeleniyor; seçilebilir saatler aynı gün ve açılış saatleri içinde
 * kalıyor. Liste sunucudan geliyor (`/api/orders/options`) — tarayıcının
 * saatine, diline ve zaman dilimine göre saat üretmek, Berlin'de akşam 8
 * olduğunu sanan bir telefonun sahibine yanlış saatler göstermek olurdu.
 *
 * Dükkân kapalıyken **yalnızca** ön sipariş seçilebilir: kapalıyken sipariş
 * almanın tek meşru biçimi bu. Kutu o durumda kendiliğinden ileri saate
 * geçer ve "en kısa sürede" seçeneği devre dışı kalır.
 *
 * Tarih/saat seçici olarak hazır bir kütüphane kullanılmadı: ihtiyaç duyulan
 * şey bir takvim değil, sunucunun verdiği listeden bir seçim — yani düz bir
 * `<select>`. Mobilde de yerel seçiciyi açtığı için en erişilebilir hâli bu.
 */
export function TimingPicker({
  options,
  mode,
  slot,
  onModeChange,
  onSlotChange,
  t,
}: {
  /** Sunucudan gelen seçenekler; henüz yüklenmediyse null. */
  options: OrderOptions | null;
  mode: "asap" | "scheduled";
  /** Seçili saatin ISO değeri; seçilmediyse boş. */
  slot: string;
  onModeChange: (next: "asap" | "scheduled") => void;
  onSlotChange: (iso: string) => void;
  t: ReturnType<typeof useLanguage>["t"];
}) {
  const slots = options?.slots ?? [];
  const closed = options !== null && !options.openNow;
  const asapDisabled = closed;

  return (
    <section aria-labelledby="timing-title" className="space-y-3">
      <h3 id="timing-title" className="tag text-smoke">
        {t.orderFlow.timingTitle}
      </h3>

      {closed && slots.length > 0 && (
        <p className="text-xs leading-relaxed text-amber">{t.orderFlow.timingClosedHint}</p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <TimingOption
          selected={mode === "asap"}
          disabled={asapDisabled}
          onSelect={() => onModeChange("asap")}
          title={t.orderFlow.timingAsap}
          hint={
            options
              ? t.orderFlow.timingAsapHint.replace("{minutes}", String(options.prepMinutes))
              : ""
          }
        />
        <TimingOption
          selected={mode === "scheduled"}
          disabled={options !== null && slots.length === 0}
          onSelect={() => onModeChange("scheduled")}
          title={t.orderFlow.timingScheduled}
          hint=""
        />
      </div>

      {mode === "scheduled" && (
        <Field label={t.orderFlow.timingSlotLabel} htmlFor="slot">
          {slots.length === 0 ? (
            <p className="text-sm text-flame">{t.orderFlow.timingNoSlots}</p>
          ) : (
            <Select id="slot" value={slot} onChange={(e) => onSlotChange(e.target.value)}>
              <option value="">{t.orderFlow.timingSlotPlaceholder}</option>
              {slots.map((entry) => (
                <option key={entry.iso} value={entry.iso}>
                  {entry.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
    </section>
  );
}

/**
 * Tek bir zaman seçeneği.
 *
 * `<button>` olarak yazıldı, radyo düğmesi olarak değil: dokunma hedefi tüm
 * kutu olmalı ve kutunun kendisi görsel olarak seçimi taşımalı. Erişilebilirlik
 * `aria-pressed` ile korunuyor.
 */
function TimingOption({
  selected,
  disabled,
  onSelect,
  title,
  hint,
}: {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={[
        "focus-ring flex min-h-[56px] flex-col justify-center border px-4 py-3 text-left transition-colors",
        selected
          ? "border-amber bg-amber/10 text-amber"
          : "border-line text-smoke hover:border-amber/60",
        disabled ? "cursor-not-allowed opacity-40" : "",
      ].join(" ")}
    >
      <span className="font-display text-sm font-extrabold">{title}</span>
      {hint && <span className="mt-0.5 font-mono text-[11px] opacity-80">{hint}</span>}
    </button>
  );
}
