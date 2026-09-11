import { redirect } from "next/navigation";

/**
 * Eski ürün adresi.
 *
 * Ürünler ve kategoriler tek ekranda birleşti (`/admin/menu`). Adres
 * silinmedi, yönlendiriliyor: panoda, tarayıcı geçmişinde ve işletmecinin
 * yer imlerinde bu bağlantı duruyor.
 */
export default function AdminProductsRedirect() {
  redirect("/admin/menu");
}
