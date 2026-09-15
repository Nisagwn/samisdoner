"use client";

import { useEffect, useState } from "react";
import type { MenuStatus } from "@/app/api/menu/status/route";
import { formatMinute, formatRange, hoursForWeekday, nextOpening } from "@/lib/menu/opening";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Notice } from "@/components/ui";

/**
 * Menünün başındaki durum bandı.
 *
 * Dükkân açıkken **hiçbir şey çizmez**: "şu an açığız" bandı her ziyarette
 * yer kaplayan ama hiçbir karar değiştirmeyen bir gürültüdür. Bant yalnızca
 * sipariş verilemiyorken görünür ve iki şeyi birden söyler: neden olmuyor ve
 * ne zaman olacak.
 *
 * "Ne zaman" kısmı bandın asıl işi. Yalnızca "geschlossen" yazan bir sayfa,
 * müşteriyi sekmeyi kapatmaya gönderir; "yarın 11:00'de açılıyoruz, sepetini
 * şimdi hazırlayabilirsin" diyen bir bant, sepetin dolmaya devam etmesini
 * sağlar. Sepet zaten localStorage'da yaşıyor (bkz. lib/cart.tsx), yani ön
 * sipariş için ek bir mekanizmaya gerek yok — sadece söylemek gerekiyordu.
 *
 * Durum sunucudan gelir ve karar orada verilir (`lib/orders/availability.ts`);
 * burada yalnızca gösterim var.
 */
export default function MenuStatusBanner({ className = "" }: { className?: string }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<MenuStatus | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/menu/status", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("status"))))
      .then((data: MenuStatus) => setStatus(data))
      .catch(() => {
        // Durum okunamadıysa bant hiç çizilmez: yanlış bir "kapalıyız" uyarısı,
        // hiç uyarı olmamasından daha zararlı. Kesin karar zaten sipariş
        // oluşturulurken sunucuda veriliyor.
      });

    return () => controller.abort();
  }, []);

  if (!status) return null;
  if (status.orderingEnabled && status.open) return null;

  const paused = !status.orderingEnabled;
  const s = t.ordering.status;

  // Bugünün aralıkları — kapalıyken de yararlı: "bugün 11:00–21:00" satırı,
  // müşterinin saat kaçta uğrayabileceğini tek bakışta söyler.
  const todayRanges = hoursForWeekday(status.hours, status.now.weekday);
  const todayLine =
    todayRanges.length > 0
      ? s.todayHours.replace("{hours}", todayRanges.map(formatRange).join(", "))
      : s.closedToday;

  const next = paused ? null : nextOpening(status.hours, status.closedDates, status.now);
  const nextLine = (() => {
    if (paused) return s.pausedText;
    if (!next) return s.opensUnknown;
    const time = formatMinute(next.minute);
    if (next.daysAhead === 0) return s.opensToday.replace("{time}", time);
    if (next.daysAhead === 1) return s.opensTomorrow.replace("{time}", time);
    return s.opensWeekday
      .replace("{weekday}", s.weekdays[next.weekday] ?? "")
      .replace("{time}", time);
  })();

  return (
    <Notice tone="warn" title={paused ? s.pausedTitle : s.closedTitle} className={className}>
      <p>{nextLine}</p>
      {!paused && (
        <>
          <p className="mt-1 text-smoke">{todayLine}</p>
          {/* Ön siparişin mümkün olduğunu söylemek bandın varlık sebebi. */}
          <p className="mt-2 text-smoke">{s.closedText}</p>
        </>
      )}
    </Notice>
  );
}
