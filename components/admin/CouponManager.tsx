"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCents } from "@/lib/money";
import type { CouponRecord } from "@/lib/orders/coupons";
import { Badge, Button, ConfirmDialog, Field, Notice, Select, TextInput, Toggle } from "./ui";

/**
 * İndirim kuponları ekranı.
 *
 * Kupon tablosu ve doğrulama mantığı müşteri tarafı için yazılmıştı ama
 * işletmecinin kupon oluşturacağı bir yer yoktu — yani özellik kâğıt üstünde
 * vardı, pratikte yoktu. Bu ekran o boşluğu kapatıyor.
 *
 * ÜÇ TASARIM KARARI
 *
 * 1. **Ekleme formu kapalı başlar.** Kupon nadiren oluşturulur, sık okunur:
 *    ekranı açan kişi çoğunlukla "hangi kampanyalar açık" diye bakıyordur.
 *    Sekiz alanlık bir form her seferinde tepede durursa listeyi aşağı iter.
 *
 * 2. **Kaldırma düğmesi tek, sonucu iki türlü.** İşletmecinin istediği şey
 *    "bu kod artık çalışmasın"; kuponun kullanılmış olup olmadığına göre
 *    silinmesi ya da pasifleşmesi teknik bir ayrıntı. Sunucu hangisini
 *    yaptığını söyler, ekran da onu bildirir.
 *
 * 3. **Kullanım sayacı düzenlenemez.** Sayı kullanımın kendisinden doğuyor;
 *    elle düzeltilebilir olsaydı "kaç kez kullanıldı" sorusunun cevabı
 *    uydurulabilir olurdu.
 *
 * Tutarlar panelde Euro girilir, sunucuya cent gider — panelin geri kalanıyla
 * aynı (bkz. ZoneManager).
 */

type Form = {
  code: string;
  kind: "PERCENT" | "FIXED";
  /** Yüzde kuponunda yüzde, sabit kuponda Euro. İkisi de metin: kutu metindir. */
  value: string;
  minOrder: string;
  maxDiscount: string;
  fulfillment: "" | "DELIVERY" | "PICKUP";
  /** "2026-09-20T18:00" — `datetime-local` kutusunun biçimi. */
  startsAt: string;
  expiresAt: string;
  maxRedemptions: string;
  active: boolean;
};

const EMPTY: Form = {
  code: "",
  kind: "PERCENT",
  value: "10",
  minOrder: "0,00",
  maxDiscount: "0,00",
  fulfillment: "",
  startsAt: "",
  expiresAt: "",
  maxRedemptions: "0",
  active: true,
};

/* ------------------------------------------------------------ dönüşümler */

/** 1500 → "15,00" */
function centsToInput(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2).replace(".", ",");
}

/** "15,00" → 1500. Bozuk girdi 0 sayılır; sunucu zaten yeniden doğruluyor. */
function inputToCents(value: string): number {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

/**
 * `datetime-local` kutusu ile ISO arasındaki çevrim.
 *
 * Kutu **yerel** duvar saati verir ve saat dilimi taşımaz; sunucu ISO bekler.
 * `new Date("2026-09-20T18:00")` tarayıcının yerel saat dilimini varsayar —
 * panel işletmenin bilgisayarından açıldığı için doğru olan da budur:
 * işletmeci "akşam 6" yazdığında kendi saatini kastediyor.
 */
function localToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoToLocal(date: Date | null): string {
  if (!date) return "";
  // Yerel saate kaydırıp ISO'nun ilk 16 karakterini almak, kutunun beklediği
  // "YYYY-MM-DDTHH:mm" biçimini verir.
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function toForm(coupon: CouponRecord): Form {
  return {
    code: coupon.code,
    kind: coupon.kind,
    value: coupon.kind === "PERCENT" ? String(coupon.value) : centsToInput(coupon.value),
    minOrder: centsToInput(coupon.minOrderCents),
    maxDiscount: centsToInput(coupon.maxDiscountCents),
    fulfillment: coupon.fulfillment ?? "",
    startsAt: isoToLocal(coupon.startsAt),
    expiresAt: isoToLocal(coupon.expiresAt),
    maxRedemptions: String(coupon.maxRedemptions),
    active: coupon.active,
  };
}

/** Formu sunucunun beklediği gövdeye çevirir. */
function toBody(form: Form) {
  return {
    code: form.code.trim().toUpperCase(),
    kind: form.kind,
    // Yüzde kuponunda değer yüzdedir, sabit kuponda cent: tek alan, iki anlam
    // (bkz. Coupon.value üzerindeki şema notu).
    value: form.kind === "PERCENT" ? Number(form.value) || 0 : inputToCents(form.value),
    minOrderCents: inputToCents(form.minOrder),
    maxDiscountCents: form.kind === "PERCENT" ? inputToCents(form.maxDiscount) : 0,
    fulfillment: form.fulfillment === "" ? null : form.fulfillment,
    startsAt: localToIso(form.startsAt),
    expiresAt: localToIso(form.expiresAt),
    maxRedemptions: Number(form.maxRedemptions) || 0,
    active: form.active,
  };
}

/* ------------------------------------------------------------------ ekran */

export default function CouponManager({ coupons }: { coupons: CouponRecord[] }) {
  const router = useRouter();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Form>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Form>(EMPTY);
  const [pendingRetire, setPendingRetire] = useState<CouponRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "İşlem başarısız oldu.");
        return null;
      }
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      router.refresh();
      return data;
    } catch {
      setError("Sunucuya ulaşılamadı.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function addCoupon(event: React.FormEvent) {
    event.preventDefault();
    if (await send("/api/admin/coupons", "POST", toBody(draft))) {
      setDraft(EMPTY);
      setAdding(false);
    }
  }

  async function saveEdit(id: string) {
    if (await send(`/api/admin/coupons/${encodeURIComponent(id)}`, "PATCH", toBody(editing))) {
      setEditingId(null);
    }
  }

  async function confirmRetire() {
    if (!pendingRetire) return;
    const result = await send(
      `/api/admin/coupons/${encodeURIComponent(pendingRetire.id)}`,
      "DELETE"
    );
    if (result) {
      // Silme ile pasifleştirme aynı düğmeden çıkar; hangisi olduğu
      // söylenmezse işletmeci listede duran kuponu hata sanır.
      setNotice(
        result.outcome === "deleted"
          ? "Kupon silindi."
          : "Kupon kullanılmış olduğu için silinmedi, pasifleştirildi. Kod artık çalışmaz."
      );
      setPendingRetire(null);
    }
  }

  /** Ekleme ve düzenleme aynı alanları kullanır; tek yerde tanımlanır. */
  const fields = (form: Form, set: (next: Form) => void) => (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Kod" hint="Yalnızca harf ve rakam. Müşteri bunu yazacak.">
        <TextInput
          value={form.code}
          onChange={(e) => set({ ...form, code: e.target.value.toUpperCase() })}
          placeholder="DONER10"
          maxLength={40}
          required
        />
      </Field>

      <Field label="İndirim türü">
        <Select
          value={form.kind}
          onChange={(e) => set({ ...form, kind: e.target.value as Form["kind"] })}
        >
          <option value="PERCENT">Yüzde (%)</option>
          <option value="FIXED">Sabit tutar (€)</option>
        </Select>
      </Field>

      <Field
        label={form.kind === "PERCENT" ? "İndirim oranı (%)" : "İndirim tutarı (€)"}
        hint={
          form.kind === "PERCENT"
            ? "1–100 arası. Ara toplamdan düşülür, kurye ücretinden değil."
            : "Ara toplamdan düşülür; ara toplamı geçemez."
        }
      >
        <TextInput
          value={form.value}
          onChange={(e) => set({ ...form, value: e.target.value })}
          inputMode="decimal"
          required
        />
      </Field>

      {/* Tavan yalnızca yüzde kuponunda anlamlı: "%50 indirim ama en fazla
          5 €" gibi kampanyalar için. Sabit tutarlı kuponda kutu hiç çıkmaz,
          yoksa okunamayan bir kayıt oluşur. */}
      {form.kind === "PERCENT" ? (
        <Field label="En fazla indirim (€)" hint="0 = sınır yok.">
          <TextInput
            value={form.maxDiscount}
            onChange={(e) => set({ ...form, maxDiscount: e.target.value })}
            inputMode="decimal"
          />
        </Field>
      ) : (
        <div className="hidden sm:block" />
      )}

      <Field label="Asgari sepet tutarı (€)" hint="0 = eşik yok.">
        <TextInput
          value={form.minOrder}
          onChange={(e) => set({ ...form, minOrder: e.target.value })}
          inputMode="decimal"
        />
      </Field>

      <Field label="Geçerli olduğu sipariş türü">
        <Select
          value={form.fulfillment}
          onChange={(e) => set({ ...form, fulfillment: e.target.value as Form["fulfillment"] })}
        >
          <option value="">Teslimat ve gel-al</option>
          <option value="DELIVERY">Yalnızca teslimat</option>
          <option value="PICKUP">Yalnızca gel-al</option>
        </Select>
      </Field>

      <Field label="Başlangıç" hint="Boş bırakılırsa hemen geçerli olur.">
        <TextInput
          type="datetime-local"
          value={form.startsAt}
          onChange={(e) => set({ ...form, startsAt: e.target.value })}
        />
      </Field>

      <Field label="Bitiş" hint="Boş bırakılırsa süresiz.">
        <TextInput
          type="datetime-local"
          value={form.expiresAt}
          onChange={(e) => set({ ...form, expiresAt: e.target.value })}
        />
      </Field>

      <Field label="Kullanım sınırı" hint="Toplam kaç siparişte kullanılabilir. 0 = sınırsız.">
        <TextInput
          value={form.maxRedemptions}
          onChange={(e) => set({ ...form, maxRedemptions: e.target.value })}
          inputMode="numeric"
        />
      </Field>

      <Field label="Durum">
        <Toggle
          checked={form.active}
          onChange={(next) => set({ ...form, active: next })}
          onLabel="AÇIK"
          offLabel="KAPALI"
        />
      </Field>
    </div>
  );

  return (
    <section className="mt-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-extrabold text-bone">İndirim kuponları</h2>
          <p className="mt-1 text-sm text-smoke">
            Müşterinin ödeme ekranında girdiği kodlar. İndirim yalnızca ara toplama uygulanır.
          </p>
        </div>
        <Button variant={adding ? "ghost" : "primary"} onClick={() => setAdding(!adding)}>
          {adding ? "VAZGEÇ" : "+ YENİ KUPON"}
        </Button>
      </div>

      {error && <Notice kind="error" message={error} />}
      {notice && <Notice kind="success" message={notice} />}

      {adding && (
        <form onSubmit={addCoupon} className="mb-6 mt-4 border border-line bg-panel p-5">
          {fields(draft, setDraft)}
          <div className="mt-5 flex gap-3">
            <Button type="submit" disabled={busy}>
              KAYDET
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              VAZGEÇ
            </Button>
          </div>
        </form>
      )}

      {coupons.length === 0 ? (
        <p className="mt-4 border border-line bg-panel px-5 py-8 text-center text-sm text-smoke">
          Henüz kupon yok. Yeni bir kampanya açmak için yukarıdaki düğmeyi kullanın.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {coupons.map((coupon) => (
            <li key={coupon.id} className="border border-line bg-panel">
              {editingId === coupon.id ? (
                <div className="p-5">
                  {fields(editing, setEditing)}
                  <div className="mt-5 flex gap-3">
                    <Button onClick={() => saveEdit(coupon.id)} disabled={busy}>
                      KAYDET
                    </Button>
                    <Button variant="ghost" onClick={() => setEditingId(null)}>
                      VAZGEÇ
                    </Button>
                  </div>
                </div>
              ) : (
                <CouponRow
                  coupon={coupon}
                  onEdit={() => {
                    setEditingId(coupon.id);
                    setEditing(toForm(coupon));
                    setError(null);
                    setNotice(null);
                  }}
                  onRetire={() => setPendingRetire(coupon)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingRetire !== null}
        title="Kupon kaldırılsın mı?"
        message={
          pendingRetire
            ? `"${pendingRetire.code}" kodu artık çalışmayacak. ` +
              (pendingRetire.redeemedCount > 0
                ? "Bu kupon kullanıldığı için silinmez, pasifleştirilir — sipariş geçmişi kaydına bakıyor."
                : "Hiç kullanılmadığı için tamamen silinir.")
            : ""
        }
        confirmLabel="KALDIR"
        onConfirm={confirmRetire}
        onCancel={() => setPendingRetire(null)}
      />
    </section>
  );
}

/**
 * Listedeki tek satır.
 *
 * Kuralın tamamı tek bakışta okunabilmeli: kod, ne kadar indirdiği, hangi
 * koşullarda geçerli olduğu ve kaç kez kullanıldığı. İşletmeci "bu kampanya
 * ne yapıyordu" diye düzenleme ekranını açmak zorunda kalmasın.
 */
function CouponRow({
  coupon,
  onEdit,
  onRetire,
}: {
  coupon: CouponRecord;
  onEdit: () => void;
  onRetire: () => void;
}) {
  const discount =
    coupon.kind === "PERCENT"
      ? `%${coupon.value}` +
        (coupon.maxDiscountCents > 0 ? ` (en fazla ${formatCents(coupon.maxDiscountCents)})` : "")
      : formatCents(coupon.value);

  const conditions: string[] = [];
  if (coupon.minOrderCents > 0) conditions.push(`min. ${formatCents(coupon.minOrderCents)}`);
  if (coupon.fulfillment === "DELIVERY") conditions.push("yalnızca teslimat");
  if (coupon.fulfillment === "PICKUP") conditions.push("yalnızca gel-al");
  if (coupon.startsAt) conditions.push(`${formatDate(coupon.startsAt)} itibarıyla`);
  if (coupon.expiresAt) conditions.push(`${formatDate(coupon.expiresAt)} tarihine kadar`);

  const usage =
    coupon.maxRedemptions > 0
      ? `${coupon.redeemedCount} / ${coupon.maxRedemptions} kullanım`
      : `${coupon.redeemedCount} kullanım`;

  // Süresi geçmiş kupon "açık" görünmemeli: kayıt aktif olsa bile artık
  // çalışmıyor ve panelde yeşil bir rozet işletmeciyi yanıltır.
  const expired = coupon.expiresAt !== null && coupon.expiresAt.getTime() <= Date.now();
  const exhausted = coupon.maxRedemptions > 0 && coupon.redeemedCount >= coupon.maxRedemptions;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-base font-bold text-amber">{coupon.code}</span>
          <span className="text-sm text-bone">−{discount}</span>
          {!coupon.active ? (
            <Badge tone="off">KAPALI</Badge>
          ) : expired ? (
            <Badge tone="warn">SÜRESİ DOLDU</Badge>
          ) : exhausted ? (
            <Badge tone="warn">HAKKI DOLDU</Badge>
          ) : (
            <Badge tone="on">AÇIK</Badge>
          )}
        </div>
        <p className="mt-1.5 text-xs text-smoke">
          {conditions.length > 0 ? conditions.join(" · ") : "Koşulsuz"} — {usage}
        </p>
      </div>

      <div className="flex shrink-0 gap-2">
        <Button variant="ghost" onClick={onEdit}>
          DÜZENLE
        </Button>
        <Button variant="danger" onClick={onRetire}>
          KALDIR
        </Button>
      </div>
    </div>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
