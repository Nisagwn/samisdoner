/**
 * Karta veri şekli.
 *
 * Menünün kendisi bu dosyada durmaz — tek kaynak admin panelinin yazdığı
 * katalogtur (`lib/admin/store.ts` → `getMenuSections`). Burada yalnızca o
 * katalogun ürettiği ve `MenuGrid` ile `AllergenTable`'ın okuduğu tipler tanımlı.
 *
 * Fiyatlar sayı değil metin olarak taşınır ki gösterimde hiçbir yuvarlama ya da
 * biçim kayması olmasın; tutar hesabı zaten yalnızca sunucuda, cent cinsinden yapılır.
 *
 * `name`/`desc` menüdeki Almanca aslıdır; `nameTr`/`descTr` Türkçe karşılığıdır
 * ve yalnızca gerçekten değişen yerlerde bulunur. Ürünün kendi adı olan
 * sözcükler (Lahmacun, Pide, Calzone, pizza adları, içecek markaları) iki dilde
 * de aynı yazıldığı için onlarda Türkçe alan yoktur — dil TR iken de Almanca
 * alan kullanılır.
 */

import type { AllergenNotice } from "@/lib/legal/allergens";

export type MenuVariant = {
  /** Porsiyon/boy etiketi: "28 CM", "0,33" gibi. */
  size: string;
  price: string;
  /**
   * PAngV § 4 temel fiyatı: "7,58 €/l". Yalnızca hacme göre satılan boylarda
   * doludur; "28 CM" gibi bir çap etiketinde hiç bulunmaz.
   */
  grundpreis?: string;
};

export type MenuItem = {
  /**
   * Katalogtaki ürün kimliği.
   *
   * Yalnızca depodan (admin paneli) üretilen menüde doludur; bu dosyadaki
   * basılı menü kopyasında yoktur. Alan doluysa satır **sipariş edilebilir**
   * ve karta üzerinde sepete ekleme düğmesi çıkar, boşsa satır salt okunur
   * kalır. Fiyat buradan gelmez: sepete yalnızca kimlik ve boy gönderilir,
   * tutarı her zaman sunucu hesaplar.
   */
  productId?: string;
  /** Menüdeki sipariş numarası. İçeceklerde numara yoktur. */
  no?: string;
  name: string;
  nameTr?: string;
  desc?: string;
  descTr?: string;
  /** Tek fiyatlı ürünler `price`, çok boylu ürünler `variants` kullanır. */
  price?: string;
  /** İndirim varsa üstü çizili gösterilecek eski fiyat. */
  oldPrice?: string;
  /** Admin panelinden atanan görsel (`/assets/...`); menüde küçük görsel olarak çıkar. */
  image?: string;
  variants?: MenuVariant[];
  /** Tek fiyatlı üründe PAngV § 4 temel fiyatı. */
  grundpreis?: string;
  /**
   * LMIV Art. 21 / ZZulV bildirimi.
   *
   * **Alan yoksa "madde yok" anlamına gelmez** — bilgi girilmemiş demektir ve
   * gösterimde "lütfen sorunuz" olarak çıkar. İşletmecinin "bu üründe bildirimi
   * zorunlu madde yok" beyanı ayrı bir hâldir (`kind: "none"`); ikisini
   * birbirine karıştırmak alerjik müşteride doğrudan sağlık riskidir.
   */
  allergens?: AllergenNotice;
};

export type MenuSection = {
  id: string;
  title: string;
  titleTr?: string;
  /** Kategorinin tamamı için geçerli not (ekstra malzeme, depozito …). */
  note?: string;
  noteTr?: string;
  items: MenuItem[];
};
