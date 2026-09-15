"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatCents } from "@/lib/money";
import { citiesForPostalCode } from "@/data/deliveryAreas";
import {
  foldForSearch,
  knownCityNames,
  matchesZoneSearch,
  postalCodeCandidates,
} from "@/lib/orders/deliveryCities";
import type { DeliveryZoneRecord } from "@/lib/orders/zones";
import { Badge, Button, ConfirmDialog, Field, Notice, Select, TextInput, Toggle } from "./ui";

/**
 * Teslimat bölgeleri ekranı.
 *
 * Sipariş akışı yalnızca bu listeye bakar: burada satırı olmayan (ya da
 * kapatılmış) bir posta kodu için müşteriye "bu bölgeye teslimat yapılmıyor"
 * denir. Tutarlar panelde Euro girilir, sunucuda cent'e çevrilir.
 *
 * İki şey bilinçli olarak **kapalı başlar**: ekleme formu ve şehir grupları.
 * Ekran, elli küsur posta kodunun yönetilebildiği bir liste hâline gelince
 * hepsini aynı anda açık göstermek ne aranan bölgeyi bulmayı kolaylaştırıyor
 * ne de yeni bölge eklemeyi — yedi alanlık form her zaman tepede duruyor,
 * aradığın şehir onun altında kayboluyordu. Şimdi her şey tek tıkla açılıyor,
 * kapalıyken yalnızca şehir adı ve kaç kodunun açık olduğu görünüyor.
 *
 * Kapalı gruplar aranan şehri bulmayı kolaylaştırır ama bulunacak şeyin adını
 * bilmeyi şart koşar: elli küsur kod arasında "94333 hangi şehirdeydi" diye
 * bakan kişi grupları tek tek açmak zorunda kalıyordu. Listenin üstündeki
 * arama kutusu hem posta kodunda hem belediye adında arar ve eşleşen grupları
 * kendiliğinden açar — arayıp bulduğun şeye bir de tıklamak gerekmesin.
 *
 * Posta kodu ve şehir **yazılmaz, seçilir**: ikisi de resmî dizinden
 * (`data/deliveryAreas.ts`) gelir. Elle yazarken bir haneyi kaydırmanın cezası
 * ağır ve sessizdir — kod kaydedilir, o bölgeye hiçbir müşteri denk gelmez,
 * teslimat açıldı sanılır. Yine de her iki kutu da elle yazmaya izin verir:
 * dizin 25 km yarıçapla üretildi, işletme bir gün daha uzağa araç çıkarmaya
 * karar verirse panel buna engel olmamalı.
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

/**
 * Şehir başlığının sağındaki özet.
 *
 * Burada önce "0 / 1 açık" yazıyordu: iki sayı, bir bölü işareti ve tek
 * kelimelik bir sıfat. Hangi sayının ne olduğunu, neyin açık olduğunu ve
 * "açık"ın teslimat mı yoksa grubun kendisi mi olduğunu okuyanın çıkarması
 * gerekiyordu — aynı satırda grubu açıp kapatan bir düğme dururken. Ekran
 * ayda bir açılıyor; her açılışta yeniden çözülen bir kısaltma, kazandırdığı
 * yerden çok daha fazlasını götürür. Artık ne sorulduysa o yazıyor.
 */
function citySummary(total: number, active: number): string {
  if (total === 1) return active === 1 ? "Teslimat var" : "Teslimat yok";
  if (active === 0) return `${total} posta kodunun hiçbirine teslimat yok`;
  if (active === total) return `${total} posta kodunun tamamına teslimat var`;
  return `${total} posta kodundan ${active} tanesine teslimat var`;
}

/** Açılır listede "bu seçenek listede yok" anlamına gelen değer. */
const MANUAL = "__manual__";

type Option = { value: string; label: string; disabled?: boolean };

/**
 * Listeden seçtiren ama elle yazmaya da izin veren kutu.
 *
 * Neden iki ayrı kutu değil de tek kontrol: yan yana duran "seç" ve "ya da yaz"
 * kutuları, hangisinin kazandığını okuyandan gizler ve ikisi birden doluyken ne
 * kaydedileceği belirsizdir. Burada tek bir değer var; listeden mi geldiği yoksa
 * elle mi yazıldığı yalnızca görünümü değiştirir.
 *
 * Liste dışı bir değerle açılırsa (dizin yeniden üretilince yarıçap dışında
 * kalan eski bir kod) kutu kendiliğinden yazma kipinde başlar — kaydı düzenlemek
 * isteyen kişi değerini listede bulamayıp boş bir kutu görmez.
 */
function PickOrType({
  label,
  hint,
  ariaLabel,
  value,
  onChange,
  options,
  manualLabel,
  inputProps,
}: {
  label: string;
  hint?: string;
  ariaLabel: string;
  value: string;
  onChange: (next: string) => void;
  options: Option[];
  /** Listenin sonundaki "elle yaz" seçeneğinin metni. */
  manualLabel: string;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  const listed = value !== "" && options.some((option) => option.value === value);
  const [typing, setTyping] = useState(value !== "" && !listed);

  if (typing) {
    return (
      // Geri dönüş düğmesi `Field`'in dışında: `Field` bir <label>'dır ve
      // içine konan düğmeye yapılan tıklama etiketin kendi hedefine de gider.
      <div className="min-w-0">
        <Field label={label} hint={hint}>
          <TextInput
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-label={ariaLabel}
            autoFocus
            {...inputProps}
          />
        </Field>
        <button
          type="button"
          onClick={() => {
            setTyping(false);
            // Listeye dönerken elle yazılmış değeri bırakmak, kutuda
            // görünmeyen ama kaydedilecek bir değer demek olurdu.
            onChange("");
          }}
          className="focus-ring tag mt-2 text-smoke underline underline-offset-4 hover:text-amber"
        >
          ← LİSTEDEN SEÇ
        </button>
      </div>
    );
  }

  return (
    <Field label={label} hint={hint}>
      <Select
        value={listed ? value : ""}
        aria-label={ariaLabel}
        onChange={(event) => {
          if (event.target.value === MANUAL) {
            setTyping(true);
            onChange("");
            return;
          }
          onChange(event.target.value);
        }}
      >
        <option value="">Seçin…</option>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
        <option value={MANUAL}>{manualLabel}</option>
      </Select>
    </Field>
  );
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
   *
   * **Teslimat yapılan şehirler üstte.** Ekranı açan kişinin asıl sorusu
   * "şu an nereye gidiyoruz"; alfabetik sırada açık şehirler, dizinden
   * eklenip kapalı bekleyen onlarca köyün arasına dağılıyordu. Grubun içinde
   * de aynı kural: açık posta kodları önce, sonra posta koduna göre.
   */
  const grouped = useMemo(() => {
    const byCity = new Map<string, DeliveryZoneRecord[]>();
    for (const zone of zones) {
      const city = zone.city.trim() || zone.postalCode;
      byCity.set(city, [...(byCity.get(city) ?? []), zone]);
    }
    return [...byCity.entries()]
      .map(([city, list]) => ({
        city,
        zones: list
          .slice()
          .sort(
            (a, b) =>
              Number(b.active) - Number(a.active) || a.postalCode.localeCompare(b.postalCode)
          ),
      }))
      .sort((a, b) => {
        const aOpen = a.zones.some((zone) => zone.active);
        const bOpen = b.zones.some((zone) => zone.active);
        if (aOpen !== bOpen) return aOpen ? -1 : 1;
        return a.city.localeCompare(b.city, "de");
      });
  }, [zones]);

  /**
   * Arama kutusundaki metin, karşılaştırmaya hazır hâlde.
   *
   * Sadeleştirme her tuş vuruşunda bir kez yapılır; satır başına yapılsaydı
   * "strassk" yazan kişi her harfte elli küsur satırı yeniden çözümletirdi.
   */
  const [search, setSearch] = useState("");
  const needle = foldForSearch(search);

  /**
   * Ekranda görünen gruplar.
   *
   * Eşleşmeyen satırlar grubun içinden düşer, boşalan grup listeden düşer:
   * altında hiçbir şey olmayan bir şehir başlığı, tıklayınca boş açılan bir
   * söz olurdu.
   */
  const visible = useMemo(() => {
    if (needle === "") return grouped;
    return grouped
      .map((group) => ({
        city: group.city,
        zones: group.zones.filter((zone) => matchesZoneSearch(zone, needle)),
      }))
      .filter((group) => group.zones.length > 0);
  }, [grouped, needle]);

  const visibleCount = visible.reduce((total, group) => total + group.zones.length, 0);

  /**
   * Açık bölge yoksa teslimat fiilen kapalıdır: `deliveryEnabled` açık olsa
   * bile her adres "bölge dışı" diye reddedilir. Bu sessiz arıza bir kez
   * yaşandı; ekranın en üstünde açıkça söylenmesi bundan.
   */
  const activeCount = zones.filter((zone) => zone.active).length;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Form>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Form>(EMPTY);
  const [pendingDelete, setPendingDelete] = useState<DeliveryZoneRecord | null>(null);

  /**
   * Açık şehir grupları.
   *
   * Tek grup varsa kapalı başlamanın anlamı yok: açmak için tıklanacak tek bir
   * şey vardır ve o da zaten aranan şeydir.
   */
  const [openCities, setOpenCities] = useState<Set<string>>(
    () => new Set(grouped.length === 1 ? [grouped[0].city] : [])
  );

  const toggleCity = (city: string) =>
    setOpenCities((current) => {
      const next = new Set(current);
      if (!next.delete(city)) next.add(city);
      return next;
    });

  /** Eklenmiş kodlar işaretli gelsin diye (bkz. `postalCodeCandidates`). */
  const candidates = useMemo(
    () => postalCodeCandidates(zones.map((zone) => zone.postalCode)),
    [zones]
  );
  const cityNames = useMemo(() => knownCityNames(), []);

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
    if (await send("/api/admin/zones", "POST", draft)) {
      setDraft(EMPTY);
      setAdding(false);
      // Yeni bölgenin grubu açık gelsin: eklenen şey görünmeden "eklendi"
      // demek, işletmeciyi listeyi tarayıp aramaya bırakır.
      setOpenCities((current) => new Set(current).add(draft.city.trim() || draft.postalCode));
    }
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
  const fields = (form: Form, set: (next: Form) => void, scope: string) => {
    /*
     * Şehir seçenekleri seçilen koddan türer: 94342 seçildiyse listede yalnızca
     * Straßkirchen ve Irlbach vardır. Kod elle yazıldıysa (dizinde yok) hangi
     * belediyeye düştüğü bilinemez; o zaman dizindeki bütün adlar listelenir,
     * çünkü elle yazılan kod çoğunlukla yarıçap dışında kalmış bir komşu köydür.
     */
    const official = citiesForPostalCode(form.postalCode);
    const cityOptions = (official.length > 0 ? official : cityNames).map((name) => ({
      value: name,
      label: name,
    }));

    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <PickOrType
          label="Posta kodu"
          hint="Liste: işletmeye 25 km'ye kadar olan resmî posta kodları, yakından uzağa."
          ariaLabel={`${scope} posta kodu`}
          value={form.postalCode}
          options={candidates.map((candidate) => ({
            value: candidate.postalCode,
            label: `${candidate.postalCode} — ${candidate.cities.join(", ")} · ${candidate.distanceKm
              .toFixed(1)
              .replace(".", ",")} km${candidate.taken ? " (ekli)" : ""}`,
            // Zaten satırı olan kod yeniden eklenemez; sunucu da benzersizlik
            // ihlalini 409 ile reddeder. Burada engellemek o hatayı hiç
            // doğurmaz — ama kod listede görünmeye devam eder.
            disabled: candidate.taken && candidate.postalCode !== form.postalCode,
          }))}
          manualLabel="Listede yok — elle yazayım…"
          onChange={(next) => {
            const cities = citiesForPostalCode(next);
            // Kod değişince eski şehir o koda ait olmayabilir. Tek belediyeli
            // kodda seçim yaptırmanın anlamı yok, doğrudan dolar.
            set({ ...form, postalCode: next, city: cities.length === 1 ? cities[0] : "" });
          }}
          inputProps={{ inputMode: "numeric", maxLength: 5, placeholder: "94343" }}
        />

        <PickOrType
          label="Şehir / belediye"
          hint="Müşteri adres seçerken bu adı görür."
          ariaLabel={`${scope} şehir`}
          value={form.city}
          options={cityOptions}
          manualLabel="Listede yok — elle yazayım…"
          onChange={(next) => set({ ...form, city: next })}
          inputProps={{ maxLength: 80, placeholder: "Hengersberg" }}
        />

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

        <Field
          label="Bu posta koduna teslimat"
          hint="Kapalıyken bu koddaki adresler sipariş veremez; yukarıdaki ayarlar silinmez, beklemeye alınır."
        >
          <Toggle
            checked={form.active}
            onChange={(next) => set({ ...form, active: next })}
            onLabel="TESLİMAT VAR — KAPATMAK İÇİN TIKLA"
            offLabel="TESLİMAT YOK — AÇMAK İÇİN TIKLA"
          />
        </Field>
      </div>
    );
  };

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

      {/*
        Ekleme formu kapalı başlar. Açıkken ekranın üçte birini kaplıyor ve
        günlük iş (bir bölgeyi kapatıp açmak) onun altında kalıyordu; oysa yeni
        bölge ayda bir eklenir.
      */}
      <section className="mb-8">
        {adding ? (
          <div className="border border-line bg-char p-5 md:p-6">
            <h2 className="font-display font-bold text-lg text-bone mb-5">Yeni bölge ekle</h2>
            <form onSubmit={addZone}>
              {fields(draft, setDraft, "Yeni bölge")}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button type="submit" disabled={busy || draft.postalCode.trim() === ""}>
                  BÖLGE EKLE
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAdding(false);
                    setDraft(EMPTY);
                    setError(null);
                  }}
                  disabled={busy}
                >
                  VAZGEÇ
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <Button
            onClick={() => {
              setAdding(true);
              setError(null);
            }}
          >
            + YENİ BÖLGE EKLE
          </Button>
        )}
      </section>

      {error && (
        <div className="mb-6">
          <Notice kind="error" message={error} />
        </div>
      )}

      {zones.length > 0 && (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <TextInput
            type="search"
            value={search}
            onChange={(event) => {
              const next = event.target.value;
              setSearch(next);
              const folded = foldForSearch(next);
              // Kutu boşaltıldığında gruplar kullanıcının bıraktığı gibi
              // kalsın: aramadan çıkmak "her şeyi aç" demek değil.
              if (folded === "") return;
              setOpenCities(
                new Set(
                  grouped
                    .filter((group) => group.zones.some((zone) => matchesZoneSearch(zone, folded)))
                    .map((group) => group.city)
                )
              );
            }}
            placeholder="Posta kodu ya da şehir adı yazın…"
            aria-label="Teslimat bölgesi ara"
            className="sm:max-w-[320px]"
          />
          <span className="text-sm text-smoke">
            {needle === ""
              ? `Toplam ${zones.length} posta kodu, ${activeCount} tanesine teslimat var`
              : `${zones.length} posta kodundan ${visibleCount} tanesi eşleşti`}
          </span>
        </div>
      )}

      <div className="space-y-3">
        {visible.map((group, index) => {
          const open = openCities.has(group.city);
          // Aramada süzülmüş grup gelir: sayılar da altta gerçekten duran
          // satırları anlatır, yoksa başlık listeyle çelişirdi.
          const openZones = group.zones.filter((zone) => zone.active).length;
          // Açık şehirlerle kapalılar arasındaki sınır bir ara başlıkla
          // işaretlenir; yalnızca iki taraf da doluysa anlamlı.
          const firstClosed =
            openZones === 0 &&
            index > 0 &&
            visible[index - 1].zones.some((zone) => zone.active);

          return (
            <div key={group.city}>
            {firstClosed && (
              <p className="tag mb-3 mt-6 text-smoke/70">Teslimat yapılmayan şehirler</p>
            )}
            <section className="border border-line bg-char">
              {/*
                Grup başlığı bir düğme: kapalıyken şehrin adı ve o şehre
                teslimat olup olmadığı görünür, gerisi istenince gelir.
              */}
              <h2>
                <button
                  type="button"
                  onClick={() => toggleCity(group.city)}
                  aria-expanded={open}
                  className="focus-ring flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-void/40 md:px-5"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span aria-hidden className="text-smoke">
                      {open ? "−" : "+"}
                    </span>
                    <span className="font-display font-bold text-bone">{group.city}</span>
                  </span>
                  {/* Teslimatı hiç olmayan şehir kırmızı yazılır: listeyi
                      tarayan göz önce "hangi şehir kapalı" diye bakar. */}
                  <span
                    className={`shrink-0 text-right text-sm ${
                      openZones === 0 ? "text-flame" : "text-smoke"
                    }`}
                  >
                    {citySummary(group.zones.length, openZones)}
                  </span>
                </button>
              </h2>

              {open && (
                <ul className="divide-y divide-line border-t border-line">
                  {group.zones.map((zone) => (
                    <li key={zone.id} className="p-4 md:p-5">
                      {editingId === zone.id ? (
                        <>
                          {fields(editing, setEditing, "Bölge")}
                          <div className="flex flex-wrap gap-2 mt-5">
                            <Button onClick={() => saveEdit(zone.id)} disabled={busy}>
                              KAYDET
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => setEditingId(null)}
                              disabled={busy}
                            >
                              VAZGEÇ
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="font-display font-bold text-bone">
                              <span className="tabular-nums">{zone.postalCode}</span>
                              {zone.city && (
                                <span className="text-smoke font-normal"> · {zone.city}</span>
                              )}
                            </p>
                            {/* Kısaltılmış hâli ("min 15,00 · ücret 2,00")
                                her okunuşta çözülüyordu; koşullar müşteriye
                                de bu cümlelerle gösteriliyor. */}
                            <p className="mt-1.5 text-sm leading-relaxed text-smoke">
                              En az {formatCents(zone.minOrderCents)} tutarında sepet ·{" "}
                              {zone.feeCents === 0
                                ? "teslimat ücretsiz"
                                : `${formatCents(zone.feeCents)} teslimat ücreti`}
                              {zone.freeOverCents > 0 &&
                                ` (${formatCents(zone.freeOverCents)} üzeri ücretsiz)`}{" "}
                              · yaklaşık {zone.etaMinutes} dakikada teslim
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <Badge tone={zone.active ? "on" : "off"}>
                              {zone.active ? "TESLİMAT VAR" : "TESLİMAT YOK"}
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
              )}
            </section>
            </div>
          );
        })}

        {zones.length > 0 && visibleCount === 0 && (
          <div className="border border-line bg-char px-5 py-10 text-center">
            <p className="text-sm text-smoke">
              &quot;{search.trim()}&quot; ile eşleşen teslimat bölgesi yok.
            </p>
            <p className="mt-3">
              <button
                type="button"
                onClick={() => setSearch("")}
                className="focus-ring tag text-smoke underline underline-offset-4 hover:text-amber"
              >
                ARAMAYI TEMİZLE
              </button>
            </p>
          </div>
        )}

        {zones.length === 0 && (
          <p className="border border-line bg-char px-5 py-10 text-center text-sm text-smoke">
            Henüz teslimat bölgesi yok — bu haliyle hiçbir adrese teslimat yapılamaz.
          </p>
        )}
      </div>

      {/* Ekranın kendini anlatan cümleleri: "açık/kapalı" gibi panele özgü
          kelimeler yerine ekranda ne yazıyorsa o kullanılır. */}
      <p className="mt-5 text-sm leading-relaxed text-smoke/80">
        Arama kutusu hem posta kodunda hem şehir adında arar; eşleşen şehirler
        kendiliğinden açılır. Şehrin adına tıklayınca o şehrin posta kodları görünür.
        Bir koda teslimat yapılıp yapılmayacağı{" "}
        <strong className="text-bone">DÜZENLE</strong> içinde, diğer alanlarla birlikte
        değişir ve birlikte kaydedilir. Bölgeyi silmek yerine teslimatı kapatmak, o posta
        kodunu geçici olarak (ör. yoğun bir akşamda) siparişe kapatmanın güvenli yoludur:
        tutarlar ve süre olduğu gibi kalır, sonra tek tıkla geri açılır.
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
