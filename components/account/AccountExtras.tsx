"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { StampCard } from "@/lib/account/loyalty";
import { accountTexts, type AccountTexts } from "./texts";

/**
 * Ayarlar ekranının üç ek bölümü: e-posta doğrulama, bildirim izinleri ve
 * misafir siparişi bağlama.
 *
 * Üçü tek dosyada çünkü üçü de aynı ekranda, aynı formda ve aynı cevap
 * kalıbıyla çalışıyor; ayrı dosyalara bölmek üç kez tekrarlanan bir `fetch`
 * sarmalayıcısı üretirdi. Damga kartı ise ayrı: o bir ayar değil, bir durum
 * gösterimi ve kendi ekranında da duruyor.
 */

/* ─────────────────────────────────────────────────── e-posta doğrulama */

export function EmailVerification({
  email,
  verified,
}: {
  email: string;
  verified: boolean;
}) {
  const { lang } = useLanguage();
  const t = accountTexts(lang !== "tr");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/account/verify-email", { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? t.serverError);
        return;
      }
      setSent(true);
    } catch {
      setError(t.serverError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border border-line bg-char p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-lg font-extrabold text-bone">{t.verifyTitle}</h3>
        <span
          className={`tag border px-2.5 py-1 ${
            verified
              ? "border-herb/50 bg-herb/10 text-herb"
              : "border-amber/50 bg-amber/10 text-amber"
          }`}
        >
          {verified ? t.verifyDone : t.verifyPending}
        </span>
      </div>

      <p className="mt-2 break-all text-sm text-smoke">{email}</p>

      {!verified && (
        <>
          <p className="mt-3 text-sm leading-relaxed text-smoke">{t.verifyLead}</p>
          {sent ? (
            <p className="mt-4 border border-herb/50 bg-herb/10 px-4 py-3 text-sm text-herb">
              {t.verifySent}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void request()}
              disabled={busy}
              className="focus-ring tag mt-4 min-h-[48px] border border-amber px-5 py-3 text-amber transition-colors hover:bg-amber hover:text-void disabled:opacity-40"
            >
              {busy ? "…" : t.verifySend}
            </button>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-flame">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ────────────────────────────────────────────────────────── izinler */

export function ConsentSettings({
  initial,
}: {
  initial: { marketingOptIn: boolean; reviewMailsOptIn: boolean };
}) {
  const { lang } = useLanguage();
  const t = accountTexts(lang !== "tr");
  const [state, setState] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(change: Partial<typeof initial>) {
    // İyimser güncelleme: onay kutusu anında dönmeli. Başarısızlıkta eski
    // hâline alınır — bir izin kutusunun yanlış konumda kalması, izin
    // verilmediği hâlde verilmiş görünmesi demek olurdu.
    const previous = state;
    setState({ ...state, ...change });
    setSaved(false);
    setError(null);
    try {
      const response = await fetch("/api/account/consent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      if (!response.ok) {
        setState(previous);
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? t.saveFailed);
        return;
      }
      setSaved(true);
    } catch {
      setState(previous);
      setError(t.serverError);
    }
  }

  return (
    <section className="border border-line bg-char p-6">
      <h3 className="font-display text-lg font-extrabold text-bone">{t.consentTitle}</h3>
      <p className="mt-2 text-sm leading-relaxed text-smoke">{t.consentLead}</p>

      <div className="mt-5 space-y-4">
        <Checkbox
          checked={state.marketingOptIn}
          onChange={(next) => void patch({ marketingOptIn: next })}
          label={t.consentMarketing}
          hint={t.consentMarketingHint}
        />
        <Checkbox
          checked={state.reviewMailsOptIn}
          onChange={(next) => void patch({ reviewMailsOptIn: next })}
          label={t.consentReviewMails}
          hint={t.consentReviewMailsHint}
        />
      </div>

      {saved && (
        <p role="status" className="mt-4 text-sm text-herb">
          {t.consentSaved}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-flame">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * Onay kutusu.
 *
 * Gerçek bir `<input type="checkbox">` kullanılıyor, `div` + `onClick` değil:
 * klavyeyle boşluk tuşuna basılabiliyor, ekran okuyucu "işaretli/işaretsiz"
 * diyebiliyor ve tarayıcının kendi otomatik doldurma davranışı bozulmuyor.
 * Görsel kutu `peer` ile ona bağlı.
 */
function Checkbox({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border text-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-amber ${
          checked ? "border-amber bg-amber text-void" : "border-line bg-void text-transparent"
        }`}
      >
        ✓
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-bone">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-smoke/70">{hint}</span>
      </span>
    </label>
  );
}

/* ──────────────────────────────────────────── misafir siparişi bağlama */

export function ClaimOrderForm() {
  const { lang } = useLanguage();
  const t = accountTexts(lang !== "tr");
  const router = useRouter();
  const [orderNo, setOrderNo] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/account/claim-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNo, phone }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(data?.error ?? t.serverError);
        return;
      }
      setDone(true);
      setOrderNo("");
      setPhone("");
      // Sipariş listesi sunucuda üretiliyor; bağlanan sipariş orada görünsün.
      router.refresh();
    } catch {
      setError(t.serverError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border border-line bg-char p-6">
      <h3 className="font-display text-lg font-extrabold text-bone">{t.claimTitle}</h3>
      <p className="mt-2 text-sm leading-relaxed text-smoke">{t.claimLead}</p>

      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="tag mb-2 block text-smoke">{t.claimOrderNo}</span>
          <input
            value={orderNo}
            onChange={(e) => setOrderNo(e.target.value)}
            required
            placeholder="SD-260907-001"
            className="focus-ring w-full border border-line bg-void px-3.5 py-2.5 text-sm text-bone placeholder:text-smoke/50 focus:border-amber"
          />
        </label>

        <label className="block">
          <span className="tag mb-2 block text-smoke">{t.claimPhone}</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            inputMode="tel"
            autoComplete="tel"
            placeholder="0170 1234567"
            className="focus-ring w-full border border-line bg-void px-3.5 py-2.5 text-sm text-bone placeholder:text-smoke/50 focus:border-amber"
          />
        </label>

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={busy || !orderNo || !phone}
            className="focus-ring tag min-h-[48px] border border-amber px-5 py-3 text-amber transition-colors hover:bg-amber hover:text-void disabled:opacity-40 disabled:pointer-events-none"
          >
            {busy ? "…" : t.claimSubmit}
          </button>
        </div>
      </form>

      {done && (
        <p role="status" className="mt-4 border border-herb/50 bg-herb/10 px-4 py-3 text-sm text-herb">
          {t.claimDone}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-flame">
          {error}
        </p>
      )}
    </section>
  );
}

/* ─────────────────────────────────────────────────────── damga kartı */

/**
 * Damga kartı.
 *
 * Kâğıt kartın görünümü bilerek korunuyor: on kutu, dolanlar işaretli. Bir
 * ilerleme çubuğu aynı bilgiyi verirdi ama tanıdık gelmezdi — bu kartın işi
 * tezgâhtaki kâğıdın yerini almak.
 */
export function StampCardView({ card }: { card: StampCard }) {
  const { lang } = useLanguage();
  const de = lang !== "tr";
  const t = accountTexts(de);

  const dateFmt = new Intl.DateTimeFormat(de ? "de-DE" : "tr-TR", {
    timeZone: "Europe/Berlin",
    dateStyle: "long",
  });

  return (
    <section className="border border-line bg-char p-6">
      <h3 className="font-display text-lg font-extrabold text-bone">{t.stampTitle}</h3>
      <p className="mt-2 text-sm leading-relaxed text-smoke">{t.stampLead}</p>

      <div className="mt-5 flex flex-wrap gap-2" role="img"
        aria-label={`${card.stamps} / ${card.perReward}`}>
        {Array.from({ length: card.perReward }, (_, index) => {
          const filled = index < card.stamps;
          return (
            <span
              key={index}
              aria-hidden
              className={`flex h-11 w-11 items-center justify-center border text-lg transition-colors ${
                filled
                  ? "border-amber bg-amber/15 text-amber"
                  : "border-line bg-void text-smoke/25"
              }`}
            >
              {filled ? "★" : "☆"}
            </span>
          );
        })}
      </div>

      <p className="mt-3 tag text-smoke">
        <strong className="text-bone tabular-nums">
          {card.stamps} / {card.perReward}
        </strong>{" "}
        {t.stampProgress}
      </p>

      {card.rewards.length > 0 ? (
        <div className="mt-6 space-y-3">
          <p className="font-display text-lg font-extrabold text-herb">{t.stampReady}</p>
          {card.rewards.map((reward) => (
            <div key={reward.code} className="border border-herb/50 bg-herb/5 p-4">
              <p className="tag text-herb">{t.stampCodeLabel}</p>
              <p className="mt-1 select-all font-display text-2xl font-extrabold tracking-widest text-bone">
                {reward.code}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-smoke">{t.stampCodeHint}</p>
              <p className="mt-2 text-xs text-smoke/70">
                {t.stampExpires} {dateFmt.format(new Date(reward.expiresAt))}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-xs text-smoke/70">{t.stampNone}</p>
      )}
    </section>
  );
}

export type { AccountTexts };
