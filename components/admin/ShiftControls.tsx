"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Vardiya şeridi — sipariş panosunun üstünde duran "yoğunuz / duraklat" kutusu.
 *
 * Aynı iki ayar (sipariş anahtarı ve hazırlık süresi) İşletme ekranında da
 * var. Burada tekrar edilmesinin sebebi kopya değil **mesafe**: cumartesi
 * akşamı yirmi sipariş birikmişken mutfaktaki kişi menüden başka bir ekrana
 * gidip formu doldurup kaydete basmaz — panoyu kapatmayan tek dokunuşluk bir
 * yol olmazsa o ayar hiç kullanılmaz ve müşteriye tutulamayacak saatler söz
 * verilmeye devam eder.
 *
 * İki ayrı eylem ve ikisi de farklı sertlikte:
 *
 *  - **Yoğunuz**: hazırlık süresini yükseltir. Sipariş almaya devam edilir,
 *    yalnızca verilen söz gerçeğe yaklaşır. Yoğunluğun doğru cevabı çoğu zaman
 *    budur; kapatmak cironun tamamını keser.
 *  - **Duraklat**: sipariş alımını kapatır. Tezgâh gerçekten yetişemiyorsa ya
 *    da malzeme bittiyse. Geri açmak da aynı düğme — kapalı kaldığı her dakika
 *    ekranda yazar, unutulmasın diye.
 *
 * Süre seçenekleri **mutlak** değer yazar, mevcut sürenin üstüne eklemez:
 * "+10 dk"ya üç kez basan biri farkında olmadan bir saatlik hazırlık süresi
 * kurabilirdi. Ekranda hangi değerin geçerli olduğu her zaman görünür.
 */

/** Yoğunluk kademeleri (dakika). Normal gün için 20–30, yoğun akşam için 45–60. */
const PREP_STEPS = [20, 30, 45, 60, 90] as const;

type BusinessState = {
  orderingEnabled: boolean;
  prepMinutes: number;
  openNow: boolean;
};

export default function ShiftControls() {
  const [state, setState] = useState<BusinessState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/admin/business", { signal, cache: "no-store" });
      if (!response.ok) return;
      setState((await response.json()) as BusinessState);
    } catch {
      // Geçici arıza: şerit son bilinen değerde kalır. Panonun kendi bağlantı
      // uyarısı zaten var, ikinci bir alarm yalnızca gürültü olurdu.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "settings", ...body }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Değişiklik kaydedilemedi.");
        return;
      }
      // Gerçek durumu sunucudan tazele: başka bir cihazdan da değiştirilmiş
      // olabilir ve iyimser güncelleme burada yanlış cevabı ekranda bırakırdı.
      await load();
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  const paused = !state.orderingEnabled;

  return (
    <div
      className={`border p-4 ${
        paused ? "border-flame bg-flame/10" : "border-line bg-char"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`tag border px-3 py-1.5 ${
            paused
              ? "animate-pulse border-flame bg-flame text-void"
              : "border-herb/60 bg-herb/10 text-herb"
          }`}
        >
          {paused ? "● SİPARİŞ ALIMI DURDURULDU" : "● SİPARİŞ ALIMI AÇIK"}
        </span>

        {/* Anahtar açık olsa bile saat dışındaysak sipariş gelmez; ikisini
            ayrı söylemek "açık ama sipariş yok" şaşkınlığını önlüyor. */}
        {!paused && !state.openNow && (
          <span className="tag border border-amber/60 bg-amber/10 px-3 py-1.5 text-amber">
            Çalışma saati dışında
          </span>
        )}

        <button
          type="button"
          onClick={() => void patch({ orderingEnabled: paused })}
          disabled={busy}
          /* Mutfakta tabletle dokunulur: 48px'lik hedef ve okunur kontrast. */
          className={`focus-ring tag ml-auto min-h-[48px] border px-4 py-2.5 font-semibold transition-colors disabled:opacity-40 ${
            paused
              ? "border-herb bg-herb/15 text-herb hover:bg-herb hover:text-void"
              : "border-flame/60 text-flame hover:bg-flame hover:text-void"
          }`}
        >
          {paused ? "SİPARİŞ ALMAYA DEVAM ET" : "SİPARİŞİ DURAKLAT"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
        <span className="tag text-smoke">
          Hazırlık süresi — şu an{" "}
          <strong className="text-bone tabular-nums">{state.prepMinutes} dk</strong>
        </span>
        {PREP_STEPS.map((minutes) => {
          const current = state.prepMinutes === minutes;
          return (
            <button
              key={minutes}
              type="button"
              onClick={() => void patch({ prepMinutes: minutes })}
              disabled={busy || current}
              aria-pressed={current}
              className={`focus-ring min-h-[48px] min-w-[64px] border px-3 py-2 font-display text-base font-extrabold tabular-nums transition-colors disabled:pointer-events-none ${
                current
                  ? "border-amber bg-amber text-void"
                  : "border-line text-smoke hover:border-amber hover:text-amber"
              }`}
            >
              {minutes}
              <span className="ml-1 text-[11px] font-semibold">dk</span>
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-smoke/70">
        Bu süre yeni siparişlere verilen tahmini teslim saatini belirler. Akıştaki
        siparişleri değiştirmez — onlar için kartın altındaki &quot;Gecikme bildir&quot;
        kullanılır.
      </p>

      {error && (
        <p role="alert" className="mt-3 border border-flame/60 bg-flame/10 px-3 py-2 text-sm text-flame">
          {error}
        </p>
      )}
    </div>
  );
}
