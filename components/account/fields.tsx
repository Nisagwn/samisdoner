"use client";

/**
 * Hesap ekranlarının form alanı.
 *
 * Kendi girdi yazımı vardı; artık ortak `components/ui` ilkelini sarıyor.
 * Ayrı yazımın somut bedeli iOS'taydı: kutunun yazı tipi 14 px olduğu için
 * alana dokunulduğunda Safari sayfayı yakınlaştırıyor, müşteri formun geri
 * kalanını göremiyordu. Ortak girdi mobilde 16 px, `sm:` üstünde küçük.
 *
 * Sarmalayıcı yine de duruyor: hesap ekranlarında alanlar `id`'yi hem
 * `htmlFor` hem `name` olarak kullanıyor ve `useState` yerine form gönderimiyle
 * okunuyor. Bu küçük sözleşmeyi beş çağrı yerinde tekrarlamak yerine burada
 * bir kez kuruyoruz.
 */

import { Field, TextInput } from "@/components/ui";

export function TextField({
  id,
  label,
  hint,
  ...props
}: { id: string; label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="min-w-0">
      <Field label={label} htmlFor={id} hint={hint}>
        <TextInput id={id} name={id} {...props} />
      </Field>
    </div>
  );
}

/** Panel başlığı — beş ekranda da aynı hiyerarşi. */
export function PanelHeader({ title, lead }: { title: string; lead?: string }) {
  return (
    <header className="mb-6">
      <h2 className="font-display text-xl font-extrabold text-bone">{title}</h2>
      {lead && <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-smoke">{lead}</p>}
    </header>
  );
}
