"use client";

import type { MenuItem } from "@/data/speisekarte";
import { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * Menü rozetleri.
 *
 * Altmış satırlık bir kartada müşterinin sorusu "ne var" değil, "ne alayım".
 * Rozetler o soruya listeye bakarken cevap verir: hangisi çok seviliyor,
 * hangisi yeni, hangisi acı, hangisinde et yok.
 *
 * Üç kural:
 *  - **Rozet renk değil metindir.** Yalnızca renkle ayrılan bir işaret, renk
 *    körü müşteri için hiç yoktur; her rozetin okunabilir bir yazısı var.
 *  - **Acılık sayılabilir.** "Scharf" tek başına karşılaştırılamaz; biber
 *    sayısı 1–3 arası bir ölçek verir ve `aria-label` sayıyı da söyler.
 *  - **İndirim yüzdesi hesaplanmış bir değerdir**, panelden girilmez: eski ve
 *    yeni fiyattan çıkar, dolayısıyla üstü çizili fiyatla asla çelişemez.
 */
export default function ProductBadges({
  item,
  className = "",
}: {
  item: MenuItem;
  className?: string;
}) {
  const { t } = useLanguage();
  const badges = t.ordering.badges;

  const spicy = item.spicyLevel ?? 0;
  const hasAny =
    item.isPopular ||
    item.isNew ||
    item.diet === "VEGETARIAN" ||
    item.diet === "VEGAN" ||
    spicy > 0 ||
    typeof item.discountPercent === "number";

  if (!hasAny) return null;

  return (
    <ul className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {typeof item.discountPercent === "number" && (
        <Badge tone="flame">
          {badges.discount.replace("{percent}", String(item.discountPercent))}
        </Badge>
      )}
      {item.isPopular && <Badge tone="amber">{badges.popular}</Badge>}
      {item.isNew && <Badge tone="sky">{badges.new}</Badge>}
      {item.diet === "VEGAN" && <Badge tone="herb">{badges.vegan}</Badge>}
      {item.diet === "VEGETARIAN" && <Badge tone="herb">{badges.vegetarian}</Badge>}
      {spicy > 0 && (
        <Badge tone="flame">
          {/* Biberler süs; anlamı taşıyan metin `aria-label`'da, çünkü ekran
              okuyucu "biber biber biber" diye okumamalı. */}
          <span aria-hidden>{"🌶".repeat(Math.min(spicy, 3))}</span>
          <span className="sr-only">{`${badges.spicy} ${Math.min(spicy, 3)}/3`}</span>
        </Badge>
      )}
    </ul>
  );
}

const TONES = {
  amber: "border-amber/50 bg-amber/10 text-amber",
  flame: "border-flame/50 bg-flame/10 text-flame",
  herb: "border-herb/50 bg-herb/10 text-herb",
  sky: "border-line bg-void text-bone",
} as const;

function Badge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <li className={`tag border px-2 py-0.5 text-[10px] leading-4 ${TONES[tone]}`}>{children}</li>
  );
}
