import type { CartLineDraft } from "@/lib/cart";

/**
 * Geçmiş bir siparişi sepete geri koymak.
 *
 * Sipariş satırının `options` alanı, sipariş anında oraya yazılmış sepet
 * girdisidir. Yine de körü körüne güvenilmez: veri JSON sütunundan geliyor ve
 * şema zamanla değişebilir. Tanımadığımız biçim sessizce atlanır — "tekrar
 * sipariş" düğmesinin eksik çıkması, sepete bozuk satır koymaktan iyidir.
 * Kaldırılan yapılandırıcının satırları da buraya düşer: eski siparişlerde
 * duruyorlar ama artık sepete geri konamazlar.
 *
 * Menüden kalkmış ürünler burada elenmez: sepete eklendiklerinde fiyat ucu
 * onları "artık yok" olarak işaretler ve sepet uyarıyı zaten gösterir. Aynı
 * kontrolü burada tekrarlamak, iki ayrı yerde eskiyecek iki ayrı kural olurdu.
 */
export function toCartDraft(options: unknown, qty = 1): CartLineDraft | null {
  if (typeof options !== "object" || options === null) return null;
  const line = options as Record<string, unknown>;

  if (line.kind === "product" && typeof line.productId === "string") {
    /*
     * Seçenekler ve not da geri taşınır.
     *
     * Taşınmasaydı "tekrar sipariş", et türü seçilmemiş bir döner üretirdi:
     * satır sepete girer ama sunucu onu fiyatlayamaz ve müşteri "artık mevcut
     * değil" uyarısıyla karşılaşırdı — üstelik ürün menüde duruyorken.
     *
     * Seçeneklerin hâlâ geçerli olup olmadığına burada bakılmaz (panelde
     * silinmiş olabilirler); o kararı da ürünün kendisinde olduğu gibi fiyat
     * ucu verir. Bkz. yukarıdaki not.
     */
    const options = Array.isArray(line.options)
      ? line.options.filter((id): id is string => typeof id === "string")
      : [];

    return {
      kind: "product",
      productId: line.productId,
      ...(typeof line.variantSize === "string" ? { variantSize: line.variantSize } : {}),
      ...(options.length > 0 ? { options } : {}),
      ...(typeof line.note === "string" && line.note ? { note: line.note } : {}),
      qty,
    };
  }

  return null;
}

/**
 * Sipariş satırlarından sepet taslakları.
 *
 * Adet de taşınır: "3× Döner"i tekrar sipariş eden biri 1 tane değil 3 tane
 * bekler.
 */
export function reorderDrafts(
  lines: readonly { options: unknown; qty: number }[]
): CartLineDraft[] {
  return lines
    .map((line) => toCartDraft(line.options, line.qty))
    .filter((draft): draft is CartLineDraft => draft !== null);
}
