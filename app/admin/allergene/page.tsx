import AllergenBulkEditor from "@/components/admin/AllergenBulkEditor";
import { getCatalog } from "@/lib/admin/store";

/**
 * Toplu alerjen girişi ekranı.
 *
 * Ayrı bir sayfa olmasının sebebi ölçek: ürün formu tek ürün için doğru araç,
 * ama menüde yüzden fazla satır var ve hepsinde bu bilgi yasal olarak zorunlu.
 * Canlıya almadan önce bu ekranın çıktısı "eksik ürün yok" olmalı.
 */
export const dynamic = "force-dynamic";

export default async function AdminAllergenePage() {
  const catalog = await getCatalog();

  const products = catalog.products
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const categories = catalog.categories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return <AllergenBulkEditor products={products} categories={categories} />;
}
