/**
 * Karta veri şekli.
 *
 * Menünün kendisi bu dosyada durmaz — tek kaynak admin panelinin yazdığı
 * katalogtur (`lib/admin/store.ts` → `getMenuSections`). Burada yalnızca o
 * katalogun ürettiği ve `MenuGrid`'in okuduğu tipler tanımlı.
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

import type { OptionGroup } from "@/lib/menu/options";
import type { DietTag } from "@/lib/admin/types";

export type MenuVariant = {
  /** Porsiyon/boy etiketi: "28 CM", "0,33" gibi. */
  size: string;
  price: string;
  /**
   * Aynı fiyatın cent karşılığı.
   *
   * Metin biçim için, sayı hesap için: ürün penceresi seçenek ek ücretlerini
   * eklerken canlı bir toplam gösteriyor ve o toplamı "7,00 €" dizesinden geri
   * ayrıştırmak, biçimlendirmenin tersine çevrilebilir olmasına bel bağlamak
   * demekti. Tahsil edilen tutar yine yalnızca sunucuda hesaplanır; buradaki
   * sayı ekrandaki ön izleme içindir.
   */
  priceCents: number;
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
   * Ürün penceresinde sorulan seçimler (et türü, sos, ekstra malzeme).
   *
   * Boşsa satır doğrudan sepete eklenir. Zorunlu grup varsa düğme "seç" der
   * ve pencere açılır — seçim yapılmadan sepete satır girmez.
   */
  optionGroups?: OptionGroup[];
  /** Taban fiyat (cent). Pencere canlı toplamı bunun üstüne kurar. */
  baseCents?: number;

  /* --- rozetler --- */
  isPopular?: boolean;
  isNew?: boolean;
  diet?: DietTag;
  /** 0 = işaret yok, 1–3 arası biber. */
  spicyLevel?: number;
  /** İndirim yüzdesi; indirim yoksa tanımsız. */
  discountPercent?: number;
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
