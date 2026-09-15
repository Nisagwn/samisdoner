"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { SharedPasswordMode } from "@/lib/admin/recovery";
import { Button, Field, Notice, TextInput } from "./ui";

/**
 * Panel girişi.
 *
 * Ekranda **tek** giriş yolu görünür; hangisi olduğuna sunucu karar verir
 * (bkz. app/admin/login/page.tsx):
 *
 *  - `setup`    — panelde hiç sahip hesabı yok. Yalnızca kurulum parolası
 *                 sorulur; giriş sonrası doğrudan Personel ekranına gidilir,
 *                 çünkü oradaki ilk iş kendi hesabını açmaktır.
 *  - `recovery` — sunucuda `ADMIN_RECOVERY` açık. Olağan giriş çizilir, ama
 *                 kilitlenen işletmeci için kurulum parolası da kabul edilir.
 *  - `closed`   — olağan hâl. Yalnızca e-posta + parola.
 *
 * Daha önce iki yol her zaman bir aradaydı ve ekranda "hesabım yok, ortak
 * parolayla gir" düğmesi duruyordu. Kişisel hesabı olan personeli de o yola
 * çekiyordu; o parolayla girilen her iş panelde kimsenin üstüne yazılmıyordu.
 */
export default function LoginForm({ mode }: { mode: SharedPasswordMode }) {
  const router = useRouter();
  const params = useSearchParams();
  const setup = mode === "setup";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Kurulum kipinde e-posta alanı hiç yok; kurtarma kipinde kullanıcı seçer.
  const sharedOnly = setup || recovery;

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
        // Ortak parola yolunda e-posta HİÇ gönderilmez: gönderilseydi uç
        // kişisel hesap yolunu dener ve kurulum parolası hiç denenmezdi.
        body: JSON.stringify(sharedOnly ? { password } : { email, password }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Giriş yapılamadı.");
        return;
      }
      // Kurulumda varış noktası sabit: yapılacak tek iş kendi hesabını açmak.
      router.replace(setup ? "/admin/personal" : next);
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
      <p className="tag text-flame mb-3">{setup ? "İlk Kurulum" : "Yönetim Paneli"}</p>
      <h1 className="font-display font-extrabold text-3xl text-bone leading-tight mb-8">
        SAMİ´S
        <br />
        <span className="text-flame">DÖNER</span>
      </h1>

      {setup && (
        <p className="mb-6 border border-line bg-void px-3 py-2 text-xs leading-relaxed text-smoke/80">
          Panelde henüz hesap yok. Sunucudaki <strong className="text-bone">kurulum
          parolasını</strong> girin; ardından kendi hesabınızı açacaksınız. Hesap
          açıldıktan sonra bu parola çalışmayı bırakır.
        </p>
      )}

      <div className="space-y-5">
        {!sharedOnly && (
          <Field label="E-posta">
            <TextInput
              id="admin-email"
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

        <Field label={sharedOnly ? "Kurulum parolası" : "Parola"}>
          <TextInput
            id="admin-password"
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus={sharedOnly}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>

        {error && <Notice kind="error" message={error} />}

        <Button
          type="submit"
          disabled={busy || password.length === 0 || (!sharedOnly && email.length === 0)}
          className="w-full"
        >
          {busy ? "GİRİŞ YAPILIYOR…" : setup ? "KURULUMA BAŞLA" : "GİRİŞ YAP"}
        </Button>

        {/*
          Geçiş düğmesi yalnızca kurtarma kipinde çıkar — yani sunucuda
          ADMIN_RECOVERY'yi bilerek açan biri varken. Olağan hâlde ekranda
          ikinci bir yol hiç görünmez.
        */}
        {mode === "recovery" && (
          <button
            type="button"
            onClick={() => {
              setRecovery((v) => !v);
              setError(null);
            }}
            className="focus-ring block w-full text-center text-xs text-smoke/70 transition-colors hover:text-amber"
          >
            {recovery ? "← E-posta ile giriş yap" : "Kurulum parolasıyla gir (kurtarma)"}
          </button>
        )}

        {recovery && (
          <p className="border border-line bg-void px-3 py-2 text-xs leading-relaxed text-smoke/70">
            Kurtarma açık olduğu için bu yol geçici olarak çalışıyor. İşiniz
            bitince sunucudaki <code className="text-bone">ADMIN_RECOVERY</code>{" "}
            değişkenini kaldırın.
          </p>
        )}
      </div>
    </form>
  );
}
