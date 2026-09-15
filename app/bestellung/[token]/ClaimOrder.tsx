"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Bu siparişi hesabıma ekle" düğmesi.
 *
 * Yalnızca iki koşul birden doğruyken çizilir (karar sunucuda verilir):
 * kullanıcı giriş yapmış **ve** sipariş hâlâ misafir siparişi. İkisinden biri
 * yoksa düğmenin gösterecek bir işi yok.
 *
 * Kanıt olarak elde zaten imzalı takip jetonu var, o gönderiliyor: müşteriden
 * sipariş numarası ve telefon istemek, elindeki daha güçlü kanıtı yok sayıp
 * daha zayıfını istemek olurdu (bkz. lib/account/claim.ts).
 */
export default function ClaimOrder({
  token,
  label,
  doneLabel,
  errorLabel,
}: {
  token: string;
  label: string;
  doneLabel: string;
  errorLabel: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");

  async function claim() {
    setState("busy");
    try {
      const response = await fetch("/api/account/claim-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        setState("failed");
        return;
      }
      setState("done");
      // Sayfa sunucuda üretiliyor: bağlandıktan sonra düğme kaybolsun.
      router.refresh();
    } catch {
      setState("failed");
    }
  }

  if (state === "done") {
    return (
      <p role="status" className="tag border border-herb/50 bg-herb/10 px-4 py-3 text-herb">
        {doneLabel}
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void claim()}
      disabled={state === "busy"}
      className="focus-ring tag min-h-[48px] border border-line px-5 py-3 text-smoke transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
    >
      {state === "failed" ? errorLabel : label}
    </button>
  );
}
