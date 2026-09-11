"use client";

import { forwardRef, useEffect, useRef } from "react";
import { useScrollLock } from "@/lib/useScrollLock";

/**
 * Admin panelinin ortak parçaları.
 *
 * Müşteri sitesindeki tasarım token'ları (void/char/panel/line/bone/smoke/
 * amber/flame, font-display, .tag, .focus-ring) yeniden kullanılır; admin için
 * ayrı bir tema kurulmaz.
 */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="tag text-smoke block mb-2">{label}</span>
      {children}
      {hint && <span className="block text-xs text-smoke/70 mt-1.5">{hint}</span>}
    </label>
  );
}

const inputBase =
  "w-full bg-void border border-line text-bone text-sm px-3.5 py-2.5 focus-ring placeholder:text-smoke/50 focus:border-amber transition-colors";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputBase} ${props.className ?? ""}`} />;
}

/**
 * Çok satırlı giriş.
 *
 * `forwardRef`: iptal penceresi "Diğer" seçildiğinde imleci doğrudan bu alana
 * götürüyor; sarmalayıcı ref'i geçirmezse o odaklanma sessizce hiçbir şey
 * yapmaz.
 */
export const TextArea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea(props, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={`${inputBase} resize-y min-h-[88px] ${props.className ?? ""}`}
    />
  );
});

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputBase} ${props.className ?? ""}`} />;
}

export function Toggle({
  checked,
  onChange,
  onLabel,
  offLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`focus-ring tag border px-3 py-2 transition-colors ${
        checked
          ? "border-herb/60 text-herb bg-herb/10"
          : "border-line text-smoke bg-void hover:border-smoke"
      }`}
    >
      {checked ? onLabel : offLabel}
    </button>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
}) {
  const styles = {
    primary: "bg-amber text-void border-amber hover:bg-bone hover:border-bone",
    ghost: "border-line text-bone hover:border-amber hover:text-amber",
    danger: "border-flame/60 text-flame hover:bg-flame hover:text-void",
  }[variant];

  return (
    <button
      {...props}
      className={`focus-ring tag border px-4 py-2.5 font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none ${styles} ${className}`}
    />
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: "on" | "off" | "warn";
  children: React.ReactNode;
}) {
  const styles = {
    on: "border-herb/50 text-herb bg-herb/10",
    off: "border-line text-smoke bg-void",
    warn: "border-amber/50 text-amber bg-amber/10",
  }[tone];
  return <span className={`tag border px-2 py-1 whitespace-nowrap ${styles}`}>{children}</span>;
}

export function Notice({ kind, message }: { kind: "error" | "success"; message: string }) {
  return (
    <p
      role="status"
      className={`text-sm border px-4 py-3 ${
        kind === "error"
          ? "border-flame/50 text-flame bg-flame/10"
          : "border-herb/50 text-herb bg-herb/10"
      }`}
    >
      {message}
    </p>
  );
}

/** Silme gibi geri alınamaz işlemler için onay penceresi. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[80] overflow-y-auto overscroll-contain bg-void/85 backdrop-blur-sm"
    >
      {/* Kısa metinde ortalanır, uzun metinde kaydırılır — sadece
          `items-center` verildiğinde uzun onay metninin altı kesiliyordu. */}
      <div className="flex min-h-full items-center justify-center p-5">
      <div className="w-full max-w-[440px] ember-surface border border-line p-7">
        <h2 className="font-display font-extrabold text-xl text-bone mb-3">{title}</h2>
        <p className="text-smoke text-sm leading-relaxed mb-7">{message}</p>
        <div className="flex flex-wrap gap-3 justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="focus-ring tag border border-line text-bone px-4 py-2.5 font-semibold hover:border-amber hover:text-amber transition-colors disabled:opacity-40"
          >
            VAZGEÇ
          </button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "SİLİNİYOR…" : confirmLabel}
          </Button>
        </div>
      </div>
      </div>
    </div>
  );
}
