"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { MenuItem, MenuSection, MenuVariant } from "@/data/speisekarte";
import AllergenWarning from "@/components/legal/AllergenWarning";
import { useCart } from "@/lib/cart";
import { FavoriteButton } from "@/components/FavoriteButton";
import { Button } from "@/components/ui";
import { useLanguage, type Language } from "@/lib/i18n/LanguageContext";

/**
 * Karta (Speisekarte) gövdesi — sitenin sipariş yüzeyi.
 *
 * Hem ana sayfada hem `/speisekarte` sayfasında **aynı bileşen** çalışır, aynı
 * biçimde: her iki yerde de üstünde başka bir bölüm (vitrin) durduğu için menü
 * hiçbir zaman sayfanın ilk başlığı değildir ve `h2` ile açılır. Böylece
 * müşteri hangi kapıdan girerse girsin aynı menüyü, aynı davranışla görür.
 *
 * Ürünler admin panelinin yazdığı katalogtan sunucu tarafında gelir
 * (`sections`); pasif / tükenmiş / menüden gizlenmiş ürünler bu listeye hiç
 * girmez.
 *
 * Sepete ekleme burada yapılır ama **fiyat burada hesaplanmaz**: sepete
 * yalnızca ürün kimliği ve seçilen boy gönderilir, tutarı `/api/menu/quote`
 * üretir. Ekrandaki fiyat da katalogtan gelen hazır metindir; bu bileşende
 * hiçbir aritmetik yoktur.
 */

type Props = {
  sections: MenuSection[];
};

/** Arama kutusunun eşleştirdiği alanlar; numara da dahil ("07" yazınca bulunur). */
function matches(item: MenuItem, needle: string): boolean {
  if (!needle) return true;
  const haystack = [item.no, item.name, item.nameTr, item.desc, item.descTr]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("de-DE");
  return haystack.includes(needle);
}

export default function MenuGrid({ sections }: Props) {
  const { t, lang } = useLanguage();
  const section = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(sections[0]?.id ?? "");

  const needle = query.trim().toLocaleLowerCase("de-DE");

  /**
   * Aramanın uygulanmış hâli.
   *
   * Süzgeç kategoriyi değil ürünü eler; hiç ürünü kalmayan kategori listeden
   * tamamen düşer, böylece boş başlıklar arasında gezinmek gerekmez.
   */
  const visible = useMemo(() => {
    if (!needle) return sections;
    return sections
      .map((cat) => ({ ...cat, items: cat.items.filter((item) => matches(item, needle)) }))
      .filter((cat) => cat.items.length > 0);
  }, [sections, needle]);

  // Arama listeyi daralttığında seçili kategori listeden düşmüş olabilir;
  // şeritte hiçbir şey işaretli kalmasın.
  useEffect(() => {
    if (visible.length > 0 && !visible.some((cat) => cat.id === active)) {
      setActive(visible[0].id);
    }
  }, [visible, active]);

  // Kartların görünüre girerken yumuşak açılışı — sitenin geri kalanıyla aynı ritim.
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      visible.forEach((cat) => {
        // Arama listeyi daralttığında DOM'da olmayan bir kategori kalabilir.
        if (!document.getElementById(`kat-${cat.id}`)) return;
        ScrollTrigger.create({
          trigger: `#kat-${cat.id}`,
          start: "top 85%",
          once: true,
          onEnter: () => {
            gsap.fromTo(
              `#kat-${cat.id} .menu-card`,
              { opacity: 0, y: 18 },
              {
                opacity: 1,
                y: 0,
                stagger: 0.03,
                duration: 0.45,
                ease: "power3.out",
                clearProps: "opacity,transform",
              }
            );
          },
        });
      });
    }, section);
    return () => ctx.revert();
  }, [visible]);

  // Yapışkan şeritteki aktif kategoriyi okunan bölüme göre işaretle.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (seen) setActive(seen.target.id.replace("kat-", ""));
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );

    visible.forEach((cat) => {
      const el = document.getElementById(`kat-${cat.id}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [visible]);

  return (
    <section
      ref={section}
      id="menu"
      className="relative overflow-hidden bg-char pb-28 md:pb-36 pt-16 md:pt-20 border-t border-line"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,#FF3D12,#FFC247,#7BD66F,transparent)]" />
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_16%_10%,rgba(255,61,18,0.16),transparent_36%),radial-gradient(ellipse_at_86%_20%,rgba(98,213,255,0.10),transparent_34%)]" />

      <div className="relative z-10 max-w-[1400px] mx-auto px-6 md:px-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
          <div>
            <p className="tag text-flame mb-3">{t.menuGrid.tag}</p>
            <h2 className="section-title font-display font-extrabold text-bone">
              {t.menuGrid.title1}
              <br />
              <span className="text-flame">{t.menuGrid.title2}</span>
            </h2>
          </div>
          <p className="tag text-smoke max-w-[280px]">{t.menuGrid.subText}</p>
        </div>

      </div>

      {/* Kategori şeridi + arama.
          Navbar sayfanın üstüne sabitlendiği için şerit onun altına yapışır;
          `--nav-h` header yüksekliğini taşır (globals.css). Mobilde kategoriler
          yatay kaydırılır, arama kutusu altına iner. */}
      <nav
        aria-label={t.menuGrid.categoryNavLabel}
        className="sticky top-[var(--nav-h)] z-30 bg-void/95 backdrop-blur-md border-y border-line mb-12"
      >
        <div className="max-w-[1400px] mx-auto flex flex-col lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <ul className="flex items-stretch gap-px w-max min-w-full px-6 md:px-10">
              {visible.map((cat) => (
                <li key={cat.id}>
                  <a
                    href={`#kat-${cat.id}`}
                    className={`focus-ring block whitespace-nowrap tag px-4 py-4 border-b-2 transition-colors ${
                      active === cat.id
                        ? "border-flame text-amber"
                        : "border-transparent text-smoke hover:text-bone"
                    }`}
                    aria-current={active === cat.id ? "true" : undefined}
                  >
                    {lang === "tr" ? cat.titleTr ?? cat.title : cat.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative shrink-0 px-6 md:px-10 pb-3 lg:py-2">
            <label htmlFor="menu-search" className="sr-only">
              {t.menuGrid.searchLabel}
            </label>
            <input
              id="menu-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.menuGrid.searchPlaceholder}
              className="w-full lg:w-[260px] bg-char border border-line px-3 py-2 text-sm text-bone placeholder:text-smoke/50 outline-none transition-colors focus:border-amber"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label={t.menuGrid.searchClear}
                className="focus-ring absolute right-8 md:right-12 top-1/2 -translate-y-1/2 px-2 text-smoke hover:text-flame transition-colors"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </nav>

      <div className="relative z-10 max-w-[1400px] mx-auto px-6 md:px-10">
        {sections.length === 0 && (
          <p className="border border-line bg-void px-5 py-8 text-center text-smoke">
            {t.menuGrid.empty}
          </p>
        )}
        {sections.length > 0 && visible.length === 0 && (
          <p className="border border-line bg-void px-5 py-8 text-center text-smoke">
            {t.menuGrid.noResults.replace("{query}", query.trim())}
          </p>
        )}

        <div className="space-y-16 md:space-y-20">
          {visible.map((category) => (
            <div
              key={category.id}
              id={`kat-${category.id}`}
              // hedef başlık, sabit navbar + kategori şeridinin altında kalmasın
              className="scroll-mt-[calc(var(--nav-h)+3.5rem)]"
            >
              <div className="flex items-center gap-5 mb-8">
                <h2 className="font-display font-extrabold text-2xl md:text-3xl text-bone whitespace-nowrap">
                  {lang === "tr" ? category.titleTr ?? category.title : category.title}
                </h2>
                <span className="h-px flex-1 bg-line" />
              </div>

              <ul className="grid md:grid-cols-2 gap-px bg-line border border-line">
                {category.items.map((item, i) => (
                  <MenuRow
                    key={`${category.id}-${item.productId ?? item.no ?? item.name}-${i}`}
                    item={item}
                    lang={lang}
                  />
                ))}
              </ul>

              {category.note && (
                <p className="tag text-amber mt-5 border border-line bg-void px-4 py-3">
                  {lang === "tr" ? category.noteTr ?? category.note : category.note}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto mt-20 w-full max-w-5xl px-5">
        <AllergenWarning />
      </div>
    </section>
  );
}

/**
 * Tek ürün satırı.
 *
 * Numara ve fiyat kenarlarda sabit kalır, ad ve içerik ortada esner; böylece
 * dar ekranda uzun içerik listeleri fiyatı aşağı itmez ya da taşırmaz.
 *
 * Boy seçimi satırın kendi durumudur: seçilen boy hem büyük fiyatı hem sepete
 * gidecek `variantSize` değerini belirler. Böylece "hangi fiyatı ekliyorum"
 * sorusu hiç doğmaz.
 */
function MenuRow({ item, lang }: { item: MenuItem; lang: Language }) {
  const { t } = useLanguage();
  const { add } = useCart();
  const [sizeIndex, setSizeIndex] = useState(0);
  const [justAdded, setJustAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bileşen sökülürse zamanlayıcı kapalı bir bileşene yazmaya çalışmasın.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Türkçe karşılığı olmayan alanlarda (pizza adları, markalar) Almanca aslı kalır.
  const name = lang === "tr" ? item.nameTr ?? item.name : item.name;
  const desc = lang === "tr" ? item.descTr ?? item.desc : item.desc;

  const variants: MenuVariant[] = item.variants ?? [];
  const selected: MenuVariant | undefined = variants[sizeIndex] ?? variants[0];
  const shownPrice = selected ? selected.price : item.price;
  const shownGrundpreis = selected ? selected.grundpreis : item.grundpreis;
  const orderable = Boolean(item.productId);

  function addToCart() {
    if (!item.productId) return;
    add({
      kind: "product",
      productId: item.productId,
      ...(selected ? { variantSize: selected.size } : {}),
    });
    setJustAdded(true);
    if (timer.current) clearTimeout(timer.current);
    // Sepet çekmecesi bilerek açılmaz: müşteri menüde kalıp eklemeye devam
    // edebilsin. Eklendiği, satırdaki geri bildirimden ve alttaki sepet
    // çubuğunun sayacından görülür.
    timer.current = setTimeout(() => setJustAdded(false), 1600);
  }

  return (
    <li className="menu-card bg-void hover:bg-panel transition-colors duration-300 p-5 md:p-6 flex gap-4">
      {item.no && (
        <span className="font-mono text-sm text-flame shrink-0 tabular-nums pt-0.5 w-9">
          {item.no}
        </span>
      )}

      {item.image && (
        <span className="relative w-16 h-16 shrink-0 overflow-hidden border border-line bg-panel">
          <Image src={item.image} alt="" fill sizes="64px" className="object-cover" />
        </span>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="flex items-center gap-2 font-display font-bold text-base md:text-lg text-bone leading-tight">
            {name}
            {/* Kalp yalnızca katalogtan gelen (sipariş edilebilir) üründe
                anlamlı: basılı menü kopyasındaki satırın kimliği yok. */}
            {item.productId && <FavoriteButton productId={item.productId} name={name} />}
          </h3>
          {shownPrice && (
            <span className="flex items-baseline gap-2 whitespace-nowrap">
              {/* İndirim yalnızca tek fiyatlı üründe tanımlı; boy seçilebilen
                  üründe üstü çizili fiyat gösterilmez, çünkü hangi boya ait
                  olduğu belirsiz kalırdı. */}
              {item.oldPrice && !selected && (
                <span className="text-sm text-smoke line-through tabular-nums">
                  {item.oldPrice}
                </span>
              )}
              <span className="font-display font-extrabold text-lg md:text-xl text-amber tabular-nums">
                {shownPrice}
              </span>
            </span>
          )}
        </div>

        {desc && <p className="text-smoke text-sm leading-relaxed mt-1.5">{desc}</p>}


        {variants.length > 0 && (
          <div className="mt-3 pt-3 border-t border-line">
            <p className="tag text-smoke mb-2">{t.menuGrid.sizeLabel}</p>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label={`${name} — ${t.menuGrid.sizeLabel}`}
            >
              {variants.map((variant, i) => {
                const isSelected = i === sizeIndex;
                return (
                  <button
                    key={variant.size}
                    type="button"
                    onClick={() => setSizeIndex(i)}
                    aria-pressed={isSelected}
                    className={`focus-ring border px-3 py-1.5 text-left transition-colors ${
                      isSelected
                        ? "border-amber bg-amber/10 text-amber"
                        : "border-line text-smoke hover:border-smoke hover:text-bone"
                    }`}
                  >
                    <span className="tag block">{variant.size}</span>
                    <span className="font-display font-bold text-sm tabular-nums">
                      {variant.price}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* PAngV § 4: hacme göre satılan üründe litre fiyatı son fiyatın
            yanında görünmek zorunda. Seçili boyun temel fiyatı burada durur. */}
        {shownGrundpreis && (
          <p className="font-mono text-[11px] text-smoke tabular-nums mt-2">({shownGrundpreis})</p>
        )}

        {orderable ? (
          <Button
            type="button"
            variant={justAdded ? "success" : "outline"}
            onClick={addToCart}
            className="mt-4 w-full sm:w-auto"
          >
            {justAdded ? t.menuGrid.added : t.menuGrid.addToCart}
          </Button>
        ) : (
          // Basılı menü kopyasından gelen satır: katalog kimliği yok, sipariş
          // edilemez. Sessizce buton gizlemek yerine sebebi yazılır.
          <p className="mt-4 font-mono text-[11px] text-smoke/70">{t.menuGrid.onlyReadable}</p>
        )}
      </div>
    </li>
  );
}
