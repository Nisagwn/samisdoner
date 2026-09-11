"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Settings } from "@/lib/admin/types";
import { Button, Field, Notice, TextInput } from "./ui";

/**
 * Servis / paket ücreti.
 *
 * Kendi sayfası vardı ("Fiyat ayarları") ve o sayfada bir de kaldırılan
 * "Kendin Seç" bölümünün seçenek başına ek ücret tablosu duruyordu. Tablo
 * gidince geriye iki alanlık bir sayfa kaldı; kenar çubuğunda ayrı bir satır
 * olarak durmayı hak etmiyordu.
 *
 * Buraya, teslimat bölgelerinin üstüne taşındı. Doğru yer de burası:
 * müşterinin ödediği ücretlerin ikisi de bu ekranda — servis ücreti tüm
 * siparişlere, teslimat ücreti ise posta koduna göre biner. Aynı işi iki
 * sayfada aramak, birinin unutulması demekti.
 */

function toInput(value: number): string {
  return String(value).replace(".", ",");
}

function toNumber(value: string): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function ServiceFeeCard({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [serviceFee, setServiceFee] = useState(toInput(settings.serviceFee));
  const [freeOver, setFreeOver] = useState(toInput(settings.freeServiceOver));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/admin/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            serviceFee: toNumber(serviceFee),
            freeServiceOver: toNumber(freeOver),
          },
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Kaydedilemedi.");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-8 border border-line bg-char p-5 md:p-6">
      <h2 className="mb-2 font-display text-lg font-bold text-bone">Servis ücreti</h2>
      <p className="mb-5 text-sm leading-relaxed text-smoke">
        Her siparişe eklenen sabit ücret — posta kodundan bağımsızdır. Adrese
        göre değişen kurye ücreti aşağıdaki bölge listesinden ayarlanır.
      </p>

      {error && (
        <div className="mb-5">
          <Notice kind="error" message={error} />
        </div>
      )}
      {saved && !error && (
        <div className="mb-5">
          <Notice kind="success" message="Servis ücreti kaydedildi." />
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Servis / paket ücreti (€)"
          hint="0 girilirse sepette bu satır hiç gösterilmez."
        >
          <TextInput
            inputMode="decimal"
            value={serviceFee}
            onChange={(e) => setServiceFee(e.target.value)}
            placeholder="0"
          />
        </Field>
        <Field
          label="Ücretsiz servis eşiği (€)"
          hint="Bu tutarın üstündeki siparişlerde ücret alınmaz. 0 = eşik yok."
        >
          <TextInput
            inputMode="decimal"
            value={freeOver}
            onChange={(e) => setFreeOver(e.target.value)}
            placeholder="0"
          />
        </Field>
      </div>

      <div className="mt-5 flex justify-end">
        <Button onClick={save} disabled={busy}>
          {busy ? "KAYDEDİLİYOR…" : "SERVİS ÜCRETİNİ KAYDET"}
        </Button>
      </div>
    </section>
  );
}
