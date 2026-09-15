import { Prisma, type CouponKind, type Fulfillment } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CACHE_KEYS, cached, invalidate } from "@/lib/cache";
import { getCatalog, isVisible } from "@/lib/admin/store";
import { effectivePrice } from "@/lib/admin/types";
import { toCents } from "@/lib/money";
import {
  couponEligibility,
  normalizeCouponCode,
  type CampaignItem,
  type CouponRule,
} from "./coupon";
import type { MenuCampaign } from "./campaign";
import type { CouponBody } from "./schema";

/**
 * Kampanyaların veri katmanı.
 *
 * Kuralın kendisi `lib/orders/coupon.ts` ve `campaign.ts` içinde ve saf: orada
 * veritabanı yok, çünkü o dosyaların parçaları ödeme ekranında istemcide de
 * çalışıyor. Burada yalnızca okuma ve yazma var — sipariş akışının okuduğu
 * fonksiyonlar `findCouponRule` ve `listAutomaticRules`, menünün okuduğu
 * `getMenuCampaigns`, geri kalanı panelin.
 *
 * Aynı ayrım teslimat bölgelerinde de var (`availability.ts` okur,
 * `zones.ts` yazar); kural tek yerde kalsın diye.
 */

/* ------------------------------------------------------------- satırlar */

type CouponRow = Prisma.CouponGetPayload<object>;

/** Panelin ve kural çeviricisinin gördüğü satır: `items` ayrıştırılmış. */
export type CouponRecord = Omit<CouponRow, "items"> & { items: CampaignItem[] };

/**
 * `items` JSON sütununu okur.
 *
 * Yazarken doğrulanıyor, ama sütun elle düzeltilebilir; bozuk bir kalem
 * sipariş hesabını düşürmesin, yalnızca sayılmasın.
 */
function parseItems(value: unknown): CampaignItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.productId !== "string" || row.productId === "") return [];
    const qty = typeof row.qty === "number" && row.qty >= 1 ? Math.floor(row.qty) : 1;
    const variantSize = typeof row.variantSize === "string" && row.variantSize ? row.variantSize : undefined;
    return [{ productId: row.productId, qty, ...(variantSize ? { variantSize } : {}) }];
  });
}

function toRecord(row: CouponRow): CouponRecord {
  return { ...row, items: parseItems(row.items) };
}

function toRule(row: CouponRecord): CouponRule {
  return {
    id: row.id,
    code: row.code ?? "",
    kind: row.kind,
    title: row.title,
    titleTr: row.titleTr,
    value: row.value,
    items: row.items,
    minOrderCents: row.minOrderCents,
    maxDiscountCents: row.maxDiscountCents,
    fulfillment: row.fulfillment,
    startsAt: row.startsAt,
    expiresAt: row.expiresAt,
    maxRedemptions: row.maxRedemptions,
    redeemedCount: row.redeemedCount,
    active: row.active,
  };
}

/* ------------------------------------------------------- sipariş akışı */

/**
 * Kodun kuralını okur; yoksa null.
 *
 * Önbelleklenmez, bilinçli olarak: satır `redeemedCount` ile birlikte okunuyor
 * ve o sayı her siparişte değişiyor — bayat bir sayaç, tükenmiş bir kampanyayı
 * beş dakika daha açık gösterir. Kodlar zaten her sepet yenilemesinde değil,
 * yalnızca müşteri kod girdiğinde okunuyor.
 */
export async function findCouponRule(code: string): Promise<CouponRule | null> {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;

  const row = await prisma.coupon.findUnique({ where: { code: normalized } });
  return row ? toRule(toRecord(row)) : null;
}

/** Önbellekte JSON olarak durabilen kural: tarihler metin. */
type StoredRule = Omit<CouponRule, "startsAt" | "expiresAt"> & {
  startsAt: string | null;
  expiresAt: string | null;
};

/**
 * Açık otomatik (kodsuz) kampanyalar.
 *
 * Kodlu kuraldan farklı olarak **önbelleklenir**: sepet çekmecesi her
 * değişiklikte teklif istiyor ve her teklif bu listeyi okuyor. Kısa ömrün
 * bedeli bayat bir kullanım sayacı — ama sınır zaten sipariş yazılırken
 * koşullu UPDATE ile uygulanıyor (`redeemCoupon`), yani bayat sayaç en fazla
 * "kampanya bitti" diye reddedilen bir sipariş denemesi doğurur, fazladan
 * indirim değil. Tarihler de burada değil, her okumada `couponEligibility`
 * içinde denetlenir.
 */
export async function listAutomaticRules(): Promise<CouponRule[]> {
  const stored = await cached<StoredRule[]>(CACHE_KEYS.campaigns, 60, async () => {
    const rows = await prisma.coupon.findMany({
      where: { code: null, active: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => {
      const rule = toRule(toRecord(row));
      return {
        ...rule,
        startsAt: rule.startsAt?.toISOString() ?? null,
        expiresAt: rule.expiresAt?.toISOString() ?? null,
      };
    });
  });

  return stored.map((rule) => ({
    ...rule,
    startsAt: rule.startsAt ? new Date(rule.startsAt) : null,
    expiresAt: rule.expiresAt ? new Date(rule.expiresAt) : null,
  }));
}

/**
 * Menüde duyurulacak kampanyalar.
 *
 * Yalnızca şu an gerçekten uygulanabilecek olanlar: açık, başlamış, süresi ve
 * hakkı dolmamış. Asgari tutar ve teslim biçimi engel sayılmaz — onlar
 * duyuruda koşul olarak yazılır ("25 € üzeri", "yalnızca gel-al").
 *
 * Ürüne bağlı kampanyanın ürünü menüden kalktıysa kampanya da duyurulmaz:
 * sepete eklenemeyecek bir ürünün fiyatını ilan etmek, PAngV açısından da
 * müşteri açısından da yanıltıcı olurdu. Kampanya fiyatı normal fiyattan
 * ucuz değilse de duyurulmaz — ortada bir fırsat yok.
 */
export async function getMenuCampaigns(now: Date = new Date()): Promise<MenuCampaign[]> {
  const [rules, catalog] = await Promise.all([listAutomaticRules(), getCatalog()]);

  return rules.flatMap((rule): MenuCampaign[] => {
    const blocked = couponEligibility(rule, {
      subtotalCents: Number.MAX_SAFE_INTEGER,
      fulfillment: rule.fulfillment ?? "DELIVERY",
      now,
    });
    if (blocked) return [];

    const resolved = (rule.items ?? []).map((item) => {
      const product = catalog.products.find((candidate) => candidate.id === item.productId);
      if (!product || !isVisible(product)) return null;
      const variant = item.variantSize
        ? product.variants.find((candidate) => candidate.size === item.variantSize)
        : undefined;
      if (item.variantSize && !variant) return null;
      return {
        productId: product.id,
        name: product.name,
        nameTr: product.nameTr,
        variantSize: item.variantSize ?? "",
        qty: item.qty,
        regularCents: toCents(variant ? variant.price : effectivePrice(product)),
      };
    });

    let items: MenuCampaign["items"] = [];
    if (rule.kind === "PRODUCT_PRICE") {
      items = resolved.flatMap((item) => (item && item.regularCents > rule.value ? [item] : []));
      if (items.length === 0) return [];
    } else if (rule.kind === "BUNDLE_PRICE") {
      if (resolved.some((item) => item === null)) return [];
      items = resolved as MenuCampaign["items"];
      const regular = items.reduce((sum, item) => sum + item.regularCents * item.qty, 0);
      if (items.length === 0 || regular <= rule.value) return [];
    }

    return [
      {
        id: rule.id ?? "",
        kind: rule.kind,
        title: rule.title ?? "",
        titleTr: rule.titleTr ?? "",
        value: rule.value,
        maxDiscountCents: rule.maxDiscountCents,
        minOrderCents: rule.minOrderCents,
        fulfillment: rule.fulfillment,
        expiresAt: rule.expiresAt?.toISOString() ?? null,
        items,
      },
    ];
  });
}

/**
 * Kampanyanın bu siparişte kullanıldığını yazar.
 *
 * Sayaç **koşullu** artırılır: sınır dolmuşsa UPDATE hiçbir satıra dokunmaz ve
 * fonksiyon `false` döner. Aynı kampanyayla eşzamanlı gelen iki sipariş
 * arasındaki yarış böylece veritabanı seviyesinde çözülür; uygulama katmanında
 * "önce oku, sonra yaz" yapan bir kontrol bu yarışı kaybeder ve 50 kullanımlık
 * kampanya 52 kez kullanılabilirdi.
 *
 * Sipariş işleminin **içinde** çağrılır: kullanım yazılamazsa sipariş de
 * yazılmaz, dolayısıyla indirimi uygulanmış ama kullanımı sayılmamış bir
 * sipariş oluşamaz.
 */
export async function redeemCoupon(
  tx: Prisma.TransactionClient,
  input: { couponId: string; orderId: string; amountCents: number }
): Promise<boolean> {
  if (!input.couponId || input.amountCents <= 0) return false;

  const coupon = await tx.coupon.findUnique({
    where: { id: input.couponId },
    select: { id: true, maxRedemptions: true },
  });
  if (!coupon) return false;

  const updated = await tx.coupon.updateMany({
    where: {
      id: coupon.id,
      active: true,
      // Sınırsız kampanyada koşul her zaman doğrudur; sınırlıda sayaç tavana
      // dayandığı anda UPDATE hiçbir satır bulamaz.
      ...(coupon.maxRedemptions > 0 ? { redeemedCount: { lt: coupon.maxRedemptions } } : {}),
    },
    data: { redeemedCount: { increment: 1 } },
  });
  if (updated.count === 0) return false;

  await tx.couponRedemption.create({
    data: { couponId: coupon.id, orderId: input.orderId, amountCents: input.amountCents },
  });
  return true;
}

/* ---------------------------------------------------------------- panel */

export type CouponInput = {
  /** null = otomatik kampanya. */
  code: string | null;
  kind: CouponKind;
  title: string;
  titleTr: string;
  value: number;
  items: CampaignItem[];
  minOrderCents: number;
  maxDiscountCents: number;
  fulfillment: Fulfillment | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  maxRedemptions: number;
  active: boolean;
};

/**
 * Doğrulanmış istek gövdesini kayda çevirir.
 *
 * Türe ait olmayan alanlar burada sıfırlanır: sepet indiriminde ürün listesi,
 * sabit indirimde tavan, ürüne özel fiyatta adet saklanmaz. Saklansaydı panel
 * "hem 5 € indirim hem 3 € tavan" gibi okunamayan bir kayıt gösterirdi.
 */
export function couponInputFromBody(body: CouponBody): CouponInput {
  const itemKind = body.kind === "PRODUCT_PRICE" || body.kind === "BUNDLE_PRICE";
  return {
    code: body.code ? normalizeCouponCode(body.code) : null,
    kind: body.kind,
    title: body.title,
    titleTr: body.titleTr,
    value: body.value,
    items: itemKind
      ? body.items.map((item) => ({
          productId: item.productId,
          ...(item.variantSize ? { variantSize: item.variantSize } : {}),
          qty: body.kind === "BUNDLE_PRICE" ? item.qty : 1,
        }))
      : [],
    minOrderCents: body.minOrderCents,
    maxDiscountCents: body.kind === "PERCENT" ? body.maxDiscountCents : 0,
    fulfillment: body.fulfillment,
    startsAt: body.startsAt ? new Date(body.startsAt) : null,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    maxRedemptions: body.maxRedemptions,
    active: body.active,
  };
}

/**
 * Kampanyanın ürünleri katalogda var mı; sorun varsa panelde gösterilecek cümle.
 *
 * Silinmiş bir ürüne ya da artık olmayan bir boya bağlı kampanya hata vermez,
 * yalnızca **hiçbir sepette tutmaz** — işletmeci kampanyanın açık olduğunu
 * sanır, müşteri indirimi hiç görmez. Kayıt anında söylemek bu sessizliği
 * kırar.
 */
export async function validateCampaignItems(items: CampaignItem[]): Promise<string | null> {
  if (items.length === 0) return null;
  const { products } = await getCatalog();
  for (const item of items) {
    const product = products.find((candidate) => candidate.id === item.productId);
    if (!product) return "Seçilen ürünlerden biri artık menüde yok.";
    if (item.variantSize && !product.variants.some((variant) => variant.size === item.variantSize)) {
      return `"${product.name}" ürününde "${item.variantSize}" boyu yok.`;
    }
  }
  return null;
}

function toData(input: CouponInput) {
  return { ...input, items: input.items as unknown as Prisma.InputJsonValue };
}

/**
 * Panelde gösterilen liste.
 *
 * Sıra: önce aktifler, sonra en yeni. Kapatılmış kampanyalar listenin altına
 * iner ama **silinmez** — geçmiş siparişler kaydına bakıyor.
 */
export async function listCoupons(): Promise<CouponRecord[]> {
  const rows = await prisma.coupon.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toRecord);
}

export async function createCoupon(input: CouponInput): Promise<CouponRecord> {
  const row = await prisma.coupon.create({ data: toData(input) });
  await invalidate(CACHE_KEYS.campaigns);
  return toRecord(row);
}

/**
 * Kampanyayı günceller; kayıt yoksa null.
 *
 * `redeemedCount` bilinçli olarak güncellenemez: sayaç kullanımın kendisinden
 * doğar (`redeemCoupon`), panelden elle düzeltilmesi "kaç kez kullanıldı"
 * sorusunun cevabını uydurulabilir kılardı.
 */
export async function updateCoupon(id: string, input: CouponInput): Promise<CouponRecord | null> {
  try {
    const row = await prisma.coupon.update({ where: { id }, data: toData(input) });
    await invalidate(CACHE_KEYS.campaigns);
    return toRecord(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return null;
    }
    throw error;
  }
}

/**
 * Kampanyayı kaldırır — **kullanılmamışsa siler, kullanılmışsa pasifleştirir.**
 *
 * Kullanılmış bir kampanyayı silmek, ona bağlı sipariş kayıtlarını da
 * götürürdü (`CouponRedemption` üzerinde Cascade) ve "bu siparişte hangi
 * kampanya uygulandı" sorusu cevapsız kalırdı. Kampanya kayıtları da
 * siparişler gibi muhasebe belgesinin parçası.
 *
 * Panelde ikisi de aynı düğmedir: işletmecinin istediği şey "bu kampanya artık
 * çalışmasın"; hangi yolun seçildiği teknik bir ayrıntı ve dönen değerde
 * bildirilir.
 */
export async function retireCoupon(
  id: string
): Promise<{ kind: "deleted" } | { kind: "deactivated" } | null> {
  const coupon = await prisma.coupon.findUnique({
    where: { id },
    select: { id: true, redeemedCount: true, _count: { select: { redemptions: true } } },
  });
  if (!coupon) return null;

  // Sayaç ile kayıt sayısı teorik olarak ayrışabilir (elle müdahale, eski
  // veri); ikisinden **herhangi biri** doluysa kampanya kullanılmış sayılır.
  const used = coupon.redeemedCount > 0 || coupon._count.redemptions > 0;

  if (used) {
    await prisma.coupon.update({ where: { id }, data: { active: false } });
  } else {
    await prisma.coupon.delete({ where: { id } });
  }
  await invalidate(CACHE_KEYS.campaigns);
  return { kind: used ? "deactivated" : "deleted" };
}
