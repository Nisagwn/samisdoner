import { requirePanel } from "@/lib/admin/page";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import MenuManager, { type MenuTab } from "@/components/admin/MenuManager";
import { getCatalog } from "@/lib/admin/store";

/**
 * Menü ekranı — ürünler ve kategoriler.
 *
 * Katalog tek okumada alınır ve iki sekmeye birlikte verilir: kategori
 * sayfasının ayrı bir sorgusu yoktu zaten, ürün sayıları da aynı listeden
 * çıkıyor.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Menü // Panel",
  robots: { index: false, follow: false },
};

/** public/assets içindeki hazır görseller: ürün formuna seçenek olarak sunulur. */
async function listImages(): Promise<string[]> {
  try {
    const dir = path.join(process.cwd(), "public", "assets");
    const files = await fs.readdir(dir);
    return files
      .filter((f) => /\.(webp|png|jpe?g|avif)$/i.test(f) && !f.includes(".backup."))
      .sort()
      .map((f) => `/assets/${f}`);
  } catch {
    return [];
  }
}

export default async function AdminMenuPage({
  searchParams,
}: {
  searchParams?: { sekme?: string };
}) {
  await requirePanel("catalog");

  const [catalog, imageOptions] = await Promise.all([getCatalog(), listImages()]);

  const categories = catalog.categories.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const products = catalog.products.slice().sort((a, b) => a.sortOrder - b.sortOrder);

  const categoryRows = categories.map((category) => {
    const owned = products.filter((p) => p.categoryId === category.id);
    return {
      ...category,
      productCount: owned.length,
      activeCount: owned.filter((p) => p.active).length,
    };
  });

  // Tanınmayan değer ürün sekmesine düşer; adres çubuğundan gelen bir yazım
  // hatası boş ekran göstermesin.
  const initialTab: MenuTab = searchParams?.sekme === "kategoriler" ? "kategoriler" : "urunler";

  return (
    <MenuManager
      initialTab={initialTab}
      products={products}
      categories={categories}
      categoryRows={categoryRows}
      imageOptions={imageOptions}
    />
  );
}
