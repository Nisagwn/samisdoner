"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { AddressRecord } from "@/lib/account/addresses";
import { useDeliveryCities, zipsForCity } from "@/lib/delivery/useDeliveryCities";
import { accountTexts } from "./texts";
import { PanelHeader, SelectField, TextField } from "./fields";
import { useScrollLock } from "@/lib/useScrollLock";

/**
 * Adres defteri.
 *
 * Ekranın kuralı panelinkiyle aynı: **düzenle → kaydet**. Listede tek dokunuşla
 * değişen hiçbir alan yok; "varsayılan yap" dışında her şey formda değişir ve
 * tek bir kayıtla yazılır. (Varsayılan seçimi bilinçli olarak tek tık: tek bir
 * bayrağı değiştirir, geri alması da tek tık.)
 *
 * Posta kodu **sorulmaz, türetilir**: müşteri listeden yerini seçer, kod ona
 * göre dolar (bkz. `components/checkout/AddressFields`). Defterin ödeme
 * formuyla aynı listeyi kullanması şart — defterde ödeme formunun kabul
 * etmediği bir yer yazılabilseydi, müşteri onu seçtiğinde sipariş sunucuda
 * reddedilirdi. Liste okunamazsa alanlar serbest metne düşer; adresini
 * düzeltmek isteyen müşteriyi teslimat ucunun o anki durumu yüzünden formdan
 * çıkarmak ölçüsüz olurdu.
 *
 * Adres burada **kopyalanmak üzere** tutulur: siparişe gönderilirken alanlar
 * siparişin içine yazılır, bağ kurulmaz. Bu yüzden bir adresi silmek ya da
 * düzeltmek eski siparişlerin nereye gittiğini değiştirmez ve ekranda da
 * böyle söylenir.
 */

type Draft = {
  label: string;
  street: string;
  houseNo: string;
  zip: string;
  city: string;
  floor: string;
  bellName: string;
  isDefault: boolean;
};

const EMPTY: Draft = {
  label: "",
  street: "",
  houseNo: "",
  zip: "",
  city: "",
  floor: "",
  bellName: "",
  isDefault: false,
};

function toDraft(address: AddressRecord): Draft {
  return {
    label: address.label,
    street: address.street,
    houseNo: address.houseNo,
    zip: address.zip,
    city: address.city,
    floor: address.floor,
    bellName: address.bellName,
    isDefault: address.isDefault,
  };
}

export default function AddressBook({
  addresses,
  max,
}: {
  addresses: AddressRecord[];
  max: number;
}) {
  const { lang } = useLanguage();
  const t = accountTexts(lang !== "tr");
  const router = useRouter();

  const [draft, setDraft] = useState<Draft | null>(null);
  /** null = yeni adres, dolu = düzenlenen adresin kimliği. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AddressRecord | null>(null);
  useScrollLock(pendingDelete !== null);

  const { cities, failed: citiesFailed } = useDeliveryCities();
  const full = addresses.length >= max;

  async function send(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? t.saveFailed);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError(t.serverError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;

    const payload = {
      label: draft.label.trim(),
      street: draft.street.trim(),
      houseNo: draft.houseNo.trim(),
      zip: draft.zip.trim(),
      city: draft.city.trim(),
      floor: draft.floor.trim(),
      bellName: draft.bellName.trim(),
      isDefault: draft.isDefault,
    };

    const ok = editingId
      ? await send(`/api/account/addresses/${encodeURIComponent(editingId)}`, "PATCH", payload)
      : await send("/api/account/addresses", "POST", payload);

    if (ok) {
      setDraft(null);
      setEditingId(null);
      setSaved(true);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const ok = await send(
      `/api/account/addresses/${encodeURIComponent(pendingDelete.id)}`,
      "DELETE"
    );
    if (ok) setPendingDelete(null);
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  /** Serbest metne düşme koşulu: liste okunamadı ya da açık bölge yok. */
  const freeText = citiesFailed || (cities !== null && cities.length === 0);

  const draftZips = zipsForCity(cities, draft?.city ?? "");

  /*
   * Düzenlenen adresin yeri listede olmayabilir: işletme o bölgeyi kapatmış
   * olabilir. Seçenek olarak eklenmezse açılır liste boş görünür ve kaydetmek
   * müşterinin adresini sessizce siler — kapanmış bir bölge, kayıtlı adresi
   * bozmak için sebep değil.
   */
  const cityOptions = useMemo(() => {
    const names = (cities ?? []).map((entry) => entry.city);
    const current = draft?.city.trim();
    if (current && !names.includes(current)) names.push(current);
    return names.sort((a, b) => a.localeCompare(b, "de"));
  }, [cities, draft?.city]);

  /* Tek posta kodu olan yerde seçim yaptırmanın anlamı yok. */
  useEffect(() => {
    if (!draft || draftZips.length !== 1) return;
    if (draft.zip !== draftZips[0].zip) {
      setDraft((current) => (current ? { ...current, zip: draftZips[0].zip } : current));
    }
  }, [draft, draftZips]);

  return (
    <section>
      <PanelHeader title={t.addressesTitle} lead={t.addressesLead} />

      {error && (
        <p role="alert" className="mb-5 border border-flame/50 bg-flame/10 px-4 py-3 text-sm text-flame">
          {error}
        </p>
      )}
      {saved && !draft && (
        <p role="status" className="mb-5 text-sm text-herb">
          {t.saved}
        </p>
      )}

      {addresses.length === 0 && !draft && (
        <p className="border border-dashed border-line px-4 py-8 text-center text-sm text-smoke">
          {t.addressesEmpty}
        </p>
      )}

      <ul className="space-y-3">
        {addresses.map((address) => (
          <li
            key={address.id}
            className={`border bg-char p-4 ${address.isDefault ? "border-amber/60" : "border-line"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display font-bold text-bone">
                  {address.label || address.street}
                  {address.isDefault && (
                    <span className="tag ml-3 border border-amber/60 px-2 py-0.5 text-amber">
                      {t.isDefault}
                    </span>
                  )}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-smoke">
                  {address.street} {address.houseNo}
                  <br />
                  {address.zip} {address.city}
                  {(address.floor || address.bellName) && (
                    <>
                      <br />
                      <span className="text-smoke/70">
                        {[address.floor, address.bellName].filter(Boolean).join(" · ")}
                      </span>
                    </>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {!address.isDefault && (
                  <button
                    onClick={() =>
                      send(`/api/account/addresses/${encodeURIComponent(address.id)}`, "PATCH", {
                        action: "default",
                      })
                    }
                    disabled={busy}
                    className="focus-ring tag border border-line px-3 py-1.5 text-smoke transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
                  >
                    {t.setDefault}
                  </button>
                )}
                <button
                  onClick={() => {
                    setEditingId(address.id);
                    setDraft(toDraft(address));
                    setError(null);
                    setSaved(false);
                  }}
                  className="focus-ring tag border border-amber px-3 py-1.5 text-amber transition-colors hover:bg-amber hover:text-void"
                >
                  {t.edit}
                </button>
                <button
                  onClick={() => setPendingDelete(address)}
                  className="focus-ring tag border border-line px-3 py-1.5 text-smoke transition-colors hover:border-flame hover:text-flame"
                >
                  {t.remove}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {!draft && (
        <div className="mt-5">
          <button
            onClick={() => {
              setEditingId(null);
              // İlk adres zaten varsayılan olacak; kutuyu işaretli açmak
              // kullanıcıya doğru beklentiyi verir.
              setDraft({ ...EMPTY, isDefault: addresses.length === 0 });
              setError(null);
              setSaved(false);
            }}
            disabled={full}
            className="focus-ring border border-amber px-5 py-2.5 font-display text-xs font-extrabold tracking-wider text-amber transition-colors hover:bg-amber hover:text-void disabled:opacity-40"
          >
            + {t.newAddress}
          </button>
          {full && <p className="mt-2 text-xs text-smoke/70">{t.addressLimit}</p>}
        </div>
      )}

      {draft && (
        <form onSubmit={saveDraft} className="mt-6 border border-line bg-char p-5" noValidate>
          <h3 className="mb-5 font-display text-lg font-bold text-amber">
            {editingId ? t.editAddress : t.newAddress}
          </h3>

          <div className="space-y-4">
            <TextField
              id="label"
              label={t.labelLabel}
              hint={t.labelHint}
              value={draft.label}
              maxLength={40}
              onChange={(e) => set("label", e.target.value)}
            />

            <div className="grid grid-cols-[1fr_5rem] gap-4">
              <TextField
                id="street"
                label={t.street}
                value={draft.street}
                autoComplete="address-line1"
                maxLength={120}
                onChange={(e) => set("street", e.target.value)}
              />
              <TextField
                id="houseNo"
                label={t.houseNo}
                value={draft.houseNo}
                maxLength={12}
                onChange={(e) => set("houseNo", e.target.value)}
              />
            </div>

            {freeText ? (
              /* Liste okunamadı — müşteri adresini yine de yazabilmeli. */
              <div className="grid grid-cols-[7rem_1fr] gap-4">
                <TextField
                  id="zip"
                  label={t.zip}
                  value={draft.zip}
                  inputMode="numeric"
                  maxLength={5}
                  autoComplete="postal-code"
                  onChange={(e) => set("zip", e.target.value.replace(/\D/g, "").slice(0, 5))}
                />
                <TextField
                  id="city"
                  label={t.city}
                  value={draft.city}
                  autoComplete="address-level2"
                  maxLength={80}
                  onChange={(e) => set("city", e.target.value)}
                />
              </div>
            ) : (
              <div className="space-y-4">
                <div className={draftZips.length > 1 ? "grid gap-4 sm:grid-cols-2" : undefined}>
                  <SelectField
                    id="city"
                    label={t.city}
                    value={draft.city}
                    autoComplete="address-level2"
                    onChange={(e) => {
                      set("city", e.target.value);
                      // Yer değişince eski posta kodu o yere ait olmayabilir.
                      set("zip", "");
                    }}
                  >
                    <option value="">{cities === null ? t.loading : t.selectCity}</option>
                    {cityOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </SelectField>

                  {/* İki posta kodlu yer — burada seçim gerçekten müşterinin. */}
                  {draftZips.length > 1 && (
                    <SelectField
                      id="zip"
                      label={t.zip}
                      value={draft.zip}
                      autoComplete="postal-code"
                      onChange={(e) => set("zip", e.target.value)}
                    >
                      <option value="">{t.selectZip}</option>
                      {draftZips.map((entry) => (
                        <option key={entry.zip} value={entry.zip}>
                          {entry.zip}
                        </option>
                      ))}
                    </SelectField>
                  )}
                </div>

                {/* Kod hiç yazılmadığı için en az bir kez okunabilmeli. */}
                {draft.zip && draftZips.length <= 1 && (
                  <p className="font-mono text-[11px] text-smoke">
                    {t.zip} {draft.zip}
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="floor"
                label={t.floor}
                hint={t.floorHint}
                value={draft.floor}
                maxLength={60}
                onChange={(e) => set("floor", e.target.value)}
              />
              <TextField
                id="bellName"
                label={t.bellName}
                hint={t.bellHint}
                value={draft.bellName}
                maxLength={80}
                onChange={(e) => set("bellName", e.target.value)}
              />
            </div>

            <label className="flex items-center gap-3 text-sm text-smoke">
              <input
                type="checkbox"
                checked={draft.isDefault}
                onChange={(e) => set("isDefault", e.target.checked)}
                className="h-4 w-4 accent-amber"
              />
              {t.makeDefault}
            </label>
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm text-flame">
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={busy}
              className="focus-ring border border-amber px-5 py-2.5 font-display text-xs font-extrabold tracking-wider text-amber transition-colors hover:bg-amber hover:text-void disabled:opacity-50"
            >
              {busy ? t.saving : t.save}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setEditingId(null);
                setError(null);
              }}
              className="focus-ring border border-line px-5 py-2.5 text-sm text-smoke transition-colors hover:border-amber hover:text-amber"
            >
              {t.cancel}
            </button>
          </div>
        </form>
      )}

      {pendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t.deleteAddressTitle}
          className="fixed inset-0 z-[80] overflow-y-auto overscroll-contain bg-void/85 backdrop-blur-sm"
        >
          <div className="flex min-h-full items-center justify-center p-5">
          <div className="w-full max-w-[420px] border border-line bg-char p-7">
            <h3 className="font-display text-xl font-extrabold text-bone">
              {t.deleteAddressTitle}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-smoke">{t.deleteAddressText}</p>
            <p className="mt-3 text-sm text-bone">
              {pendingDelete.street} {pendingDelete.houseNo}, {pendingDelete.zip}{" "}
              {pendingDelete.city}
            </p>
            <div className="mt-7 flex flex-wrap justify-end gap-3">
              <button
                onClick={() => setPendingDelete(null)}
                className="focus-ring border border-line px-4 py-2.5 text-sm text-smoke transition-colors hover:border-amber hover:text-amber"
              >
                {t.cancel}
              </button>
              <button
                onClick={confirmDelete}
                disabled={busy}
                className="focus-ring border border-flame bg-flame px-4 py-2.5 text-sm font-bold text-void disabled:opacity-50"
              >
                {t.remove}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}
    </section>
  );
}
