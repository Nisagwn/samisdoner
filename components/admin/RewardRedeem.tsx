"use client";

import { useState } from "react";
import { Button } from "./ui";

/**
 * Damga kartı ödülünün kasada kullanılması.
 *
 * Sipariş panosunun içinde duruyor, ayrı bir ekranda değil: müşteri kodu
 * telefonda sipariş verirken ya da kapıda söylüyor, yani bu işin yapıldığı an
 * tam olarak panoya bakılan an. Ayrı bir menü satırına konsaydı, yoğun bir
 * akşamda kimse oraya gitmez ve ödül kâğıt üstünde kalırdı.
 *
 * Kutu katlanmış başlıyor: her gün kullanılan bir şey değil ve açıkta duran
 * bir metin kutusu panonun asıl işini — siparişleri — aşağı iter.
 */
export default function RewardRedeem() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function redeem(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/loyalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string; customerName?: string }
        | null;

      if (!response.ok) {
        setResult({ ok: false, message: data?.error ?? "İşlem tamamlanamadı." });
        return;
      }
      setResult({
        ok: true,
        message: `Ödül kullanıldı — ${data?.customerName ?? "müşteri"}. Bedava ürünü verebilirsiniz.`,
      });
      setCode("");
    } catch {
      setResult({ ok: false, message: "Sunucuya ulaşılamadı." });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring tag min-h-[44px] border border-line px-4 py-2 text-smoke transition-colors hover:border-amber hover:text-amber"
      >
        ★ ÖDÜL KODU GİR
      </button>
    );
  }

  return (
    <div className="w-full border border-line bg-char p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="tag text-amber">Damga kartı ödülü</p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
          }}
          className="focus-ring tag text-smoke transition-colors hover:text-bone"
        >
          KAPAT ✕
        </button>
      </div>

      <form onSubmit={redeem} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block min-w-[200px] flex-1">
          <span className="tag mb-1.5 block text-smoke">Müşterinin kodu</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            autoFocus
            placeholder="SD-7K4M-2QX9"
            /* Kod tezgâhta telefondan okunuyor: büyük, aralıklı ve tek tip
               genişlikte yazı, yanlış okunan bir karakteri azaltır. */
            className="focus-ring min-h-[48px] w-full border border-line bg-void px-3.5 py-2.5 font-display text-lg font-bold tracking-widest text-bone uppercase placeholder:text-smoke/40 placeholder:tracking-normal focus:border-amber"
          />
        </label>
        <Button type="submit" disabled={busy || code.length < 4} className="min-h-[48px]">
          {busy ? "KONTROL EDİLİYOR…" : "KULLAN"}
        </Button>
      </form>

      {result && (
        <p
          role="status"
          className={`mt-3 border px-4 py-3 text-sm ${
            result.ok
              ? "border-herb/50 bg-herb/10 text-herb"
              : "border-flame/50 bg-flame/10 text-flame"
          }`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
