"use client";

import { formatCents } from "@/lib/money";
import { campaignTitle, type MenuCampaign } from "@/lib/orders/campaign";
import { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * Menü sayfasındaki kampanya şeridi.
 *
 * Otomatik kampanya (ayın ürünü, menü fiyatı) sepette kendiliğinden düşüyor;
 * duyurulmazsa müşteri ancak ödeme ekranında fark eder ve kampanyanın
 * satışa etkisi olmaz. Kodlu kampanyalar burada yok (bkz. `MenuCampaign`).
 *
 * Tutarların hiçbiri burada hesaplanmıyor: sunucu hangi kampanyanın şu an
 * geçerli olduğunu ve ürünlerin normal fiyatını veriyor, bileşen yalnızca
 * cümle kuruyor. Sepetteki gerçek indirim yine teklif ucundan gelir.
 */
export default function CampaignStrip({ campaigns }: { campaigns: MenuCampaign[] }) {
  const { t, lang } = useLanguage();
  if (campaigns.length === 0) return null;

  const c = t.ordering.campaigns;
  const itemName = (item: MenuCampaign["items"][number]) =>
    (lang === "tr" ? item.nameTr || item.name : item.name) +
    (item.variantSize ? ` (${item.variantSize})` : "");

  // Saat dilimi sabit: sunucu ile tarayıcı farklı dilimdeyse gün kayıp
  // hidrasyon uyuşmazlığı doğmasın.
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "tr-TR", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Europe/Berlin",
    }).format(new Date(iso));

  return (
    <section aria-labelledby="campaigns-title" className="border-t border-line bg-void py-12 md:py-16">
      <div className="mx-auto max-w-[1400px] px-6 md:px-10">
        <h2 id="campaigns-title" className="font-display text-2xl font-extrabold text-bone md:text-3xl">
          {c.title}
        </h2>
        <p className="tag mt-2 text-smoke">{c.lead}</p>

        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => {
            const price = formatCents(campaign.value);
            let headline = "";
            let regular: number | null = null;

            if (campaign.kind === "PRODUCT_PRICE") {
              headline = c.productPrice
                .replace("{products}", campaign.items.map(itemName).join(", "))
                .replace("{price}", price);
              if (campaign.items.length === 1) regular = campaign.items[0].regularCents;
            } else if (campaign.kind === "BUNDLE_PRICE") {
              headline = c.bundle
                .replace(
                  "{items}",
                  campaign.items
                    .map((item) => `${item.qty > 1 ? `${item.qty}× ` : ""}${itemName(item)}`)
                    .join(" + ")
                )
                .replace("{price}", price);
              regular = campaign.items.reduce((sum, item) => sum + item.regularCents * item.qty, 0);
            } else if (campaign.kind === "PERCENT") {
              headline =
                c.percent.replace("{value}", String(campaign.value)) +
                (campaign.maxDiscountCents > 0
                  ? ` ${c.percentMax.replace("{amount}", formatCents(campaign.maxDiscountCents))}`
                  : "");
            } else {
              headline = c.fixed.replace("{amount}", price);
            }

            const conditions: string[] = [];
            if (campaign.minOrderCents > 0) {
              conditions.push(c.minOrder.replace("{amount}", formatCents(campaign.minOrderCents)));
            }
            if (campaign.fulfillment === "DELIVERY") conditions.push(c.deliveryOnly);
            if (campaign.fulfillment === "PICKUP") conditions.push(c.pickupOnly);
            if (campaign.expiresAt) conditions.push(c.until.replace("{date}", formatDate(campaign.expiresAt)));
            if (campaign.kind === "PRODUCT_PRICE" || campaign.kind === "BUNDLE_PRICE") {
              conditions.push(c.extrasNote);
            }

            const title = campaignTitle(campaign, lang);

            return (
              <li key={campaign.id} className="border border-amber/40 bg-amber/5 p-5">
                {title && <p className="tag text-amber">{title}</p>}
                <p className="mt-2 font-display text-lg font-bold leading-snug text-bone">{headline}</p>
                {regular !== null && regular > campaign.value && (
                  <p className="mt-1 font-mono text-xs text-smoke line-through">
                    {c.instead.replace("{price}", formatCents(regular))}
                  </p>
                )}
                {conditions.length > 0 && (
                  <p className="mt-3 text-xs leading-relaxed text-smoke">{conditions.join(" · ")}</p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
