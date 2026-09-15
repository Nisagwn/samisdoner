import type { Metadata } from "next";
import VerifyEmailView from "@/components/account/VerifyEmailView";

/**
 * Doğrulama bağlantısının indiği sayfa.
 *
 * Oturum **aranmaz**: bağlantı çoğu zaman telefonun e-posta uygulamasından,
 * hesabın açık olmadığı bir tarayıcıda tıklanır. Buradan giriş ekranına
 * yönlendirmek, kullanıcıdan doğrulama için parolasını hatırlamasını istemek
 * olurdu — oysa doğrulamanın amacı tam da parolayı unuttuğunda kurtarılabilir
 * olmak.
 *
 * Jeton tek kullanımlık ve 256 bit rastgele (bkz. lib/account/emailVerification.ts);
 * oturumdan daha zayıf bir kanıt değil.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "E-Mail bestätigen — Sami´s Döner",
  robots: { index: false, follow: false },
};

export default function VerifyEmailPage({
  searchParams,
}: {
  searchParams?: { token?: string };
}) {
  return <VerifyEmailView token={searchParams?.token ?? ""} />;
}
