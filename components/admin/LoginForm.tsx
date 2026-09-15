"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, Field, Notice, TextInput } from "./ui";

/**
 * Panel girişi.
 *
 * İki yol var (bkz. app/api/admin/login/route.ts) ve form ikisini de tek
 * ekranda sunuyor: e-posta yazılırsa kişisel hesapla, boş bırakılırsa ortak
 * kurtarma parolasıyla girilir.
 *
 * Kurtarma yolu bilerek ikinci planda — katlanmış bir bölümün içinde. Görünür
 * bir "ortak parola" alanı, kişisel hesabı olan personelin de o parolayı
 * kullanmasına yol açardı; o zaman da panelde kimin ne yaptığı yine
 * bilinmezdi. Bölüm kapalı durur ama gizli değildir: kilitlenen bir
 * işletmecinin onu bulabilmesi gerekir.
 */
export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Açık yönlendirme olmasın: yalnızca panel içi yollara dönülür.
  const raw = params.get("next") ?? "/admin";
  const next = raw.startsWith("/admin") && !raw.startsWith("//") ? raw : "/admin";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Kurtarma kipinde e-posta HİÇ gönderilmez: gönderilseydi uç kişisel
        // hesap yolunu dener ve ortak parola hiç denenmezdi.
        body: JSON.stringify(recovery ? { password } : { email, password }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Giriş yapılamadı.");
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-[400px] ember-surface border border-line p-8 md:p-10"
    >
      <p className="tag text-flame mb-3">Yönetim Paneli</p>
      <h1 className="font-display font-extrabold text-3xl text-bone leading-tight mb-8">
        SAMİ´S
        <br />
        <span className="text-flame">DÖNER</span>
      </h1>

      <div className="space-y-5">
        {!recovery && (
          <Field label="E-posta">
            <TextInput
              type="email"
              name="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ad@samisdoener.de"
            />
          </Field>
        )}

        <Field label={recovery ? "Ortak kurtarma parolası" : "Parola"}>
          <TextInput
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus={recovery}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>

        {error && <Notice kind="error" message={error} />}

        <Button
          type="submit"
          disabled={busy || password.length === 0 || (!recovery && email.length === 0)}
          className="w-full"
        >
          {busy ? "GİRİŞ YAPILIYOR…" : "GİRİŞ YAP"}
        </Button>

        <button
          type="button"
          onClick={() => {
            setRecovery((v) => !v);
            setError(null);
          }}
          className="focus-ring block w-full text-center text-xs text-smoke/70 transition-colors hover:text-amber"
        >
          {recovery
            ? "← E-posta ile giriş yap"
            : "Hesabım yok — ortak parolayla gir"}
        </button>

        {recovery && (
          <p className="border border-line bg-void px-3 py-2 text-xs leading-relaxed text-smoke/70">
            Bu yol yalnızca ilk kurulum ve kurtarma içindir. Girdikten sonra
            <strong className="text-bone"> Personel</strong> ekranından kendinize
            bir hesap açın: panelde kimin ne yaptığı ancak o zaman yazılır.
          </p>
        )}
      </div>
    </form>
  );
}
