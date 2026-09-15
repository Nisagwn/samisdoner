import type { AdminRole } from "@prisma/client";

/**
 * Panel yetkileri.
 *
 * Roller bir **hiyerarşi** değil, bir izin kümesi olarak tanımlanır. "OWNER
 * her şeyi yapar, MANAGER ondan azını" biçiminde sayısal bir sıra kurmak kısa
 * vadede daha az kod demek; uzun vadede "STAFF iade yapabilsin mi" sorusunun
 * cevabının bir `>=` karşılaştırmasında saklanması demek. Burada her iznin
 * kimde olduğu tek bir tabloda okunuyor ve değiştirmek o tabloyu düzenlemek.
 *
 * Ayrımın ölçütü güven değil, **hatanın bedeli**:
 *
 *  - Vardiyadaki herkes sipariş alabilmeli, fiş basabilmeli, gecikme
 *    bildirebilmeli. Buradaki bir hata aynı vardiya içinde fark edilir ve
 *    düzeltilir.
 *  - Yanlış girilmiş bir teslimat ücreti ya da silinmiş bir kategori günlerce
 *    fark edilmez ve her siparişte para kaybettirir → MANAGER.
 *  - Para iadesi geri alınamaz, personel listesi ise erişimin kendisidir →
 *    OWNER.
 *
 * Bu dosyada veritabanı ve `next/headers` yok: hem sunucu bileşenleri hem
 * route handler'lar hem de istemcideki menü aynı tabloyu okuyabilsin.
 */

export type AdminPermission =
  /** Sipariş akışı: kabul, ret, durum ilerletme, fiş, gecikme. */
  | "orders"
  /** Vardiya içi anahtarlar: sipariş duraklatma, hazırlık süresi. */
  | "shift"
  /** Menü, kategori, fiyat. */
  | "catalog"
  /** Çalışma saatleri, tatil günleri, teslim biçimleri, teslimat bölgeleri. */
  | "business"
  /** Değerlendirmelere cevap yazma ve yorum gizleme. */
  | "reviews"
  /** Ciro ekranı ve ödeme dökümü. */
  | "finance"
  /** Para iadesi. */
  | "refund"
  /** Panel kullanıcıları. */
  | "staff";

const PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  OWNER: ["orders", "shift", "catalog", "business", "reviews", "finance", "refund", "staff"],
  MANAGER: ["orders", "shift", "catalog", "business", "reviews", "finance"],
  STAFF: ["orders", "shift", "reviews"],
};

/** Rol adının panelde görünen karşılığı. Panel Türkçe. */
export const ROLE_LABELS: Record<AdminRole, string> = {
  OWNER: "Sahip",
  MANAGER: "Müdür",
  STAFF: "Personel",
};

export const ROLE_HINTS: Record<AdminRole, string> = {
  OWNER: "Her şey — personel, ciro ve iade dahil.",
  MANAGER: "Vardiya ve kurulum: menü, saatler, bölgeler, ciro. İade ve personel hariç.",
  STAFF: "Yalnızca vardiya: sipariş akışı, fiş, değerlendirme cevabı.",
};

export function can(role: AdminRole, permission: AdminPermission): boolean {
  return PERMISSIONS[role].includes(permission);
}

/**
 * Rol listesi — panelde seçim kutusunu doldurur.
 *
 * Sıra yetkiye göre azalan: en yetkili en üstte durur ve yanlışlıkla seçilmesi
 * en olası olan değer (listenin ilki) OWNER olmaz diye seçim kutusu
 * varsayılanını çağıran taraf STAFF verir.
 */
export const ROLE_OPTIONS: AdminRole[] = ["OWNER", "MANAGER", "STAFF"];
