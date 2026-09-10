"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatCents } from "@/lib/money";
import type { DeliveryZoneRecord } from "@/lib/orders/zones";
import { Badge, Button, ConfirmDialog, Field, Notice, TextInput, Toggle } from "./ui";

/**
 * Teslimat bölgeleri ekranı.
 *
 * Sipariş akışı yalnızca bu listeye bakar: burada satırı olmayan (ya da
 * kapatılmış) bir posta kodu için müşteriye "bu bölgeye teslimat yapılmıyor"
 * denir. Tutarlar panelde Euro girilir, sunucuda cent'e çevrilir.
 */

type Form = {
  postalCode: string;
  city: string;
  minOrder: string;
  fee: string;
  freeOver: string;
  etaMinutes: string;
  /**
   * Bölge siparişe açık mı.
   *
   * Eskiden satırdaki anahtarla tek dokunuşta değişiyordu; yanlış dokunuş bir
   * posta kodunu sessizce siparişe kapatıyor ve bunu ancak müşteri
   * "teslimat yapılmıyor" uyarısını gördüğünde fark ediyorduk. Artık diğer
   * alanlarla birlikte düzenlenip birlikte kaydediliyor.
   */
  active: boolean;
};

const EMPTY: Form = {
  postalCode: "",
  city: "",
  minOrder: "15,00",
  fee: "2,00",
  freeOver: "30,00",
  etaMinutes: "45",
  active: true,
};

/** 1500 → "15,00" — düzenleme kutusuna girecek biçim. */
function centsToInput(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2).replace(".", ",");
}

function toForm(zone: DeliveryZoneRecord): Form {
  return {
    postalCode: zone.postalCode,
    city: zone.city,
    minOrder: centsToInput(zone.minOrderCents),
    fee: centsToInput(zone.feeCents),
    freeOver: centsToInput(zone.freeOverCents),
    etaMinutes: String(zone.etaMinutes),
    active: zone.active,
  };
}

export default function ZoneManager({ zones }: { zones: DeliveryZoneRecord[] }) {
  const router = useRouter();

  /**
   * Şehre göre gruplanmış liste.
   *
   * Müşteri tarafındaki adres seçimi de "önce şehir, sonra posta kodu"
   * biçiminde çalışıyor; panelin aynı düzeni göstermesi, işletmecinin
   * müşterinin göreceği listeyi zihninde kurmasını sağlıyor. Şehri girilmemiş
   * kayıtlar posta koduyla anılır — boş başlıklı bir grup okunmaz olurdu.
   */
  const grouped = useMemo(() => {
    const byCity = new Map<string, DeliveryZoneRecord[]>();
    for (const zone of zones) {
      const city = zone.city.trim() || zone.postalCode;
      byCity.set(city, [...(byCity.get(city) ?? []), zone]);
    }
    return [...byCity.entries()]
      .map(([city, list]) => ({ city, zones: list }))
      .sort((a, b) => a.city.localeCompare(b.city, "de"));
  }, [zones]);

  /**
   * Açık bölge yoksa teslimat fiilen kapalıdır: `deliveryEnabled` açık olsa
   * bile her adres "bölge dışı" diye reddedilir. Bu sessiz arıza bir kez
   * yaşandı; ekranın en üstünde açıkça söylenmesi bundan.
   */
  const activeCount = zones.filter((zone) => zone.active).length;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<Form>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Form>(EMPTY);
  const [pendingDelete, setPendingDelete] = useState<DeliveryZoneRecord | null>(null);

  async function send(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "İşlem başarısız oldu.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Sunucuya ulaşılamadı.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addZone(event: React.FormEvent) {
    event.preventDefault();
    if (await send("/api/admin/zones", "POST", draft)) setDraft(EMPTY);
  }

  async function saveEdit(id: string) {
    if (await send(`/api/admin/zones/${encodeURIComponent(id)}`, "PATCH", editing)) {
      setEditingId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    if (await send(`/api/admin/zones/${encodeURIComponent(pendingDelete.id)}`, "DELETE")) {
      setPendingDelete(null);
    }
  }

  /** Ekleme ve düzenleme aynı alanları kullanır; tek yerde tanımlanır. */
  const fields = (form: Form, set: (next: Form) => void, scope: string) => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Posta kodu">
        <TextInput
          value={form.postalCode}
          onChange={(e) => set({ ...form, postalCode: e.target.value })}
          placeholder="94343"
          inputMode="numeric"
          maxLength={5}
          aria-label={`${scope} posta kodu`}
        />
      </Field>
      <Field label="Şehir / semt">
        <TextInput
          value={form.city}
          onChange={(e) => set({ ...form, city: e.target.value })}
          placeholder="Hengersberg"
          maxLength={80}
          aria-label={`${scope} şehir`}
        />
      </Field>
      <Field label="Minimum sepet (€)" hint="Bu tutarın altındaki sepet bu bölgeye gönderilmez.">
        <TextInput
          value={form.minOrder}
          onChange={(e) => set({ ...form, minOrder: e.target.value })}
          inputMode="decimal"
          aria-label={`${scope} minimum sepet`}
        />
      </Field>
      <Field label="Teslimat ücreti (€)">
        <TextInput
          value={form.fee}
          onChange={(e) => set({ ...form, fee: e.target.value })}
          inputMode="decimal"
          aria-label={`${scope} teslimat ücreti`}
        />
      </Field>
      <Field label="Ücretsiz teslimat eşiği (€)" hint="0 = eşik yok, ücret her zaman alınır.">
        <TextInput
          value={form.freeOver}
          onChange={(e) => set({ ...form, freeOver: e.target.value })}
          inputMode="decimal"
          aria-label={`${scope} ücretsiz teslimat eşiği`}
        />
      </Field>
      <Field label="Tahmini süre (dk)" hint="Müşteriye gösterilen teslimat süresi.">
        <TextInput
          value={form.etaMinutes}
          onChange={(e) => set({ ...form, etaMinutes: e.target.value })}
          inputMode="numeric"
          aria-label={`${scope} tahmini süre`}
        />
      </Field>

      <Field label="Durum" hint="Kapalı bölgeye sipariş verilemez; ayarlar korunur.">
        <Toggle
          checked={form.active}
          onChange={(next) => set({ ...form, active: next })}
          onLabel="AÇIK — TESLİMAT VAR"
          offLabel="KAPALI — TESLİMAT YOK"
        />
      </Field>
    </div>
  );

  return (
    <div className="min-w-0">
      {/* Sayfa başlığı kabuğa ait; burası ekranın ikinci bölümü. */}
      <header className="mb-8">
        <h2 className="font-display text-lg font-bold text-bone">Teslimat bölgeleri</h2>
        <p className="mt-2 text-sm leading-relaxed text-smoke">
          Sipariş yalnızca bu listedeki posta kodlarına verilebilir. Listede olmayan
          ya da kapatılmış bir posta kodu girildiğinde müşteriye &quot;bu bölgeye
          teslimat yapılmıyor&quot; denir.
        </p>
      </header>

      {zones.length > 0 && activeCount === 0 && (
        <p
          role="alert"
          className="mb-8 border border-flame/60 bg-flame/10 px-4 py-3 text-sm text-flame"
        >
          Açık teslimat bölgesi yok. Site şu anda hiçbir adrese teslimat
          yapamıyor; her sipariş &quot;bu bölgeye teslimat yapılmıyor&quot; diye
          reddedilir. En az bir posta kodunu açın.
        </p>
      )}

      <section className="border border-line bg-char p-5 md:p-6 mb-8">
        <h2 className="font-display font-bold text-lg text-bone mb-5">Yeni bölge ekle</h2>
        <form onSubmit={addZone}>
          {fields(draft, setDraft, "Yeni bölge")}
          <div className="mt-5">
            <Button type="submit" disabled={busy || draft.postalCode.trim() === ""}>
              + BÖLGE EKLE
            </Button>
          </div>
        </form>
      </section>

      {error && (
        <div className="mb-6">
          <Notice kind="error" message={error} />
        </div>
      )}

      <div className="space-y-6">
        {grouped.map((group) => (
          <section key={group.city}>
            <header className="mb-2 flex items-center justify-between gap-3 border-b border-line pb-2">
              <h2 className="font-display font-bold text-bone">{group.city}</h2>
              <span className="tag tabular-nums text-smoke">
                {group.zones.filter((z) => z.active).length} / {group.zones.length} açık
              </span>
            </header>

            <ul className="border border-line divide-y divide-line">
              {group.zones.map((zone) => (
                <li key={zone.id} className="bg-char p-4 md:p-5">
            {editingId === zone.id ? (
              <>
                {fields(editing, setEditing, "Bölge")}
                <div className="flex flex-wrap gap-2 mt-5">
                  <Button onClick={() => saveEdit(zone.id)} disabled={busy}>
                    KAYDET
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingId(null)} disabled={busy}>
                    VAZGEÇ
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-display font-bold text-bone">
                    <span className="tabular-nums">{zone.postalCode}</span>
                    {zone.city && <span className="text-smoke font-normal"> · {zone.city}</span>}
                  </p>
                  <p className="tag text-smoke mt-1.5 tabular-nums">
                    min {formatCents(zone.minOrderCents)} · ücret{" "}
                    {zone.feeCents === 0 ? "yok" : formatCents(zone.feeCents)}
                    {zone.freeOverCents > 0 && ` · ${formatCents(zone.freeOverCents)} üzeri bedava`}
                    {" · ~"}
                    {zone.etaMinutes} dk
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Badge tone={zone.active ? "on" : "off"}>
                    {zone.active ? "AÇIK — TESLİMAT VAR" : "KAPALI — TESLİMAT YOK"}
                  </Badge>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditingId(zone.id);
                      setEditing(toForm(zone));
                      setError(null);
                    }}
                  >
                    DÜZENLE
                  </Button>
                  <Button variant="danger" onClick={() => setPendingDelete(zone)}>
                    SİL
                  </Button>
                </div>
              </div>
            )}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {zones.length === 0 && (
          <p className="border border-line bg-char px-5 py-10 text-center text-sm text-smoke">
            Henüz teslimat bölgesi yok — bu haliyle hiçbir adrese teslimat yapılamaz.
          </p>
        )}
      </div>

      <p className="text-xs text-smoke/70 mt-5 leading-relaxed">
        Açık/kapalı durumu da <strong className="text-bone">DÜZENLE</strong>
        {" "}içinde, diğer alanlarla birlikte değişir ve birlikte kaydedilir.
        Bölgeyi silmek yerine kapatmak, o posta kodunu geçici olarak (ör. yoğun bir
        akşamda) siparişe kapatmanın güvenli yoludur; ayarlar durur, sonra tek
        tıkla açılır.
      </p>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Teslimat bölgesini sil"
        message={`${pendingDelete?.postalCode ?? ""} posta kodu silinsin mi? Bu koddaki adreslere artık sipariş verilemez.`}
        confirmLabel="EVET, SİL"
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
