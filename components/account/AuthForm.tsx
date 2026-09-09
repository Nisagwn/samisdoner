"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Button, Field, Notice, TextInput } from "@/components/ui";

/**
 * Giriş ve kayıt formu.
 *
 * Tek bileşen, iki kip. Alanlar farklı ama akış aynı: gönder, hata varsa alanı
 * işaretle, başarılıysa geri dön. İki ayrı bileşen yazmak, iki ayrı yerde
 * unutulacak iki ayrı hata gösterimi demek olurdu.
 *
 * Yönlendirme `?next=` parametresini kullanır ama **yalnızca site içi**
 * yollara: dışarıdan verilen bir adrese yönlendirmek, kimlik doğrulama
 * sayfasını açık yönlendirme (open redirect) aracına çevirir.
 *
 * Alanlar ve düğme `components/ui`'den gelir. Bu dosyanın kendi `Field`
 * kopyası vardı; iOS'ta 16 px altındaki yazı tipi yüzünden alana
 * dokunulduğunda sayfa yakınlaşıyor ve formun geri kalanı ekrandan çıkıyordu.
 * Ortak girdi mobilde `text-base`, `sm:` üstünde küçük — tek yerde çözülmüş
 * bir sorunun ikinci bir kopyada tekrar çözülmesini beklemek çalışmıyor.
 */

type Mode = "login" | "register";

export default function AuthForm({ mode }: { mode: Mode }) {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const de = lang === "de";

  const [form, setForm] = useState({ email: "", password: "", name: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Yalnızca "/" ile başlayan, "//" ile başlamayan yollar kabul edilir. */
  const nextPath = (() => {
    const raw = params.get("next") ?? "";
    return /^\/(?!\/)/.test(raw) ? raw : "/konto";
  })();

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((s) => ({ ...s, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setField(null);

    try {
      const response = await fetch(`/api/account/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "login"
            ? { email: form.email, password: form.password }
            : {
                email: form.email,
                password: form.password,
                name: form.name,
                phone: form.phone,
                lang,
              }
        ),
      });

      const data = (await response.json().catch(() => null)) as
        | { error?: string; field?: string }
        | null;

      if (!response.ok) {
        setError(data?.error ?? (de ? "Es ist ein Fehler aufgetreten." : "Bir hata oluştu."));
        setField(data?.field ?? null);
        setBusy(false);
        return;
      }

      // Sunucu bileşenleri oturumu yeniden okusun; yoksa panel boş görünür.
      router.replace(nextPath);
      router.refresh();
    } catch {
      setError(de ? "Server nicht erreichbar." : "Sunucuya ulaşılamadı.");
      setBusy(false);
    }
  }

  const texts = de
    ? {
        loginTitle: "Anmelden",
        registerTitle: "Konto erstellen",
        email: "E-Mail",
        password: "Passwort",
        name: "Name",
        phone: "Telefon",
        loginBtn: "ANMELDEN",
        registerBtn: "KONTO ERSTELLEN",
        busy: "BITTE WARTEN…",
        toRegister: "Noch kein Konto? Jetzt registrieren",
        toLogin: "Sie haben bereits ein Konto? Anmelden",
        forgot: "Passwort vergessen?",
        guestHint:
          "Ein Konto ist nicht erforderlich — Sie können auch als Gast bestellen. Mit Konto merken wir uns Ihre Adresse und Ihre Bestellungen.",
        passwordHint: "Mindestens 8 Zeichen.",
        privacyHint: "Mit der Registrierung bestätigen Sie, unsere {privacy} gelesen zu haben.",
        privacy: "Datenschutzerklärung",
      }
    : {
        loginTitle: "Giriş yap",
        registerTitle: "Hesap oluştur",
        email: "E-posta",
        password: "Parola",
        name: "Ad soyad",
        phone: "Telefon",
        loginBtn: "GİRİŞ YAP",
        registerBtn: "HESAP OLUŞTUR",
        busy: "LÜTFEN BEKLEYİN…",
        toRegister: "Hesabınız yok mu? Hemen kaydolun",
        toLogin: "Zaten hesabınız var mı? Giriş yapın",
        forgot: "Parolanızı mı unuttunuz?",
        guestHint:
          "Hesap zorunlu değildir — misafir olarak da sipariş verebilirsiniz. Hesapla adresinizi ve siparişlerinizi hatırlarız.",
        passwordHint: "En az 8 karakter.",
        privacyHint: "Kaydolarak {privacy} okuduğunuzu onaylamış olursunuz.",
        privacy: "Gizlilik Politikası",
      };

  const [privacyBefore, privacyAfter] = texts.privacyHint.split("{privacy}");

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-24 pt-[calc(var(--nav-h)+3rem)]">
      <header className="mb-8">
        <p className="tag text-flame">{t.footer.contactTitle}</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold text-bone">
          {mode === "login" ? texts.loginTitle : texts.registerTitle}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-smoke">{texts.guestHint}</p>
      </header>

      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="bad">{error}</Notice>}

        {mode === "register" && (
          <>
            <Field label={texts.name} htmlFor="name">
              <TextInput
                id="name"
                name="name"
                value={form.name}
                onChange={set("name")}
                autoComplete="name"
                invalid={field === "name"}
              />
            </Field>
            <Field label={texts.phone} htmlFor="phone">
              <TextInput
                id="phone"
                name="phone"
                value={form.phone}
                onChange={set("phone")}
                type="tel"
                autoComplete="tel"
                invalid={field === "phone"}
              />
            </Field>
          </>
        )}

        <Field label={texts.email} htmlFor="email">
          <TextInput
            id="email"
            name="email"
            value={form.email}
            onChange={set("email")}
            type="email"
            autoComplete="email"
            invalid={field === "email"}
          />
        </Field>

        {/* İpucu ayrı bir paragraf değil alanın kendi `hint` yuvası: ekran
            okuyucu ipucunu alanla birlikte okur, ve hata çıktığında ikisinin
            hangisinin görüneceğine tek yerde karar verilir. */}
        <Field
          label={texts.password}
          htmlFor="password"
          hint={mode === "register" ? texts.passwordHint : undefined}
        >
          <TextInput
            id="password"
            name="password"
            value={form.password}
            onChange={set("password")}
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            invalid={field === "password"}
          />
        </Field>

        {mode === "register" && (
          <p className="text-xs leading-relaxed text-smoke/70">
            {privacyBefore}
            <Link href="/datenschutz" className="text-amber underline">
              {texts.privacy}
            </Link>
            {privacyAfter}
          </p>
        )}

        <Button type="submit" variant="primary" disabled={busy} className="w-full text-xs">
          {busy ? texts.busy : mode === "login" ? texts.loginBtn : texts.registerBtn}
        </Button>
      </form>

      <div className="mt-6 space-y-3 text-center text-sm">
        <p>
          <Link
            href={mode === "login" ? "/konto/registrieren" : "/konto/anmelden"}
            className="text-smoke underline transition-colors hover:text-amber"
          >
            {mode === "login" ? texts.toRegister : texts.toLogin}
          </Link>
        </p>
        {/* Yalnızca giriş kipinde: kayıt olurken parolayı unutmuş olamazsınız. */}
        {mode === "login" && (
          <p>
            <Link
              href="/konto/passwort-vergessen"
              className="text-smoke underline transition-colors hover:text-amber"
            >
              {texts.forgot}
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
