"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Button, Field, Notice, TextInput } from "@/components/ui";

/**
 * Parola sıfırlama — iki adımın ortak formu.
 *
 * `mode` ile ayrılır: "request" e-posta ister ve bağlantı yollar, "confirm"
 * bağlantıdan gelen jetonla yeni parolayı alır. Tek bileşen olmalarının sebebi
 * ikisinin de aynı uca (`/api/account/password-reset`) konuşması ve aynı hata
 * gösterimini paylaşması.
 *
 * İstek adımının cevabı hesabın var olup olmadığını **söylemez** — sunucu da
 * söylemiyor. Ekrandaki metin bu yüzden "gönderildi" değil, "kayıtlıysa
 * gönderdik" der; bunu yumuşatmak, uca sızdırmamak için konan kuralı arayüzde
 * geri açmak olurdu.
 */
export default function PasswordResetForm({
  mode,
  token = "",
}: {
  mode: "request" | "confirm";
  token?: string;
}) {
  const { lang } = useLanguage();
  const router = useRouter();
  const de = lang === "de";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const texts = de
    ? {
        requestTitle: "Passwort vergessen",
        requestLead:
          "Geben Sie Ihre E-Mail-Adresse ein. Wenn ein Konto damit existiert, senden wir Ihnen einen Link zum Zurücksetzen.",
        confirmTitle: "Neues Passwort",
        confirmLead: "Vergeben Sie ein neues Passwort für Ihr Konto.",
        email: "E-Mail",
        password: "Neues Passwort",
        passwordHint: "Mindestens 8 Zeichen.",
        sendBtn: "LINK SENDEN",
        saveBtn: "PASSWORT SPEICHERN",
        busy: "BITTE WARTEN…",
        sentTitle: "E-Mail unterwegs",
        sentBody:
          "Wenn ein Konto mit dieser E-Mail-Adresse existiert, haben wir einen Link zum Zurücksetzen gesendet. Der Link ist eine Stunde gültig.",
        savedTitle: "Passwort geändert",
        savedBody: "Sie können sich jetzt mit Ihrem neuen Passwort anmelden.",
        toLogin: "Zur Anmeldung",
        noToken: "Dieser Link ist unvollständig. Bitte fordern Sie einen neuen an.",
        newLink: "Neuen Link anfordern",
        offline: "Server nicht erreichbar.",
        generic: "Es ist ein Fehler aufgetreten.",
      }
    : {
        requestTitle: "Parolamı unuttum",
        requestLead:
          "E-posta adresinizi girin. Bu adresle bir hesap varsa sıfırlama bağlantısı göndeririz.",
        confirmTitle: "Yeni parola",
        confirmLead: "Hesabınız için yeni bir parola belirleyin.",
        email: "E-posta",
        password: "Yeni parola",
        passwordHint: "En az 8 karakter.",
        sendBtn: "BAĞLANTI GÖNDER",
        saveBtn: "PAROLAYI KAYDET",
        busy: "LÜTFEN BEKLEYİN…",
        sentTitle: "E-posta yolda",
        sentBody:
          "Bu e-posta adresiyle bir hesap varsa sıfırlama bağlantısını gönderdik. Bağlantı bir saat geçerlidir.",
        savedTitle: "Parola değiştirildi",
        savedBody: "Artık yeni parolanızla giriş yapabilirsiniz.",
        toLogin: "Girişe git",
        noToken: "Bu bağlantı eksik. Lütfen yeni bir bağlantı isteyin.",
        newLink: "Yeni bağlantı iste",
        offline: "Sunucuya ulaşılamadı.",
        generic: "Bir hata oluştu.",
      };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/account/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "request" ? { email } : { token, password }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setError(data?.error ?? texts.generic);
        setBusy(false);
        return;
      }

      setDone(true);
      setBusy(false);
      // Parola değişince oturumlar düştü; giriş sayfası sunucudan taze okunsun.
      if (mode === "confirm") router.refresh();
    } catch {
      setError(texts.offline);
      setBusy(false);
    }
  }

  const title = mode === "request" ? texts.requestTitle : texts.confirmTitle;

  /* Jetonsuz açılan onay sayfası: form gösterilmez, çıkış yolu verilir. */
  if (mode === "confirm" && token === "") {
    return (
      <Frame title={texts.confirmTitle}>
        <Notice tone="bad">{texts.noToken}</Notice>
        <p className="mt-6">
          <Link href="/konto/passwort-vergessen" className="text-amber underline">
            {texts.newLink}
          </Link>
        </p>
      </Frame>
    );
  }

  if (done) {
    return (
      <Frame title={mode === "request" ? texts.sentTitle : texts.savedTitle}>
        <Notice tone="good">{mode === "request" ? texts.sentBody : texts.savedBody}</Notice>
        <p className="mt-6">
          <Link href="/konto/anmelden" className="text-amber underline">
            {texts.toLogin}
          </Link>
        </p>
      </Frame>
    );
  }

  return (
    <Frame title={title} lead={mode === "request" ? texts.requestLead : texts.confirmLead}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="bad">{error}</Notice>}

        {mode === "request" ? (
          <Field label={texts.email} htmlFor="reset-email">
            <TextInput
              id="reset-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        ) : (
          <Field label={texts.password} htmlFor="reset-password" hint={texts.passwordHint}>
            <TextInput
              id="reset-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}

        <Button type="submit" variant="primary" disabled={busy} className="w-full text-xs">
          {busy ? texts.busy : mode === "request" ? texts.sendBtn : texts.saveBtn}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm">
        <Link href="/konto/anmelden" className="text-smoke underline transition-colors hover:text-amber">
          {texts.toLogin}
        </Link>
      </p>
    </Frame>
  );
}

function Frame({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-5 pb-24 pt-[calc(var(--nav-h)+3rem)]">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-extrabold text-bone">{title}</h1>
        {lead && <p className="mt-3 text-sm leading-relaxed text-smoke">{lead}</p>}
      </header>
      {children}
    </div>
  );
}
