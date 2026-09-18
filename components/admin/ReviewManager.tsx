"use client";

import { useMemo, useState } from "react";
import type { AdminReview } from "@/lib/reviews/repository";
import { Badge, Button, Field, Notice, TextArea, TextInput } from "./ui";

/**
 * Değerlendirme ekranı.
 *
 * İki iş yapılır ve ikisinin ağırlığı farklı:
 *
 *  - **Cevap yazmak** olağan iştir ve teşvik edilmeli. Kötü bir yoruma verilen
 *    iyi bir cevap, o yorumu okuyan için yorumun kendisinden daha
 *    bilgilendiricidir; bu yüzden cevabı olmayan yorumlar listenin başına
 *    alınabiliyor ve cevap kutusu tek tıkla açılıyor.
 *  - **Gizlemek** istisnadır. Sebep zorunlu, düğme kırmızı değil gri, ve
 *    ekranda "silinmez, gizlenir" yazıyor. Kötü puanı yok etmenin bir yolu
 *    olmadığı baştan belli olmalı.
 *
 * Yıldızlar metin olarak (★★★★☆) yazılır: panel mutfaktaki bir tablette
 * açılıyor ve ikon fontuna bağlı bir gösterim, o tablette boş kare olarak
 * görünme riskini taşır.
 */

const DATE = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Berlin",
  dateStyle: "short",
  timeStyle: "short",
});

function stars(value: number): string {
  return "★".repeat(value) + "☆".repeat(5 - value);
}

type Filter = "all" | "unanswered" | "low" | "hidden";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "unanswered", label: "Cevapsız" },
  { key: "low", label: "Düşük puan" },
  { key: "hidden", label: "Gizlenmiş" },
  { key: "all", label: "Hepsi" },
];

export default function ReviewManager({ initial }: { initial: AdminReview[] }) {
  const [reviews, setReviews] = useState(initial);
  const [filter, setFilter] = useState<Filter>("unanswered");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** Açık cevap kutusu ve içindeki taslak. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** Gizleme sebebi kutusu. */
  const [hiding, setHiding] = useState<{ id: string; reason: string } | null>(null);

  const summary = useMemo(() => {
    const published = reviews.filter((review) => review.published);
    const total = published.reduce((sum, review) => sum + review.foodRating, 0);
    return {
      count: published.length,
      // Yayındaki yorumların ortalaması — sitede görünen sayının aynısı.
      average: published.length ? Math.round((total / published.length) * 10) / 10 : null,
      unanswered: reviews.filter((review) => review.published && !review.reply).length,
    };
  }, [reviews]);

  const visible = useMemo(() => {
    switch (filter) {
      case "unanswered":
        return reviews.filter((review) => review.published && !review.reply);
      case "low":
        return reviews.filter((review) => review.foodRating <= 3);
      case "hidden":
        return reviews.filter((review) => !review.published);
      default:
        return reviews;
    }
  }, [reviews, filter]);

  async function patch(id: string, body: Record<string, unknown>, note: string) {
    setBusy(id);
    setError(null);
    setDone(null);
    try {
      const response = await fetch(`/api/admin/reviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string; review?: AdminReview }
        | null;

      if (!response.ok || !data?.review) {
        setError(data?.error ?? "İşlem tamamlanamadı.");
        return;
      }
      const updated = data.review;
      setReviews((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      setDone(note);
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-[900px] space-y-8">
      <header>
        <p className="tag text-flame">Müşteri gözünden</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold text-bone">
          Değerlendirmeler
        </h1>
        <p className="mt-3 text-sm text-smoke">
          Yalnızca teslim edilmiş bir siparişin sahibi yazabilir. Yorum{" "}
          <strong className="text-bone">silinmez, gizlenir</strong> — gizlenen yorum
          sitede görünmez ve ortalamaya girmez, ama kaydı sebebiyle birlikte durur.
        </p>
      </header>

      <section className="grid grid-cols-3 gap-px border border-line bg-line">
        {[
          {
            value: summary.average === null ? "—" : summary.average.toFixed(1),
            label: "Ortalama",
            tone: "text-amber",
          },
          { value: String(summary.count), label: "Yayındaki yorum", tone: "text-bone" },
          {
            value: String(summary.unanswered),
            label: "Cevapsız",
            tone: summary.unanswered > 0 ? "text-flame" : "text-smoke",
          },
        ].map((tile) => (
          <div key={tile.label} className="bg-char p-5">
            <p className={`font-display text-3xl font-extrabold tabular-nums ${tile.tone}`}>
              {tile.value}
            </p>
            <p className="tag mt-2 text-smoke">{tile.label}</p>
          </div>
        ))}
      </section>

      {error && <Notice kind="error" message={error} />}
      {done && <Notice kind="success" message={done} />}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilter(item.key)}
            aria-pressed={filter === item.key}
            className={`focus-ring tag min-h-[44px] border px-4 py-2 transition-colors ${
              filter === item.key
                ? "border-amber bg-amber/15 text-amber"
                : "border-line text-smoke hover:border-amber hover:text-amber"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="border border-line bg-char px-5 py-8 text-center text-sm text-smoke">
          {filter === "unanswered"
            ? "Cevapsız yorum yok — hepsine cevap verilmiş."
            : "Bu filtrede yorum yok."}
        </p>
      ) : (
        <ul className="space-y-4">
          {visible.map((review) => {
            const draft = drafts[review.id];
            const editing = draft !== undefined;

            return (
              <li
                key={review.id}
                className={`border bg-char p-5 ${
                  review.published ? "border-line" : "border-line/50 opacity-70"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-xl font-extrabold tracking-wider text-amber">
                      {stars(review.foodRating)}
                      <span className="ml-2 align-middle text-xs font-semibold text-smoke">
                        Yemek
                      </span>
                    </p>
                    {review.deliveryRating !== null && (
                      <p className="mt-1 font-display text-base font-bold tracking-wider text-smoke">
                        {stars(review.deliveryRating)}
                        <span className="ml-2 align-middle text-xs font-semibold text-smoke/70">
                          Teslimat
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {!review.published && <Badge tone="off">GİZLİ</Badge>}
                    <span className="tag text-smoke/70">{review.orderNo}</span>
                    <span className="text-xs text-smoke/70">
                      {DATE.format(new Date(review.createdAt))}
                    </span>
                  </div>
                </div>

                <p className="mt-1 text-xs text-smoke">
                  {review.authorName} · {review.lang === "tr" ? "Türkçe" : "Almanca"}
                </p>

                {/* Puanlanan sipariş.
                    "Üç yıldız" tek başına cevaplanabilir bir bilgi değil;
                    "neye üç yıldız" cevaplanabilir. Sipariş numarasından yola
                    çıkıp ayrı bir ekranda siparişi bulmak, gün içinde onlarca
                    yorumu gözden geçiren biri için yapılmayacak kadar uzun. */}
                {review.items.length > 0 && (
                  <div className="mt-3">
                    <p className="tag mb-1.5 text-smoke/70">Puanlanan sipariş</p>
                    <ul className="flex flex-wrap gap-1.5">
                      {review.items.map((item, index) => (
                        <li
                          key={`${item.productId ?? item.label}-${index}`}
                          className="border border-line bg-void px-2.5 py-1 text-xs text-bone"
                        >
                          <span className="font-mono tabular-nums text-smoke">{item.qty}×</span>{" "}
                          {item.label}
                        </li>
                      ))}
                    </ul>
                    {/* Puan siparişin tamamına verilir; bir satırın puanı
                        değildir. Panelde bunu yazmamak, "hangi ürün kötü"
                        diye yanlış bir sonuca götürür. */}
                    <p className="mt-1.5 text-[11px] text-smoke/60">
                      Puan siparişin tamamına verildi, tek tek ürünlere değil.
                    </p>
                  </div>
                )}

                {review.comment ? (
                  <p className="mt-3 border-l-2 border-line pl-4 text-sm leading-relaxed text-bone">
                    {review.comment}
                  </p>
                ) : (
                  <p className="mt-3 text-sm italic text-smoke/60">
                    Yorum yazılmamış — yalnızca puan verilmiş.
                  </p>
                )}

                {!review.published && review.hiddenReason && (
                  <p className="mt-3 border border-line bg-void px-3 py-2 text-xs text-smoke">
                    Gizlenme sebebi: {review.hiddenReason}
                  </p>
                )}

                {/* --- cevap --- */}
                {review.reply && !editing && (
                  <div className="mt-4 border border-herb/40 bg-herb/5 p-4">
                    <p className="tag mb-1.5 text-herb">Cevabınız</p>
                    <p className="text-sm leading-relaxed text-bone">{review.reply}</p>
                    {review.repliedAt && (
                      <p className="mt-2 text-xs text-smoke/70">
                        {DATE.format(new Date(review.repliedAt))}
                      </p>
                    )}
                  </div>
                )}

                {editing && (
                  <div className="mt-4 space-y-3">
                    <Field
                      label="Cevap"
                      hint="Sitede yorumun altında, işletme adına görünür. Müşterinin dilinde yazın."
                    >
                      <TextArea
                        value={draft}
                        maxLength={800}
                        onChange={(e) =>
                          setDrafts({ ...drafts, [review.id]: e.target.value })
                        }
                        placeholder={
                          review.lang === "tr"
                            ? "Teşekkür ederiz…"
                            : "Vielen Dank für Ihre Rückmeldung…"
                        }
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={busy === review.id}
                        onClick={() =>
                          void patch(
                            review.id,
                            { action: "reply", reply: draft },
                            draft.trim() ? "Cevap yayımlandı." : "Cevap kaldırıldı."
                          ).then(() => {
                            const next = { ...drafts };
                            delete next[review.id];
                            setDrafts(next);
                          })
                        }
                      >
                        {busy === review.id ? "KAYDEDİLİYOR…" : "CEVABI YAYIMLA"}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          const next = { ...drafts };
                          delete next[review.id];
                          setDrafts(next);
                        }}
                      >
                        VAZGEÇ
                      </Button>
                    </div>
                  </div>
                )}

                {/* --- eylemler --- */}
                {!editing && (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line/60 pt-4">
                    <Button
                      variant="ghost"
                      onClick={() => setDrafts({ ...drafts, [review.id]: review.reply })}
                    >
                      {review.reply ? "CEVABI DÜZENLE" : "CEVAP YAZ"}
                    </Button>

                    {review.published ? (
                      hiding?.id === review.id ? (
                        <div className="flex w-full flex-wrap items-end gap-2">
                          <label className="block min-w-[200px] flex-1">
                            <span className="tag mb-1.5 block text-smoke">
                              Gizleme sebebi (kayda yazılır)
                            </span>
                            <TextInput
                              value={hiding.reason}
                              onChange={(e) =>
                                setHiding({ id: review.id, reason: e.target.value })
                              }
                              placeholder="Hakaret içeriyor / başka bir işletmeye ait"
                            />
                          </label>
                          <Button
                            variant="danger"
                            disabled={busy === review.id || hiding.reason.trim().length < 3}
                            onClick={() =>
                              void patch(
                                review.id,
                                {
                                  action: "visibility",
                                  published: false,
                                  hiddenReason: hiding.reason,
                                },
                                "Yorum gizlendi."
                              ).then(() => setHiding(null))
                            }
                          >
                            GİZLE
                          </Button>
                          <Button variant="ghost" onClick={() => setHiding(null)}>
                            VAZGEÇ
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          className="ml-auto"
                          onClick={() => setHiding({ id: review.id, reason: "" })}
                        >
                          SİTEDEN GİZLE
                        </Button>
                      )
                    ) : (
                      <Button
                        variant="ghost"
                        className="ml-auto"
                        disabled={busy === review.id}
                        onClick={() =>
                          void patch(
                            review.id,
                            { action: "visibility", published: true, hiddenReason: "" },
                            "Yorum yeniden yayında."
                          )
                        }
                      >
                        YENİDEN YAYIMLA
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
