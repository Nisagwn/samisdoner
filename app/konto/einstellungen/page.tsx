import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AccountFrame from "@/components/account/AccountFrame";
import ProfilePanel from "@/components/account/ProfilePanel";
import {
  ClaimOrderForm,
  ConsentSettings,
  EmailVerification,
  StampCardView,
} from "@/components/account/AccountExtras";
import { getCurrentCustomer } from "@/lib/account/guard";
import { getStampCard } from "@/lib/account/loyalty";

/**
 * İletişim bilgileri, izinler, damga kartı ve DSGVO işlemleri.
 *
 * Sıra kullanım sıklığına göre değil, **kullanıcının burada ne aradığına**
 * göre: en üstte kimliğe dair olan (iletişim, e-posta doğrulama), ortada
 * seyrek ama bilinçli yapılan seçimler (izinler, eski sipariş ekleme), en
 * altta hesabın kendisiyle ilgili ağır işlemler. Damga kartı araya giriyor
 * çünkü bir ayar değil, bakılmak için gelinen bir şey.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kontoeinstellungen — Sami´s Döner",
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/konto/anmelden?next=/konto/einstellungen");

  const card = await getStampCard(customer.id);

  return (
    <AccountFrame
      active="settings"
      customerId={customer.id}
      name={customer.name}
      email={customer.email}
    >
      <div className="space-y-8">
        <ProfilePanel
          profile={{ email: customer.email, name: customer.name, phone: customer.phone }}
        />

        <EmailVerification
          email={customer.email}
          verified={customer.emailVerifiedAt !== null}
        />

        <StampCardView card={card} />

        <ConsentSettings
          initial={{
            marketingOptIn: customer.marketingOptIn,
            reviewMailsOptIn: customer.reviewMailsOptIn,
          }}
        />

        <ClaimOrderForm />
      </div>
    </AccountFrame>
  );
}
