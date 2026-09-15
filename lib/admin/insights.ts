import { prisma } from "@/lib/db";

/**
 * En çok satanlar.
 *
 * Ciro ekranı şimdiye kadar yalnızca toplamları gösteriyordu: kaç sipariş, ne
 * kadar para, hangi KDV. Bunlar "iyi mi gidiyor" sorusunu cevaplıyor ama
 * işletmenin gerçekten karar verdiği soruyu — **ne alayım, neyi vitrine
 * çıkarayım, hangi ürün ölü** — cevaplamıyordu. Bir dönercinin haftalık et ve
 * ekmek siparişi bu listeye bakarak verilir.
 *
 * İki kural:
 *
 *  1. **Satır anlık görüntüsünden sayılır, üründen değil.** `OrderLine.label`
 *     sipariş anındaki addır ve ürün silinse bile yerinde durur. `productId`
 *     üzerinden gruplamak, menüden kaldırılmış ürünleri listeden düşürür ve
 *     "geçen ay ne sattık" sorusunun cevabını bozardı.
 *  2. **Yalnızca parası alınmış siparişler.** İptal edilmiş ya da ödemesi
 *     tamamlanmamış bir siparişin satırı satılmış değildir. Ölçüt ciro
 *     raporuyla aynı olmalı; iki ekranın farklı sayılar göstermesi, ikisine de
 *     güvenilmemesine yol açar.
 */

/** Ödenmiş ve iptal edilmemiş sayılan sipariş durumları. */
const SOLD_STATUSES = [
  "PAID",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "PICKED_UP",
] as const;

export type TopProduct = {
  label: string;
  /** Satılan adet — satır sayısı değil, `qty` toplamı. */
  qty: number;
  /** Bu üründen gelen ciro (cent). */
  revenueCents: number;
};

/**
 * Verilen gün sayısı içinde en çok satan ürünler.
 *
 * Gruplama `label` üzerinden yapılır ve bu, aynı ürünün adı panelden
 * değiştirilirse listede iki satır olarak görünmesi demektir. Alternatifi
 * (`productId`) silinmiş ürünleri tamamen kaybetmekti; adı değişen ürün nadir,
 * menüden kalkan ürün ise her ay oluyor.
 */
export async function getTopProducts(days: number, limit = 10): Promise<TopProduct[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.orderLine.groupBy({
    by: ["label"],
    where: {
      order: {
        createdAt: { gte: since },
        status: { in: [...SOLD_STATUSES] },
      },
    },
    _sum: { qty: true, lineCents: true },
    // Sıralama adet üzerinden: "en çok satan" bir adet sorusudur. Ciroya göre
    // sıralamak listeyi pahalı ürünlerin kapmasına yol açar ve mutfağın
    // ihtiyacı olan "en çok hangi malzeme gidiyor" bilgisini gizler.
    orderBy: { _sum: { qty: "desc" } },
    take: limit,
  });

  return rows.map((row) => ({
    label: row.label,
    qty: row._sum.qty ?? 0,
    revenueCents: row._sum.lineCents ?? 0,
  }));
}

/**
 * Hiç satmayan ürünler.
 *
 * "En çok satan" listesinin diğer ucu ve karar için çoğu zaman daha
 * değerlisi: menüde durup yer kaplayan, fotoğrafı çekilmiş, malzemesi
 * stokta bekleyen ürün. Yalnızca **yayında olan** ürünler sayılır — pasif bir
 * ürünün satmaması bir bulgu değil, zaten verilmiş bir karardır.
 */
export async function getStaleProducts(days: number, limit = 10): Promise<string[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [active, sold] = await Promise.all([
    prisma.product.findMany({
      where: { active: true, showOnHome: true },
      select: { name: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.orderLine.groupBy({
      by: ["label"],
      where: {
        order: { createdAt: { gte: since }, status: { in: [...SOLD_STATUSES] } },
      },
    }),
  ]);

  const soldLabels = new Set(sold.map((row) => row.label));
  return active
    .map((product) => product.name)
    .filter((name) => !soldLabels.has(name))
    .slice(0, limit);
}
