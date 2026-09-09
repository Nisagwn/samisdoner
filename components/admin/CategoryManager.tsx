"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Category } from "@/lib/admin/types";
import { Button, ConfirmDialog, Field, Notice, TextInput } from "./ui";

type Row = Category & { productCount: number; activeCount: number };

/** Düzenleme formunun taslağı — dört metin alanı da birlikte kaydedilir. */
type Draft = { name: string; nameTr: string; note: string; noteTr: string };

/**
 * Kategori yönetimi.
 *
 * Düzenleme önceden yalnızca **ad** değiştiriyordu. `nameTr`, `note` ve
 * `noteTr` şemada vardı ve menü onları okuyordu, ama girilemedikleri için
 * Türkçe menüde kategori başlıkları Almanca kalıyor, "ekstra malzeme /
 * depozito" gibi kategori notları hiç görünmüyordu.
 *
 * Sıralama sürükle-bırak değil ok düğmeleriyle: panel tabletten de
 * kullanılıyor ve sürükleme orada hem kaydırmayla çakışıyor hem de yanlışlıkla
 * tetikleniyor. Ok düğmesi tek dokunuş, geri alması da tek dokunuş.
 */

export default function CategoryManager({ categories }: { categories: Row[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", nameTr: "", note: "", noteTr: "" });
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);

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

  async function addCategory(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (await send("/api/admin/categories", "POST", { name })) setNewName("");
  }

  async function saveEdit(id: string) {
    const name = draft.name.trim();
    if (!name) return;
    const ok = await send(`/api/admin/categories/${encodeURIComponent(id)}`, "PATCH", {
      name,
      nameTr: draft.nameTr.trim(),
      note: draft.note.trim(),
      noteTr: draft.noteTr.trim(),
    });
    if (ok) setEditingId(null);
  }

  /**
   * Komşu iki kategorinin sırasını takas eder.
   *
   * İki ayrı PATCH: tek bir "yeni sıra listesi" ucu açmak, aynı doğrulamanın
   * ikinci bir kopyasını ve bir toplu yazma yolunu gerektirirdi. İki satırlık
   * takasta bunun karşılığı yok. İlki başarısız olursa ikincisi hiç
   * gönderilmez — sıra bozulmadan kalır.
   */
  async function swap(index: number, direction: -1 | 1) {
    const current = categories[index];
    const other = categories[index + direction];
    if (!current || !other) return;

    const ok = await send(`/api/admin/categories/${encodeURIComponent(current.id)}`, "PATCH", {
      sortOrder: other.sortOrder,
    });
    if (!ok) return;
    await send(`/api/admin/categories/${encodeURIComponent(other.id)}`, "PATCH", {
      sortOrder: current.sortOrder,
    });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    if (await send(`/api/admin/categories/${encodeURIComponent(pendingDelete.id)}`, "DELETE")) {
      setPendingDelete(null);
    }
  }

  return (
    <div className="max-w-[880px]">
      <header className="mb-8">
        <p className="tag text-flame mb-2">Katalog</p>
        <h1 className="font-display font-extrabold text-3xl md:text-4xl text-bone">Kategoriler</h1>
      </header>

      <form onSubmit={addCategory} className="flex flex-col sm:flex-row gap-3 mb-7">
        <TextInput
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Yeni kategori adı (ör. Tatlılar)"
          aria-label="Yeni kategori adı"
          maxLength={80}
          className="flex-1"
        />
        <Button type="submit" disabled={busy || newName.trim() === ""}>
          + KATEGORİ EKLE
        </Button>
      </form>

      {error && (
        <div className="mb-6">
          <Notice kind="error" message={error} />
        </div>
      )}

      <ul className="border border-line divide-y divide-line">
        {categories.map((category, index) => (
          <li
            key={category.id}
            className={`flex gap-4 bg-char p-4 md:p-5 ${
              editingId === category.id
                ? "flex-col"
                : "flex-col sm:flex-row sm:items-center"
            }`}
          >
            <div className="min-w-0 flex-1">
              {editingId === category.id ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Kategori adı (menüde başlık)">
                    <TextInput
                      autoFocus
                      value={draft.name}
                      maxLength={80}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  </Field>
                  <Field label="Türkçe ad" hint="Boş bırakılırsa Almanca ad kullanılır.">
                    <TextInput
                      value={draft.nameTr}
                      maxLength={80}
                      onChange={(e) => setDraft({ ...draft, nameTr: e.target.value })}
                    />
                  </Field>
                  <Field
                    label="Kategori notu"
                    hint="Kategorinin tamamı için geçerli açıklama (ekstra malzeme, depozito …)."
                  >
                    <TextInput
                      value={draft.note}
                      maxLength={200}
                      onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                    />
                  </Field>
                  <Field label="Türkçe not">
                    <TextInput
                      value={draft.noteTr}
                      maxLength={200}
                      onChange={(e) => setDraft({ ...draft, noteTr: e.target.value })}
                    />
                  </Field>
                </div>
              ) : (
                <>
                  <p className="truncate font-display font-bold text-bone">
                    {category.name}
                    {category.nameTr && category.nameTr !== category.name && (
                      <span className="ml-2 font-body text-sm font-normal text-smoke">
                        / {category.nameTr}
                      </span>
                    )}
                  </p>
                  {category.note && (
                    <p className="mt-1 truncate text-xs text-smoke/80">{category.note}</p>
                  )}
                  <p className="tag mt-1 tabular-nums text-smoke">
                    {category.activeCount} aktif / {category.productCount} ürün
                  </p>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-2 shrink-0">
              {editingId === category.id ? (
                <>
                  <button
                    onClick={() => saveEdit(category.id)}
                    disabled={busy}
                    className="focus-ring tag border border-amber bg-amber text-void px-3 py-2 font-semibold hover:bg-bone hover:border-bone transition-colors disabled:opacity-40"
                  >
                    KAYDET
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="focus-ring tag border border-line px-3 py-2 text-smoke hover:border-amber hover:text-amber transition-colors"
                  >
                    VAZGEÇ
                  </button>
                </>
              ) : (
                <>
                  {/* Sıralama: menüdeki görünüm sırası buradan belirlenir.
                      Uçtaki satırın ilgili oku pasiftir — gidecek yer yok. */}
                  <button
                    onClick={() => swap(index, -1)}
                    disabled={busy || index === 0}
                    aria-label={`${category.name} — yukarı taşı`}
                    className="focus-ring tag border border-line px-3 py-2 text-smoke transition-colors hover:border-amber hover:text-amber disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => swap(index, 1)}
                    disabled={busy || index === categories.length - 1}
                    aria-label={`${category.name} — aşağı taşı`}
                    className="focus-ring tag border border-line px-3 py-2 text-smoke transition-colors hover:border-amber hover:text-amber disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(category.id);
                      setDraft({
                        name: category.name,
                        nameTr: category.nameTr,
                        note: category.note,
                        noteTr: category.noteTr,
                      });
                      setError(null);
                    }}
                    className="focus-ring tag border border-line px-3 py-2 text-bone transition-colors hover:border-amber hover:text-amber"
                  >
                    DÜZENLE
                  </button>
                  <button
                    onClick={() => setPendingDelete(category)}
                    className="focus-ring tag border border-flame/50 px-3 py-2 text-flame hover:bg-flame hover:text-void transition-colors"
                  >
                    SİL
                  </button>
                </>
              )}
            </div>
          </li>
        ))}

        {categories.length === 0 && (
          <li className="bg-char px-5 py-10 text-center text-sm text-smoke">
            Henüz kategori yok. Yukarıdan ilk kategoriyi ekleyebilirsin.
          </li>
        )}
      </ul>

      <p className="text-xs text-smoke/70 mt-5 leading-relaxed">
        İçinde ürün bulunan kategoriler silinemez — önce ürünleri başka bir
        kategoriye taşı veya sil. Ok düğmeleri menüdeki görünüm sırasını
        değiştirir. Türkçe ad boş bırakılırsa menü Almanca adı kullanır;
        kategori notu o kategorinin tüm ürünlerinin altında görünür.
      </p>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Kategoriyi sil"
        message={`"${pendingDelete?.name ?? ""}" kategorisini silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`}
        confirmLabel="EVET, SİL"
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
