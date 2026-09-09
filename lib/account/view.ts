import { prisma } from "@/lib/db";
import { getCatalog, isVisible } from "@/lib/admin/store";
import { effectivePrice, formatPrice } from "@/lib/admin/types";
import { STATUS_HINTS, STATUS_LABELS, isTerminal } from "@/lib/orders/status";
import { describeCancelReason } from "@/lib/orders/cancelReasons";
import { createOrderToken } from "@/lib/orders/token";
import { reorderDrafts } from "@/lib/orders/reorder";
import { listCustomerOrders } from "./repository";
import { listFavoriteProductIds } from "./favorites";
import type { AccountOrder } from "@/components/account/OrdersPanel";
import type { FavoriteItem } from "@/components/account/FavoritesPanel";
import type { AccountSummary } from "@/components/account/AccountShell";

/**
 * Hesap ekranlarının sunucu tarafı görünümü.
 *
 * Beş ekran da aynı verilere farklı kesitlerden bakıyor; hazırlığı tek yerde
 * toplamak, "genel bakış"taki sipariş kartıyla "siparişler"deki kartın
 * ayrışmasını imkânsız kılıyor. Buradaki hiçbir fonksiyon yetki kontrolü
 * yapmaz: hepsi `customerId` alır, o kimliği **oturumdan** almak çağıran
 * sayfanın işidir (bkz. lib/account/guard.ts).
 */

/** Gezinme çubuğundaki sayılar. Üç ucuz sayım; sayfa başına bir kez. */
export async function getAccountSummary(customerId: string): Promise<AccountSummary> {
  const [orderCount, activeOrderCount, addressCount, favoriteCount] = await Promise.all([
    prisma.order.count({ where: { customerId } }),
    /*
     * "Devam eden" müşteri gözünden tanımlanır ve ödeme bekleyeni de içerir:
     * müşteri için o sipariş hâlâ açıktır. İşletmenin `ACTIVE_STATUSES`
     * tanımıyla bilerek aynı değil.
     */
    prisma.order.count({
      where: {
        customerId,
        status: {
          in: ["PENDING_PAYMENT", "PAID", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"],
        },
      },
    }),
    prisma.customerAddress.count({ where: { customerId } }),
    prisma.favorite.count({ where: { customerId } }),
  ]);

  return { orderCount, activeOrderCount, addressCount, favoriteCount };
}

/**
 * Sipariş geçmişini arayüzün beklediği biçime çevirir.
 *
 * Takip bağlantısı burada imzalanır: sipariş numarası tahmin edilebilir olduğu
 * için tek başına yetki kanıtı değildir.
 */
export async function getAccountOrders(
  customerId: string,
  lang: string,
  take = 30
): Promise<AccountOrder[]> {
  const rows = await listCustomerOrders(customerId, take);
  const de = lang !== "tr";

  return Promise.all(
    rows.map(async (order) => ({
      orderNo: order.orderNo,
      createdAt: new Intl.DateTimeFormat(de ? "de-DE" : "tr-TR", {
        timeZone: "Europe/Berlin",
        dateStyle: "short",
        timeStyle: "short",
      }).format(order.createdAt),
      statusLabel: STATUS_LABELS[order.status][de ? "de" : "tr"],
      // Durumun kendisi yetmediğinde açıklaması (şu an: süresi dolan sipariş).
      statusHint: STATUS_HINTS[order.status]?.[de ? "de" : "tr"] ?? null,
      active: !isTerminal(order.status),
      // Sebep kimliği burada cümleye çevrilir; istemciye çeviri tablosu
      // taşımanın anlamı yok.
      cancelReason: describeCancelReason(order.cancelReason, order.lang || lang),
      totalCents: order.totalCents,
      trackingUrl: `/bestellung/${encodeURIComponent(await createOrderToken(order.orderNo))}`,
      lines: order.lines.map((line) => ({
        label: line.label,
        detail: line.detail,
        qty: line.qty,
        lineCents: line.lineCents,
      })),
      reorder: reorderDrafts(order.lines),
    }))
  );
}

/**
 * Favori ürünleri katalogla birleştirir.
 *
 * Fiyat ve satılabilirlik **bugünün** katalogundan okunur; favori kaydı
 * yalnızca bir kimliktir. Menüden kalkmış ürün listede kalır ama
 * `available: false` gelir: müşterinin işaretini sessizce silmek yerine
 * "şu anda mevcut değil" demek doğru olan.
 */
export async function getFavoriteItems(
  customerId: string,
  lang: string
): Promise<FavoriteItem[]> {
  const [ids, catalog] = await Promise.all([
    listFavoriteProductIds(customerId),
    getCatalog(),
  ]);
  if (ids.length === 0) return [];

  const byId = new Map(catalog.products.map((product) => [product.id, product] as const));
  const tr = lang === "tr";

  // Sıra favori kaydının sırasıdır (en yeni önce); silinmiş ürünler düşer.
  return ids.flatMap((id) => {
    const product = byId.get(id);
    if (!product) return [];

    return [
      {
        productId: product.id,
        name: (tr && product.nameTr) || product.name,
        description: (tr && product.descriptionTr) || product.description,
        price: formatPrice(effectivePrice(product)),
        oldPrice: product.discountPrice !== null ? formatPrice(product.price) : null,
        image: product.image,
        available: isVisible(product),
        variants: product.variants.map((variant) => ({
          size: variant.size,
          price: formatPrice(variant.price),
        })),
      },
    ];
  });
}
