"use client";

import { useState } from "react";
import type { Category, Product } from "@/lib/admin/types";
import CategoryManager from "./CategoryManager";
import ProductManager from "./ProductManager";

/**
 * Menü ekranı — ürünler ve kategoriler bir arada.
 *
 * Bunlar iki ayrı sayfaydı (`/admin/products`, `/admin/categories`) ve kenar
 * çubuğunda iki ayrı satır olarak duruyordu. Sonucu işletmecinin şikâyetiyle
 * özetlenebilir: **kategorinin panelden düzenlenebildiği anlaşılmıyordu.**
 * Sebebi de anlaşılır — ürün ekranı gün içinde sürekli açılan yerdi, kategori
 * ekranı ise ayda bir; iki satır eşit ağırlıkta yan yana dizildiğinde ikincisi
 * "belki bir rapordur" diye hiç açılmadı. Oysa menüdeki başlıklar, başlık
 * sırası ve kategori notları oradan geliyor.
 *
 * Şimdi tek ekran, iki sekme. Kazanç sekmelerde değil **üstteki iki satırda**:
 * kategorinin ne işe yaradığı ve ürünle ilişkisi orada yazıyor, sekme
 * etiketleri de kaç kayıt olduğunu gösteriyor. Kategori sekmesi artık ürün
 * ekranının yanında, göz hizasında duruyor.
 *
 * Sekme durumu adres çubuğuna da yazılır (`?sekme=kategoriler`): panodan ya da
 * eski adreslerden gelen bağlantı doğru sekmeyi açsın. Yazma `replaceState`
 * ile yapılır — `router.replace` sunucu bileşenini yeniden çalıştırır ve
 * katalog boşuna bir kez daha okunurdu.
 */

export type MenuTab = "urunler" | "kategoriler";

type CategoryRow = Category & { productCount: number; activeCount: number };

const TABS: { id: MenuTab; label: string }[] = [
  { id: "urunler", label: "Ürünler" },
  { id: "kategoriler", label: "Kategoriler" },
];

export default function MenuManager({
  initialTab,
  products,
  categories,
  categoryRows,
  imageOptions,
}: {
  initialTab: MenuTab;
  products: Product[];
  categories: Category[];
  categoryRows: CategoryRow[];
  imageOptions: string[];
}) {
  const [tab, setTab] = useState<MenuTab>(initialTab);

  const select = (next: MenuTab) => {
    setTab(next);
    const url = next === "urunler" ? "/admin/menu" : `/admin/menu?sekme=${next}`;
    window.history.replaceState(null, "", url);
  };

  const count = (id: MenuTab) => (id === "urunler" ? products.length : categoryRows.length);

  return (
    <div className="min-w-0 max-w-[1200px]">
      <header className="mb-6">
        <p className="tag mb-2 text-flame">Katalog</p>
        <h1 className="font-display text-3xl font-extrabold text-bone md:text-4xl">Menü</h1>
        <p className="mt-3 max-w-[80ch] text-sm leading-relaxed text-smoke">
          Menü iki parçadan kurulur:{" "}
          <strong className="text-bone">kategoriler</strong> menüdeki başlıkları
          ve başlıkların sırasını belirler,{" "}
          <strong className="text-bone">ürünler</strong> ise her biri bir
          kategoriye bağlı olarak o başlığın altında listelenir. Bir kategoriyi
          yeniden adlandırmak veya yukarı taşımak, altındaki bütün ürünlerin
          menüde göründüğü yeri değiştirir.
        </p>
      </header>

      {/* Sekme şeridi. Sayılar burada duruyor ki hangi tarafta iş olduğu
          sekmeye basmadan görünsün. */}
      <div role="tablist" aria-label="Menü bölümleri" className="mb-8 flex gap-px border-b border-line">
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => select(item.id)}
              className={`focus-ring tag -mb-px border-b-2 px-5 py-3 transition-colors ${
                active
                  ? "border-amber bg-amber/10 text-amber"
                  : "border-transparent text-smoke hover:text-bone hover:bg-panel"
              }`}
            >
              {item.label}
              <span className={`ml-2 tabular-nums ${active ? "text-amber/70" : "text-smoke/50"}`}>
                {count(item.id)}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "urunler" ? (
        <ProductManager
          initialProducts={products}
          categories={categories}
          imageOptions={imageOptions}
        />
      ) : (
        <CategoryManager categories={categoryRows} />
      )}
    </div>
  );
}
