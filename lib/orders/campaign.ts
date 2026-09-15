import {
  couponEligibility,
  discountFor,
  isItemCampaign,
  type CampaignItem,
  type CouponKind,
  type CouponRejection,
  type CouponRule,
} from "./coupon";

/**
 * Kampanyaların sepette birleşmesi.
 *
 * **Saf mantık** (veritabanı yok): kurallar ve fiyatlanmış satırlar girer,
 * her kampanyanın ne kadar indirdiği ve indirimin hangi satıra düştüğü çıkar.
 * Kuralları okuyan katman `lib/orders/coupons.ts`, çağıran `checkout.ts`.
 *
 * AYNI SEPETTE BİRDEN ÇOK KAMPANYA
 *
 * Otomatik kampanyaların hepsi (kodsuz: ayın ürünü, menü fiyatı, "bu hafta
 * %10") ve müşterinin girdiği **tek** kod birlikte değerlendirilir. Tek kural
 * var: **bir adet ürün iki kez indirim almaz.** Sıra bu yüzden sabit:
 *
 *   1. Menü fiyatları — setleri oluşturan adetleri "kullanılmış" işaretler.
 *   2. Ürüne özel fiyatlar — kalan adetlere; aynı ürüne iki kampanya varsa
 *      müşteri için daha ucuz olanı.
 *   3. Sepet indirimleri (yüzde / sabit) — ürün indirimleri düşüldükten sonra
 *      kalan tutara.
 *
 * Menü önce gelir, çünkü set bozulursa hiç oluşmaz: Dürüm ayın ürünü fiyatına
 * geçip "Dürüm + Ayran" menüsünü dağıtsaydı, müşteri menüyü sepete koyduğu
 * hâlde menü fiyatını görmezdi.
 *
 * FİYAT NEYİN ÜZERİNDEN
 *
 * Kampanya fiyatı ürünün **taban** fiyatını (boy fiyatı, varsa üstü çizili
 * indirimli fiyatı) değiştirir; seçenek ek ücretleri (ekstra peynir) ayrıca
 * alınır. "Dürüm 6,50 €" diyen kampanyada ekstra peynirli Dürüm 6,50 € +
 * peynirdir. Kampanya fiyatı taban fiyattan pahalıysa indirim yoktur; kampanya
 * hiçbir zaman fiyatı artırmaz.
 *
 * İNDİRİM HANGİ SATIRA DÜŞER
 *
 * Ürüne bağlı indirim, ait olduğu satırın tutarından düşülür
 * (`lineDiscountCents`). Bu bir süs değil, KDV'nin kendisi: %19'luk Ayran'ın
 * indirimi %7'lik yemeğin matrahından düşülürse iki oranın vergisi de yanlış
 * yazılır. Sepet indirimleri ise eskisi gibi bütün satırlara oransal dağıtılır
 * (bkz. `composeTotals`).
 */

/** Kampanya hesabının satırdan ihtiyaç duyduğu kadarı. */
export type CampaignLine = {
  productId: string;
  variantSize?: string;
  /** Seçenek ek ücretleri hariç adet fiyatı (cent). */
  unitBaseCents: number;
  qty: number;
  unavailable?: boolean;
};

export type AppliedCampaign = {
  rule: CouponRule;
  amountCents: number;
};

export type CampaignResult = {
  /** İndirim yapan kampanyalar, tutarıyla. İndirimi 0 olanlar listede yok. */
  applied: AppliedCampaign[];
  /** Satır başına ürün indirimi (cent); `lines` ile aynı sırada. */
  lineDiscountCents: number[];
  /** Sepet indirimlerinin toplamı (yüzde / sabit). */
  cartDiscountCents: number;
  /** Hepsinin toplamı. */
  discountCents: number;
  /** Kabul edilen kod; kod yoksa ya da indirim yapmadıysa boş. */
  code: string;
  /** Kod girildi ama kabul edilmediyse sebebi. */
  codeRejection: CouponRejection | null;
};

type Unit = { line: number; productId: string; variantSize?: string; base: number };

function matches(item: CampaignItem, unit: Unit): boolean {
  return (
    item.productId === unit.productId && (!item.variantSize || item.variantSize === unit.variantSize)
  );
}

export function applyCampaigns(input: {
  /** Otomatik (kodsuz) kampanyalar; geçerli olmayanlar sessizce atlanır. */
  automatic: CouponRule[];
  /** Girilen kodun kuralı; kod bulunamadıysa null. */
  coded: CouponRule | null;
  /** Normalleştirilmiş kod; kod girilmediyse boş. */
  enteredCode: string;
  lines: CampaignLine[];
  subtotalCents: number;
  fulfillment: "DELIVERY" | "PICKUP";
  now?: Date;
}): CampaignResult {
  const context = {
    subtotalCents: input.subtotalCents,
    fulfillment: input.fulfillment,
    now: input.now,
  };

  let codeRejection: CouponRejection | null = null;
  const rules: CouponRule[] = [];

  if (input.enteredCode) {
    if (!input.coded) codeRejection = { code: "coupon_unknown" };
    else codeRejection = couponEligibility(input.coded, context);
    // Kodlu kampanya önce: müşterinin bilerek girdiği şey, bir menü setini
    // otomatik bir kampanyaya kaptırmasın.
    if (input.coded && !codeRejection) rules.push(input.coded);
  }
  for (const rule of input.automatic) {
    if (!couponEligibility(rule, context)) rules.push(rule);
  }

  const lineDiscountCents = input.lines.map(() => 0);
  const amounts = rules.map(() => 0);

  /* Sepetteki her adet ayrı bir birim: "3× Dürüm" üç birimdir. */
  const units: Unit[] = [];
  input.lines.forEach((line, index) => {
    if (line.unavailable) return;
    const base = Math.max(0, Math.round(line.unitBaseCents));
    for (let i = 0; i < Math.max(0, Math.floor(line.qty)); i++) {
      units.push({ line: index, productId: line.productId, variantSize: line.variantSize, base });
    }
  });
  const taken = units.map(() => false);

  /* ------------------------------------------------------ 1. menü fiyatları */
  rules.forEach((rule, r) => {
    if (rule.kind !== "BUNDLE_PRICE") return;
    const items = (rule.items ?? []).filter((item) => item.qty > 0);
    if (items.length === 0) return;

    for (;;) {
      /*
       * Bir set kur: her kalem için eşleşen, henüz kullanılmamış adetlerden
       * **en pahalısını** al. Kampanya "herhangi bir Dürüm" diyorsa müşteri
       * büyük boyu seçtiğinde de menü fiyatını görmeli; belirli bir boy
       * isteniyorsa kalem zaten o boya bağlanır.
       */
      const pick: number[] = [];
      let complete = true;
      for (const item of items) {
        const candidates = units
          .map((unit, index) => ({ unit, index }))
          .filter(({ unit, index }) => !taken[index] && !pick.includes(index) && matches(item, unit))
          .sort((a, b) => b.unit.base - a.unit.base);
        if (candidates.length < item.qty) {
          complete = false;
          break;
        }
        pick.push(...candidates.slice(0, item.qty).map(({ index }) => index));
      }
      if (!complete) break;

      const regular = pick.reduce((sum, index) => sum + units[index].base, 0);
      const saving = regular - Math.max(0, Math.round(rule.value));
      // Menü fiyatı ayrı ayrı almaktan pahalıysa set kurulmaz.
      if (saving <= 0) break;

      // Kazanç setin kalemlerine taban fiyatları oranında dağıtılır; kuruş
      // artığı son kaleme gider.
      let distributed = 0;
      pick.forEach((index, i) => {
        taken[index] = true;
        const share =
          i === pick.length - 1
            ? saving - distributed
            : Math.round((saving * units[index].base) / regular);
        distributed += share;
        lineDiscountCents[units[index].line] += share;
      });
      amounts[r] += saving;
    }
  });

  /* ------------------------------------------------- 2. ürüne özel fiyatlar */
  units.forEach((unit, index) => {
    if (taken[index]) return;
    let best = -1;
    let bestSaving = 0;
    rules.forEach((rule, r) => {
      if (rule.kind !== "PRODUCT_PRICE") return;
      if (!(rule.items ?? []).some((item) => matches(item, unit))) return;
      const saving = unit.base - Math.max(0, Math.round(rule.value));
      if (saving > bestSaving) {
        best = r;
        bestSaving = saving;
      }
    });
    if (best < 0) return;
    taken[index] = true;
    lineDiscountCents[unit.line] += bestSaving;
    amounts[best] += bestSaving;
  });

  /* ------------------------------------------------- 3. sepet indirimleri */
  const itemDiscount = lineDiscountCents.reduce((sum, cents) => sum + cents, 0);
  let remaining = Math.max(0, Math.round(input.subtotalCents) - itemDiscount);
  let cartDiscountCents = 0;
  rules.forEach((rule, r) => {
    if (isItemCampaign(rule.kind)) return;
    const discount = discountFor(rule, remaining);
    amounts[r] += discount;
    remaining -= discount;
    cartDiscountCents += discount;
  });

  const applied = rules
    .map((rule, r) => ({ rule, amountCents: amounts[r] }))
    .filter((entry) => entry.amountCents > 0);

  const codedApplied =
    input.coded !== null && applied.some((entry) => entry.rule === input.coded);

  // Geçerli bir kod ürüne bağlıysa ve o ürünler sepette yoksa, müşteri neden
  // indirim görmediğini bilmeli.
  if (input.coded && !codeRejection && !codedApplied && isItemCampaign(input.coded.kind)) {
    codeRejection = { code: "coupon_no_items" };
  }

  return {
    applied,
    lineDiscountCents,
    cartDiscountCents,
    discountCents: itemDiscount + cartDiscountCents,
    code: codedApplied && input.coded ? input.coded.code : "",
    codeRejection,
  };
}

/* ================================================================ gösterim */

/** Müşteri diline göre kampanya adı; biri boşsa ötekisi. */
export function campaignTitle(
  rule: Pick<CouponRule, "title" | "titleTr">,
  lang: "tr" | "de"
): string {
  const de = (rule.title ?? "").trim();
  const tr = (rule.titleTr ?? "").trim();
  return lang === "tr" ? tr || de : de || tr;
}

/**
 * Siparişe dondurulan kampanya satırı (`Order.discountLines`).
 *
 * İki dil de saklanır: sipariş dilinde gösterilen takip sayfası ile Almanca
 * giden e-posta aynı kaydı okuyor.
 */
export type DiscountLine = {
  code: string;
  title: string;
  titleTr: string;
  amountCents: number;
};

/** JSON sütununu okur; bozuk ya da eski kayıtta boş dizi. */
export function readDiscountLines(value: unknown): DiscountLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const amountCents = typeof row.amountCents === "number" ? row.amountCents : 0;
    if (amountCents <= 0) return [];
    return [
      {
        code: typeof row.code === "string" ? row.code : "",
        title: typeof row.title === "string" ? row.title : "",
        titleTr: typeof row.titleTr === "string" ? row.titleTr : "",
        amountCents,
      },
    ];
  });
}

/**
 * Menüde duyurulan kampanya — yalnızca otomatik ve şu an geçerli olanlar.
 *
 * Kodlu kampanyalar duyurulmaz: kod, dağıtıldığı yerde (el ilanı, Instagram)
 * paylaşılır; menüde yazsaydı kod olmasının anlamı kalmazdı.
 */
export type MenuCampaign = {
  id: string;
  kind: CouponKind;
  title: string;
  titleTr: string;
  value: number;
  maxDiscountCents: number;
  minOrderCents: number;
  fulfillment: "DELIVERY" | "PICKUP" | null;
  expiresAt: string | null;
  items: {
    productId: string;
    name: string;
    nameTr: string;
    variantSize: string;
    qty: number;
    /** Kampanyasız taban fiyat (cent); "yerine" gösterimi için. */
    regularCents: number;
  }[];
};
