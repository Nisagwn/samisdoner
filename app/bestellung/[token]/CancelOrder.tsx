"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "Bestellung stornieren" — müşterinin kendi iptali.
 *
 * İki adım: düğme → onay. Tek tıkla iptal, yanlışlıkla dokunulan bir düğmenin
 * akşam yemeğini iptal etmesi demek olurdu; tarayıcının `confirm()` penceresi
 * ise mobilde sayfanın dışına çıkar ve iptalin sonucunu (para iade edilecek)
 * anlatacak yer bırakmaz.
 *
 * Karar burada verilmiyor: düğmenin görünüp görünmeyeceğine sunucu bileşeni
 * `customerCancelWindow` ile karar veriyor, iptalin gerçekten yapılabilir
 * olduğunu da uç yeniden denetliyor. Bu bileşen yalnızca isteği atar ve
 * cevabı gösterir.
 */

type Labels = {
  title: string;
  hint: string;
  confirm: string;
  confirmYes: string;
  confirmNo: string;
  pending: string;
  tooLate: string;
  failed: string;
  refundFailed: string;
};

export function CancelOrder({ token, labels }: { token: string; labels: Labels }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/orders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (response.ok) {
        /*
         * Sayfayı tazele: durum artık CANCELLED, sunucu bileşeni iptal
         * bildirimini ve iade bilgisini kendisi gösterecek. Burada ikinci bir
         * "iptal edildi" kutusu çizmek, aynı bilgiyi iki yerden anlatmak
         * olurdu.
         */
        router.refresh();
        return;
      }

      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (data?.error === "already_accepted") setError(labels.tooLate);
      else if (data?.error === "refund_failed") setError(labels.refundFailed);
      else setError(labels.failed);
    } catch {
      setError(labels.failed);
    }

    setBusy(false);
    setAsking(false);
  }

  if (error) {
    return (
      <p role="alert" className="text-sm leading-relaxed text-sumac">
        {error}
      </p>
    );
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="focus-ring border border-line px-4 py-2.5 font-display text-xs font-extrabold tracking-wider text-smoke transition-colors hover:border-sumac hover:text-sumac"
      >
        {labels.title}
      </button>
    );
  }

  return (
    <div className="w-full border border-sumac bg-char p-4">
      <p className="text-sm leading-relaxed text-bone">{labels.confirm}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="focus-ring border border-sumac px-4 py-2.5 font-display text-xs font-extrabold tracking-wider text-sumac transition-colors hover:bg-sumac hover:text-void disabled:opacity-40"
        >
          {busy ? labels.pending : labels.confirmYes}
        </button>
        <button
          type="button"
          onClick={() => setAsking(false)}
          disabled={busy}
          className="focus-ring border border-line px-4 py-2.5 font-display text-xs font-extrabold tracking-wider text-smoke transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
        >
          {labels.confirmNo}
        </button>
      </div>
    </div>
  );
}
