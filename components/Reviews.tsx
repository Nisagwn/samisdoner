import { getTranslations } from "@/lib/i18n/server";
import { getPublicReviews } from "@/lib/reviews/repository";

/*
 * Sunucu bileşeni.
 *
 * Bu bölüm yalnızca çeviri okumak için `"use client"` yazılmıştı: hiçbir
 * durumu, olayı ya da tarayıcı API'si yok — düz biçimlendirme. Bedeli, iki
 * dilin tamamının bu bölümü içeren her sayfaya paket olarak gitmesiydi.
 * Metin artık sunucuda çözülüyor (`lib/i18n/server.ts`).
 */

/**
 * Değerlendirmeler artık **gerçek**.
 *
 * Buradaki dört yorum ve "4.9 / 106" sayısı Google'dan elle kopyalanmış sabit
 * metinlerdi. İki sorunu vardı:
 *
 *  1. **Eskiyordu.** Google'daki sayı değiştiğinde site aynı kalıyordu ve
 *     kimse fark etmiyordu.
 *  2. **Kanıtlanamıyordu.** UWG § 5b Abs. 3, tüketici değerlendirmesi
 *     yayımlayan işletmeden bu yorumların gerçekten üründen yararlanmış
 *     kişilerden geldiğini temin etmesini ve bunu **nasıl** temin ettiğini
 *     açıklamasını ister. Kopyalanmış bir metin için verilebilecek bir cevap
 *     yok; kendi siparişimize bağlı bir yorum için var ve bölümün altında
 *     yazılı duruyor.
 *
 * Henüz hiç değerlendirme yoksa bölüm Google sayılarına geri düşer: yeni
 * açılmış bir dükkân gibi boş bir puan kutusu göstermek, var olan itibarı
 * saklamak olurdu. Geri düşüldüğünde kaynağın Google olduğu da söylenir —
 * kendi yorumlarımızmış gibi sunulmaz.
 */
export default async function Reviews() {
  const { t } = getTranslations();
  const summary = await getPublicReviews(4);

  const hasOwn = summary.average !== null && summary.count > 0;

  const rating = hasOwn ? summary.average!.toFixed(1).replace(".", ",") : t.reviews.rating;
  const count = hasOwn ? `(${summary.count} ${t.reviews.countWord})` : t.reviews.count;

  return (
    <section id="bewertungen" className="relative overflow-hidden bg-char py-24 md:py-32 border-t border-line">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-14 border-b border-line pb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="font-display font-black text-4xl text-amber">{rating}</span>
              <Stars value={hasOwn ? Math.round(summary.average!) : 5} />
              <span className="tag text-smoke">{count}</span>
            </div>
            <h2 className="section-title font-display font-extrabold text-bone">
              {t.reviews.subTitle}
            </h2>
          </div>

          {/* Teslimat puanı ayrı ölçülüyor ve ayrı gösteriliyor: "yemek iyi ama
              geç geldi" tek bir sayıya sıkıştırıldığında ikisi de kaybolur. */}
          {hasOwn && summary.deliveryAverage !== null && (
            <p className="tag text-smoke">
              {t.reviews.deliveryScore}{" "}
              <strong className="text-bone tabular-nums">
                {summary.deliveryAverage.toFixed(1).replace(".", ",")}
              </strong>{" "}
              / 5
            </p>
          )}
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {hasOwn && summary.items.length > 0
            ? summary.items.map((review) => (
                <div
                  key={review.id}
                  className="kinetic-card border border-line bg-void/60 p-6 flex flex-col justify-between"
                >
                  <div>
                    <Stars value={review.foodRating} className="mb-4 block" />
                    <p className="text-smoke text-sm leading-relaxed mb-6 italic">
                      „{review.comment}“
                    </p>

                    {/* İşletmenin cevabı yorumun altında durur: kötü bir yoruma
                        verilen iyi bir cevap, o yorumu okuyan için yorumun
                        kendisinden daha bilgilendiricidir. */}
                    {review.reply && (
                      <p className="border-l-2 border-amber/60 pl-3 text-xs leading-relaxed text-smoke/80 mb-6">
                        <span className="tag block text-amber mb-1">
                          {t.reviews.replyLabel}
                        </span>
                        {review.reply}
                      </p>
                    )}
                  </div>

                  <div className="border-t border-line/60 pt-4 flex items-center justify-between gap-3">
                    <span className="font-display font-bold text-bone text-sm">
                      {review.authorName}
                    </span>
                    <span className="tag shrink-0 text-herb/80">{t.reviews.verified}</span>
                  </div>
                </div>
              ))
            : t.reviews.items.map((rev, i) => (
                <div
                  key={i}
                  className="kinetic-card border border-line bg-void/60 p-6 flex flex-col justify-between"
                >
                  <p className="text-smoke text-sm leading-relaxed mb-6 italic">{rev.text}</p>
                  <div className="border-t border-line/60 pt-4 flex items-center justify-between">
                    <span className="font-display font-bold text-bone text-sm">{rev.name}</span>
                    <span className="text-amber text-xs">{rev.stars}</span>
                  </div>
                </div>
              ))}
        </div>

        {/*
          UWG § 5b Abs. 3'ün istediği açıklama.

          "Bu yorumların gerçek olduğunu nasıl temin ediyorsunuz?" sorusunun
          cevabı burada, yorumların yanında duruyor — bir alt sayfada değil.
        */}
        <p className="mt-10 border-t border-line pt-6 text-xs leading-relaxed text-smoke/70">
          {hasOwn ? t.reviews.trustNote : t.reviews.googleNote}
        </p>
      </div>
    </section>
  );
}

/**
 * Yıldız gösterimi.
 *
 * Metin karakteri kullanılıyor, ikon değil: ek bir ağ isteği ve yükleme
 * gecikmesi olmadan her tarayıcıda aynı çiziliyor. Ekran okuyucu için sayı
 * `aria-label` ile veriliyor — beş ayrı yıldız karakterini tek tek okumak
 * hiçbir şey anlatmaz.
 */
function Stars({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span
      aria-label={`${value} / 5`}
      className={`text-amber text-xl tracking-wide ${className}`}
    >
      {"★".repeat(value)}
      <span className="text-smoke/30">{"★".repeat(Math.max(0, 5 - value))}</span>
    </span>
  );
}
