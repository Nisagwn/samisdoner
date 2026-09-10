"use client";

/**
 * Müşteri sitesinin ortak arayüz parçaları.
 *
 * Neden var: bu dosyadan önce tek bir metin kutusu altı ayrı yerde altı farklı
 * sınıf diziliminde yazılıydı (`bg-void` / `bg-char`, `px-3` / `px-3.5`,
 * `py-2` / `py-2.5`), ana çağrı düğmesi yedi çağrı yerinde beş farklı
 * geometrideydi ve aynı dosyanın içinde iki ayrı `disabled:opacity` değeri
 * vardı. Tek tek hiçbiri hata değil; toplamı, hangi ölçünün doğru olduğunu
 * kimsenin bilemediği bir arayüz.
 *
 * `components/admin/ui.tsx` panel için aynı işi yapıyor. İkisi de **aynı
 * token'ları** kullanır (void/char/panel/line/bone/smoke/amber/flame,
 * font-display, .tag, .focus-ring); ayrı tema yoktur. Ayrı dosya olmalarının
 * sebebi, panelin Türkçe-sabit ve yoğun-form, müşteri tarafının iki dilli ve
 * dokunmatik-öncelikli olması.
 *
 * Dokunma hedefi kuralı: parmakla basılan hiçbir kontrol 44×44 px'in altında
 * olamaz (WCAG 2.5.5). Sepetteki adet düğmeleri bu dosyadan önce 32 px'ti ve
 * akıştaki en çok dokunulan kontroldü.
 */

/* --------------------------------------------------------------- alanlar */

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="tag text-smoke block mb-2">
        {label}
      </label>
      {children}
      {/* Hata varsa ipucu gizlenmez: ikisi farklı şeyler söyler. */}
      {error && (
        <p role="alert" className="text-xs text-flame mt-1.5">
          {error}
        </p>
      )}
      {hint && !error && <p className="text-xs text-smoke/70 mt-1.5">{hint}</p>}
    </div>
  );
}

/**
 * Girdi tabanı.
 *
 * `text-base` mobilde bilinçlidir: iOS Safari, 16 px'ten küçük yazı tipli bir
 * alana odaklanıldığında sayfayı otomatik yakınlaştırır ve kullanıcı formun
 * geri kalanını göremez hâle gelir. `sm:` üstünde küçük boyuta dönülür.
 */
const inputBase =
  "w-full bg-void border text-bone text-base sm:text-sm px-3.5 py-3 sm:py-2.5 focus-ring placeholder:text-smoke/50 outline-none transition-colors focus:border-amber disabled:opacity-40";

const borderFor = (invalid?: boolean) => (invalid ? "border-flame" : "border-line");

export function TextInput({
  invalid,
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={`${inputBase} ${borderFor(invalid)} ${className}`}
    />
  );
}

export function TextArea({
  invalid,
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || undefined}
      className={`${inputBase} ${borderFor(invalid)} resize-y min-h-[88px] ${className}`}
    />
  );
}

export function Select({
  invalid,
  className = "",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      {...props}
      aria-invalid={invalid || undefined}
      className={`${inputBase} ${borderFor(invalid)} ${className}`}
    />
  );
}

/* --------------------------------------------------------------- düğmeler */

export type ButtonVariant = "primary" | "outline" | "ghost" | "success";

const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-flame-gradient text-void border-transparent font-extrabold hover:brightness-110",
  outline: "border-amber bg-amber/10 text-amber hover:bg-amber hover:text-void",
  ghost: "border-line text-smoke hover:border-amber hover:text-amber",
  /*
   * "Sepete eklendi" onayı. Kendi geometrisini kuran ayrı bir düğme değil,
   * aynı düğmenin ikinci bir durumu: eklemeden sonra kutu yerinde durur,
   * yalnız rengi ve yazısı değişir — düzen oynamaz.
   */
  success: "border-herb bg-herb/15 text-herb",
};

/**
 * Düğme geometrisi — sınıf dizisi olarak.
 *
 * `Button` bunu sarar, ama aynı geometriyi taşıması gereken her şey `<button>`
 * değil: "Tüm menü" bir `next/link` bağlantısıdır ve `<a>` olarak kalmalı
 * (yeni sekmede açılabilmeli, tarayıcı bağlantı olarak görebilmeli). Geometri
 * ile eleman türünü ayırmadan ikisi kaçınılmaz olarak ayrışıyordu.
 *
 * `min-h-[44px]`: dokunma hedefi alt sınırı, dolgu ne olursa olsun korunur.
 */
export function buttonClass(variant: ButtonVariant = "primary", className = "") {
  return `focus-ring tag inline-flex min-h-[44px] items-center justify-center border px-5 py-3 font-display font-semibold transition-[filter,transform,colors] active:translate-y-px disabled:opacity-40 disabled:pointer-events-none ${variantStyles[variant]} ${className}`;
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
}) {
  return <button {...props} className={buttonClass(variant, className)} />;
}

/**
 * Adet seçici.
 *
 * Tek tanım. Önceden iki ayrı kopya vardı (sepette 32 px, kaldırılan
 * yapılandırıcıda 40 px) ve dokunma hedefi ikisinde de farklıydı.
 */
export function QtyStepper({
  qty,
  onChange,
  max = 99,
  labels,
}: {
  qty: number;
  onChange: (next: number) => void;
  max?: number;
  labels: { decrease: string; increase: string };
}) {
  return (
    <div className="flex items-center border border-line">
      <button
        type="button"
        onClick={() => onChange(qty - 1)}
        aria-label={labels.decrease}
        className="focus-ring h-11 w-11 text-lg text-bone transition-colors hover:text-flame"
      >
        −
      </button>
      <span
        aria-live="polite"
        className="w-10 text-center font-mono text-sm text-bone tabular-nums"
      >
        {qty}
      </span>
      <button
        type="button"
        onClick={() => onChange(qty + 1)}
        aria-label={labels.increase}
        disabled={qty >= max}
        className="focus-ring h-11 w-11 text-lg text-bone transition-colors hover:text-flame disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- uyarı */

/**
 * Uyarı bandı.
 *
 * `role` tona göre seçilir: engelleyici bir durum (`bad`) ekran okuyucuya
 * anında bildirilmeli (`alert`), bilgilendirme (`info` / `warn`) sırasını
 * beklemeli (`status`). Hepsini `alert` yapmak, okuyucuyu sürekli kesen bir
 * arayüz üretir.
 */
export function Notice({
  tone = "warn",
  title,
  children,
  className = "",
}: {
  tone?: "info" | "warn" | "bad" | "good";
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const styles = {
    info: "border-line bg-void/40 text-smoke",
    warn: "border-amber/50 bg-amber/10 text-amber",
    bad: "border-flame/50 bg-flame/10 text-flame",
    good: "border-herb/50 bg-herb/10 text-herb",
  }[tone];

  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={`border px-4 py-3 text-sm leading-relaxed ${styles} ${className}`}
    >
      {title && <p className="tag mb-1">{title}</p>}
      {children}
    </div>
  );
}
