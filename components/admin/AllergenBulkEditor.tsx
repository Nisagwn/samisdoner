"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ALLERGENS,
  ALLERGEN_LABELS,
  hasLegalInfo,
  type Allergen,
  type Category,
  type Product,
} from "@/lib/admin/types";
import { Badge, Button, Notice, Select } from "./ui";

/**
 * Toplu alerjen girişi.
 *
 * Ürün formu tek bir ürün için doğru araç ama menüde yüzden fazla satır var;
 * her biri için formu açıp kapatmak bu işin hiç bitmemesi demek. Burada
 * kategori seçilir ve o kategorinin tamamı tek tabloda, satır satır
 * işaretlenir — aynı kategorideki ürünler zaten büyük ölçüde aynı alerjenleri
 * taşıdığı için iş asıl burada hızlanıyor.
 *
 * İki kolaylık bilinçli olarak var:
 *  - **Satır kopyalama** ("↧ aşağıya uygula"): bir satırın işaretlerini
 *    kategorideki geri kalan satırlara basar. Pide'lerin on çeşidi aynı
 *    alerjenleri taşır; onu on kez işaretlemek hataya davetiye.
 *  - **Toplu beyan**: alerjen taşımayan ürünlerde (çoğu içecek) tek tek
 *    beyan açmak yerine seçili satırların beyanı birlikte açılır.
 *
 * Kaydetme ürün başına `PATCH` ile yapılır — mevcut uç, mevcut doğrulama.
 * Ayrı bir toplu uç açmak, alerjen doğrulamasının ikinci bir kopyasını
 * yazmak olurdu.
 */

type Row = {
  id: string;
  name: string;
  allergens: Allergen[];
  allergenInfoConfirmed: boolean;
  /** Kaydedilmemiş değişiklik var mı. */
  dirty: boolean;
};

const OPTIONS = ALLERGENS.map((code) => ({ code, short: ALLERGEN_LABELS[code].tr }));

/** Sütun başlıklarında yalnızca kısa kod durur; tam ad `title` ile gelir. */
const SHORT_CODES: Record<Allergen, string> = {
  GLUTEN: "Glu",
  CRUSTACEANS: "Krb",
  EGGS: "Yum",
  FISH: "Blk",
  PEANUTS: "Fıs",
  SOYBEANS: "Soy",
  MILK: "Süt",
  NUTS: "Yem",
  CELERY: "Krv",
  MUSTARD: "Hrd",
  SESAME: "Sus",
  SULPHITES: "Sül",
  LUPIN: "Bkl",
  MOLLUSCS: "Yum.",
};

function toRow(product: Product): Row {
  return {
    id: product.id,
    name: product.name,
    allergens: product.allergens,
    allergenInfoConfirmed: product.allergenInfoConfirmed,
    dirty: false,
  };
}

export default function AllergenBulkEditor({
  products,
  categories,
}: {
  products: Product[];
  categories: Category[];
}) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [rows, setRows] = useState<Row[]>(() => products.map(toRow));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const byCategory = useMemo(() => {
    const ids = new Set(
      products.filter((p) => p.categoryId === categoryId).map((p) => p.id)
    );
    return rows.filter((row) => ids.has(row.id));
  }, [rows, products, categoryId]);

  const dirtyRows = rows.filter((row) => row.dirty);
  const missing = rows.filter((row) => !hasLegalInfo(row)).length;

  const patch = (id: string, change: Partial<Row>) =>
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...change, dirty: true } : row))
    );

  const toggle = (row: Row, code: Allergen) => {
    const next = row.allergens.includes(code)
      ? row.allergens.filter((a) => a !== code)
      : ALLERGENS.filter((a) => a === code || row.allergens.includes(a));
    patch(row.id, { allergens: next });
  };

  /** Bir satırın işaretlerini kategorideki diğer tüm satırlara basar. */
  const applyToRest = (source: Row) => {
    const targets = new Set(byCategory.map((r) => r.id));
    targets.delete(source.id);
    setRows((prev) =>
      prev.map((row) =>
        targets.has(row.id)
          ? {
              ...row,
              allergens: source.allergens,
              allergenInfoConfirmed: source.allergenInfoConfirmed,
              dirty: true,
            }
          : row
      )
    );
  };

  /** Kategorideki alerjensiz satırların "madde yok" beyanını birlikte açar. */
  const confirmEmpty = () => {
    const targets = new Set(
      byCategory.filter((r) => r.allergens.length === 0 && !r.allergenInfoConfirmed).map((r) => r.id)
    );
    if (targets.size === 0) return;
    setRows((prev) =>
      prev.map((row) =>
        targets.has(row.id) ? { ...row, allergenInfoConfirmed: true, dirty: true } : row
      )
    );
  };

  /*
   * Kaydetme.
   *
   * Sırayla, tek tek: yüz satırlık bir kategoride hepsini aynı anda göndermek
   * bağlantı havuzunu tüketip yarısının sessizce düşmesine yol açardı. İlk
   * hatada durulur ve o ana kadar kaydedilenler `dirty` işaretini kaybeder —
   * işletmeci neyin gittiğini, neyin kaldığını ekranda görür.
   */
  async function saveAll() {
    if (dirtyRows.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setSaved(null);

    let done = 0;
    for (const row of dirtyRows) {
      try {
        const response = await fetch(`/api/admin/products/${encodeURIComponent(row.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            allergens: row.allergens,
            allergenInfoConfirmed: row.allergenInfoConfirmed,
          }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          setError(
            `${row.name}: ${data?.error ?? "kaydedilemedi"}. ${done} ürün kaydedildi, kalanlar duruyor.`
          );
          break;
        }
        setRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, dirty: false } : r))
        );
        done += 1;
      } catch {
        setError(`${row.name}: sunucuya ulaşılamadı. ${done} ürün kaydedildi, kalanlar duruyor.`);
        break;
      }
    }

    setSaved(done);
    setBusy(false);
    // Menü ve "eksik bilgi" sayacı sunucudan yeniden okunsun.
    if (done > 0) router.refresh();
  }

  if (categories.length === 0) {
    return <Notice kind="error" message="Önce en az bir kategori tanımlayın." />;
  }

  return (
    <div className="min-w-0 max-w-[1200px]">
      <header className="mb-8">
        <p className="tag mb-2 text-flame">Yasal bilgi</p>
        <h1 className="font-display text-3xl font-extrabold text-bone md:text-4xl">
          Toplu alerjen girişi
        </h1>
        <p className="mt-3 max-w-[75ch] text-sm leading-relaxed text-smoke">
          Kategori seçin ve satır satır işaretleyin. Alerjen taşımayan üründe
          hiçbir kutuyu işaretlemeyin ama <strong className="text-bone">beyan</strong>{" "}
          sütununu açın: boş liste tek başına &quot;madde yok&quot; anlamına gelmez,
          menüde &quot;lütfen sorunuz&quot; olarak çıkar.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <label className="block min-w-0">
          <span className="tag mb-2 block text-smoke">Kategori</span>
          <Select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="sm:min-w-[260px]"
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </label>

        <button
          type="button"
          onClick={confirmEmpty}
          className="focus-ring tag border border-line px-3 py-2.5 text-smoke transition-colors hover:border-amber hover:text-amber"
        >
          BOŞ SATIRLARA &quot;MADDE YOK&quot; BEYANI
        </button>

        <div className="ml-auto flex items-center gap-3">
          {missing > 0 ? (
            <Badge tone="off">{missing} ÜRÜNDE BİLGİ EKSİK</Badge>
          ) : (
            <Badge tone="on">TÜM ÜRÜNLERDE BİLGİ VAR</Badge>
          )}
          <Button type="button" onClick={saveAll} disabled={busy || dirtyRows.length === 0}>
            {busy
              ? "KAYDEDİLİYOR…"
              : dirtyRows.length === 0
                ? "DEĞİŞİKLİK YOK"
                : `${dirtyRows.length} ÜRÜNÜ KAYDET`}
          </Button>
        </div>
      </div>

      {error && <div className="mb-4"><Notice kind="error" message={error} /></div>}
      {saved !== null && !error && saved > 0 && (
        <div className="mb-4">
          <Notice kind="success" message={`${saved} ürün kaydedildi.`} />
        </div>
      )}

      {/* Tablo dar ekranda kendi içinde kayar; sayfa gövdesi yatay kaymaz. */}
      <div className="overflow-x-auto border border-line">
        <table className="w-full min-w-[900px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-line bg-panel">
              <th className="sticky left-0 z-10 bg-panel px-3 py-2.5 text-left font-normal text-smoke">
                Ürün
              </th>
              {OPTIONS.map((option) => (
                <th
                  key={option.code}
                  title={option.short}
                  className="px-1.5 py-2.5 text-center font-normal text-smoke"
                >
                  {SHORT_CODES[option.code]}
                </th>
              ))}
              <th className="px-3 py-2.5 text-center font-normal text-smoke" title="Bildirimi zorunlu madde yok beyanı">
                Beyan
              </th>
              <th className="px-3 py-2.5 text-right font-normal text-smoke">Kopyala</th>
            </tr>
          </thead>
          <tbody>
            {byCategory.map((row) => {
              const incomplete = !hasLegalInfo(row);
              return (
                <tr
                  key={row.id}
                  className={`border-b border-line/60 last:border-b-0 ${
                    row.dirty ? "bg-amber/5" : ""
                  }`}
                >
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 max-w-[240px] truncate px-3 py-2 text-left font-normal ${
                      row.dirty ? "bg-[#1a1710]" : "bg-char"
                    } ${incomplete ? "text-flame" : "text-bone"}`}
                    title={row.name}
                  >
                    {row.name}
                  </th>

                  {OPTIONS.map((option) => (
                    <td key={option.code} className="px-1.5 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={row.allergens.includes(option.code)}
                        onChange={() => toggle(row, option.code)}
                        aria-label={`${row.name} — ${option.short}`}
                        className="focus-ring h-4 w-4 accent-[#FFC247]"
                      />
                    </td>
                  ))}

                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={row.allergenInfoConfirmed}
                      onChange={(e) =>
                        patch(row.id, { allergenInfoConfirmed: e.target.checked })
                      }
                      aria-label={`${row.name} — bildirimi zorunlu madde yok beyanı`}
                      className="focus-ring h-4 w-4 accent-[#7BD66F]"
                    />
                  </td>

                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => applyToRest(row)}
                      title="Bu satırın işaretlerini kategorideki diğer ürünlere uygula"
                      className="focus-ring tag border border-line px-2 py-1 text-smoke transition-colors hover:border-amber hover:text-amber"
                    >
                      ↧ HEPSİNE
                    </button>
                  </td>
                </tr>
              );
            })}

            {byCategory.length === 0 && (
              <tr>
                <td colSpan={OPTIONS.length + 3} className="px-3 py-8 text-center text-smoke">
                  Bu kategoride ürün yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 max-w-[75ch] text-xs leading-relaxed text-smoke/70">
        Sütun başlıkları kısaltmadır; üzerine gelince tam adı görünür. Katkı
        maddesi (ZZulV) ve KDV oranı ürün başına ayarlanır — ürün düzenleme
        formundan.
      </p>
    </div>
  );
}
