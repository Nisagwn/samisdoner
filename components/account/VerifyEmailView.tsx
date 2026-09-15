"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { accountTexts } from "./texts";

/**
 * Doğrulama bağlantısının açtığı ekran.
 *
 * Jeton, sayfa açılır açılmaz tüketilir — kullanıcıdan ikinci bir tık
 * istenmez. "Bağlantıya tıkladım, şimdi de düğmeye mi basacağım" adımı hiçbir
 * şey korumuyor: jeton zaten bağlantının içinde ve e-posta istemcisinin
 * bağlantı önizlemesi onu tüketecekse, o tüketim düğmeyle de engellenmez.
 *
 * `useRef` ile tek sefer çalışması sağlanıyor: React'in geliştirme kipindeki
 * çift `useEffect` çağrısı, tek kullanımlık jetonu ilk açılışta tüketip
 * ikinci çağrıda "zaten kullanıldı" hatası gösterirdi.
 */

type State =
  | { kind: "working" }
  | { kind: "done"; alreadyVerified: boolean }
  | { kind: "failed"; message: string };

export default function VerifyEmailView({ token }: { token: string }) {
  const { lang } = useLanguage();
  const de = lang !== "tr";
  const t = accountTexts(de);
  const [state, setState] = useState<State>({ kind: "working" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!token) {
      setState({
        kind: "failed",
        message: de ? "Dieser Link ist unvollständig." : "Bu bağlantı eksik.",
      });
      return;
    }

    void (async () => {
      try {
        const response = await fetch("/api/account/verify-email", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await response.json().catch(() => null)) as
          | { error?: string; alreadyVerified?: boolean }
          | null;

        if (!response.ok) {
          setState({ kind: "failed", message: data?.error ?? t.serverError });
          return;
        }
        setState({ kind: "done", alreadyVerified: data?.alreadyVerified ?? false });
      } catch {
        setState({ kind: "failed", message: t.serverError });
      }
    })();
  }, [token, de, t.serverError]);

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-24 pt-[calc(var(--nav-h)+4rem)]">
      <div className="border border-line bg-char p-8">
        <p className="tag text-flame">{t.verifyTitle}</p>

        {state.kind === "working" && (
          <p className="mt-4 text-sm text-smoke">
            {de ? "Einen Moment…" : "Bir saniye…"}
          </p>
        )}

        {state.kind === "done" && (
          <>
            <h1 className="mt-3 font-display text-2xl font-extrabold text-bone">
              {t.verifyDone}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-smoke">
              {state.alreadyVerified
                ? de
                  ? "Diese Adresse war bereits bestätigt — es gibt nichts weiter zu tun."
                  : "Bu adres zaten doğrulanmıştı; yapılacak başka bir şey yok."
                : t.verifyLead}
            </p>
          </>
        )}

        {state.kind === "failed" && (
          <>
            <h1 className="mt-3 font-display text-2xl font-extrabold text-flame">
              {de ? "Das hat nicht geklappt" : "Bu işe yaramadı"}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-smoke">{state.message}</p>
            <p className="mt-3 text-sm leading-relaxed text-smoke">
              {de
                ? "In Ihren Kontoeinstellungen können Sie jederzeit einen neuen Link anfordern."
                : "Hesap ayarlarınızdan istediğiniz zaman yeni bir bağlantı isteyebilirsiniz."}
            </p>
          </>
        )}

        <Link
          href="/konto/einstellungen"
          className="focus-ring tag mt-8 inline-block border border-amber px-5 py-3 text-amber transition-colors hover:bg-amber hover:text-void"
        >
          {de ? "ZU DEN EINSTELLUNGEN" : "AYARLARA GİT"}
        </Link>
      </div>
    </div>
  );
}
