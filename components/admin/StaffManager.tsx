"use client";

import { useState } from "react";
import type { AdminRole } from "@prisma/client";
import { ROLE_HINTS, ROLE_LABELS, ROLE_OPTIONS } from "@/lib/admin/roles";
import type { StaffRecord } from "@/lib/admin/staff";
import { Badge, Button, ConfirmDialog, Field, Notice, Select, TextInput } from "./ui";

/**
 * Panel kullanıcıları ekranı.
 *
 * Ekranın tamamı tek bir soruya cevap veriyor: **bugün panele kim girebiliyor?**
 * Bu yüzden liste ad değil, erişim odaklı — rol ve son giriş tarihi her satırda
 * görünür. "Üç ay önce ayrılan çocuk hâlâ girebiliyor mu" sorusu ancak listeye
 * bakarak cevaplanabiliyorsa sorulur.
 *
 * Silme yok, kapatma var. Silinen kullanıcının yaptığı işlemlerin faili
 * kayıtta boşa düşerdi; kapatılan hesap giriş yapamaz, listede gri durur ve
 * gerekirse geri açılır.
 */

type Draft = {
  email: string;
  name: string;
  password: string;
  role: AdminRole;
};

const EMPTY: Draft = { email: "", name: "", password: "", role: "STAFF" };

const DATE = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Berlin",
  dateStyle: "short",
  timeStyle: "short",
});

export default function StaffManager({
  initial,
  currentUserId,
}: {
  initial: StaffRecord[];
  /** Kendi satırında rol ve kapatma düğmeleri çalışmaz; sunucu da reddeder. */
  currentUserId: string;
}) {
  const [staff, setStaff] = useState(initial);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [closing, setClosing] = useState<StaffRecord | null>(null);
  /** Parola sıfırlanan satır; alan yalnızca açıldığında görünür. */
  const [resetting, setResetting] = useState<{ id: string; value: string } | null>(null);

  async function send(url: string, method: string, body: unknown, key: string) {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string; staff?: StaffRecord }
        | null;

      if (!response.ok || !data?.staff) {
        setError(data?.error ?? "İşlem tamamlanamadı.");
        return null;
      }
      return data.staff;
    } catch {
      setError("Sunucuya ulaşılamadı.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const created = await send("/api/admin/staff", "POST", draft, "new");
    if (!created) return;
    setStaff((rows) => [created, ...rows]);
    setDraft(EMPTY);
    setDone(`${created.email} eklendi.`);
  }

  async function patch(row: StaffRecord, body: Record<string, unknown>, note: string) {
    const updated = await send(`/api/admin/staff/${row.id}`, "PATCH", body, row.id);
    if (!updated) return;
    setStaff((rows) => rows.map((item) => (item.id === updated.id ? updated : item)));
    setDone(note);
  }

  const owners = staff.filter((row) => row.role === "OWNER" && row.active).length;

  return (
    <div className="max-w-[900px] space-y-10">
      <header>
        <p className="tag text-flame">Erişim</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold text-bone">Personel</h1>
        <p className="mt-3 text-sm text-smoke">
          Panele kimin girebileceği ve ne yapabileceği buradan belirlenir. Her kullanıcı
          kendi parolasıyla girer; siparişi kimin iptal ettiği ancak böyle kayda geçer.
        </p>
      </header>

      {error && <Notice kind="error" message={error} />}
      {done && <Notice kind="success" message={done} />}

      {/*
        Hiç kullanıcı yoksa panele ortak parolayla girilmiştir. Bu ekranın ilk
        işi o durumu bitirmek: aksi hâlde kayıtlardaki her fail "admin" kalır.
      */}
      {staff.length === 0 && (
        <p className="border border-amber/60 bg-amber/10 px-5 py-4 text-sm text-amber">
          Henüz panel kullanıcısı yok — şu an ortak kurtarma parolasıyla girdiniz.
          İlk iş kendinize <strong>Sahip</strong> rolünde bir hesap açmak olmalı.
        </p>
      )}

      {/* --- yeni kullanıcı --- */}
      <section className="border border-line bg-char p-6">
        <h2 className="mb-5 font-display text-xl font-extrabold text-bone">
          Yeni kullanıcı
        </h2>

        <form onSubmit={create} className="grid gap-5 md:grid-cols-2">
          <Field label="E-posta">
            <TextInput
              type="email"
              required
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              placeholder="ad@samisdoener.de"
            />
          </Field>

          <Field label="Ad" hint="Listede ve kayıtlarda görünür.">
            <TextInput
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Mehmet"
            />
          </Field>

          <Field label="Parola" hint="En az 8 karakter. Kişi ilk girişte değiştirebilir.">
            <TextInput
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={draft.password}
              onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              placeholder="••••••••"
            />
          </Field>

          <Field label="Rol" hint={ROLE_HINTS[draft.role]}>
            <Select
              value={draft.role}
              onChange={(e) => setDraft({ ...draft, role: e.target.value as AdminRole })}
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </Field>

          <div className="md:col-span-2">
            <Button type="submit" disabled={busy === "new"}>
              {busy === "new" ? "EKLENİYOR…" : "KULLANICI EKLE"}
            </Button>
          </div>
        </form>
      </section>

      {/* --- mevcut kullanıcılar --- */}
      <section>
        <h2 className="mb-4 font-display text-xl font-extrabold text-bone">
          Panele girebilenler
        </h2>

        {staff.length === 0 ? (
          <p className="border border-line bg-char px-5 py-6 text-sm text-smoke">
            Kayıtlı kullanıcı yok.
          </p>
        ) : (
          <ul className="divide-y divide-line border border-line">
            {staff.map((row) => {
              const self = row.id === currentUserId;
              const lastOwner = row.role === "OWNER" && row.active && owners <= 1;

              return (
                <li key={row.id} className={`bg-char p-5 ${row.active ? "" : "opacity-60"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-bone">
                        {row.name || row.email}
                        {self && <span className="ml-2 text-xs text-amber">(siz)</span>}
                      </p>
                      {row.name && (
                        <p className="truncate text-xs text-smoke">{row.email}</p>
                      )}
                      <p className="mt-1 text-xs text-smoke/70">
                        Son giriş:{" "}
                        {row.lastLoginAt ? DATE.format(new Date(row.lastLoginAt)) : "hiç"}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={row.active ? "on" : "off"}>
                        {row.active ? ROLE_LABELS[row.role].toUpperCase() : "KAPALI"}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line/60 pt-4">
                    {/* Rol değişimi o kişinin açık oturumlarını düşürür — sunucu
                        `tokenVersion`'ı artırır; yetkisi düşen biri sekiz saat
                        daha eski yetkisiyle dolaşmasın. */}
                    <label className="block">
                      <span className="tag mb-1.5 block text-smoke">Rol</span>
                      <Select
                        value={row.role}
                        disabled={self || !row.active || busy === row.id}
                        onChange={(e) =>
                          void patch(
                            row,
                            { role: e.target.value },
                            `${row.email} rolü güncellendi; açık oturumları düştü.`
                          )
                        }
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </Select>
                    </label>

                    {resetting?.id === row.id ? (
                      <>
                        <label className="block min-w-[180px] flex-1">
                          <span className="tag mb-1.5 block text-smoke">Yeni parola</span>
                          <TextInput
                            type="password"
                            autoComplete="new-password"
                            minLength={8}
                            value={resetting.value}
                            onChange={(e) =>
                              setResetting({ id: row.id, value: e.target.value })
                            }
                            placeholder="••••••••"
                          />
                        </label>
                        <Button
                          disabled={busy === row.id || resetting.value.length < 8}
                          onClick={() => {
                            void patch(
                              row,
                              { password: resetting.value },
                              `${row.email} parolası değişti; açık oturumları düştü.`
                            ).then(() => setResetting(null));
                          }}
                        >
                          KAYDET
                        </Button>
                        <Button variant="ghost" onClick={() => setResetting(null)}>
                          VAZGEÇ
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        disabled={!row.active}
                        onClick={() => setResetting({ id: row.id, value: "" })}
                      >
                        PAROLAYI SIFIRLA
                      </Button>
                    )}

                    <div className="ml-auto">
                      {row.active ? (
                        <Button
                          variant="danger"
                          disabled={self || lastOwner || busy === row.id}
                          onClick={() => setClosing(row)}
                          title={
                            self
                              ? "Kendi hesabınızı kapatamazsınız."
                              : lastOwner
                                ? "Paneldeki son sahip kapatılamaz."
                                : undefined
                          }
                        >
                          ERİŞİMİ KAPAT
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          disabled={busy === row.id}
                          onClick={() =>
                            void patch(row, { active: true }, `${row.email} yeniden açıldı.`)
                          }
                        >
                          YENİDEN AÇ
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-4 text-xs leading-relaxed text-smoke/70">
          Kullanıcı <strong className="text-smoke">silinmez, kapatılır</strong>: silinseydi
          o kişinin geçmişte iptal ettiği siparişin faili kayıtta boşa düşerdi. Kapalı hesap
          panele giremez.
        </p>
      </section>

      <ConfirmDialog
        open={closing !== null}
        title="Erişimi kapat"
        message={
          closing
            ? `${closing.email} bundan sonra panele giremeyecek ve açık oturumları anında düşecek. Kayıtlardaki geçmişi olduğu gibi kalır; gerekirse hesabı yeniden açabilirsiniz.`
            : ""
        }
        confirmLabel="ERİŞİMİ KAPAT"
        busy={busy === closing?.id}
        onCancel={() => setClosing(null)}
        onConfirm={() => {
          if (!closing) return;
          void patch(closing, { active: false }, `${closing.email} erişimi kapatıldı.`).then(
            () => setClosing(null)
          );
        }}
      />
    </div>
  );
}
