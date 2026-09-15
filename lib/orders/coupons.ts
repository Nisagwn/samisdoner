import { Prisma, type CouponKind, type Fulfillment } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeCouponCode, type CouponRule } from "./coupon";

/**
 * Kuponların veri katmanı.
 *
 * Kuralın kendisi `lib/orders/coupon.ts` içinde ve saf: orada veritabanı yok,
 * çünkü o dosyanın parçaları ödeme ekranında istemcide de çalışıyor. Burada
 * yalnızca okuma ve yazma var — sipariş akışının okuduğu tek fonksiyon
 * `findCouponRule`, geri kalanı panelin.
 *
 * Aynı ayrım teslimat bölgelerinde de var (`availability.ts` okur,
 * `zones.ts` yazar); kural tek yerde kalsın diye.
 */

/* ------------------------------------------------------- sipariş akışı */

/**
 * Kodun kuralını okur; yoksa null.
 *
 * Önbelleklenmez, bilinçli olarak: satır `redeemedCount` ile birlikte okunuyor
 * ve o sayı her siparişte değişiyor — bayat bir sayaç, tükenmiş bir kampanyayı
 * beş dakika daha açık gösterir. Kuponlar zaten her sepet yenilemesinde değil,
 * yalnızca müşteri kod girdiğinde okunuyor.
 */
export async function findCouponRule(code: string): Promise<CouponRule | null> {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;

  const row = await prisma.coupon.findUnique({ where: { code: normalized } });
  return row ? toRule(row) : null;
}

function toRule(row: CouponRecordRow): CouponRule {
  return {
    code: row.code,
    kind: row.kind,
    value: row.value,
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

/**
 * Kuponun bu siparişte kullanıldığını yazar.
 *
 * Sayaç **koşullu** artırılır: sınır dolmuşsa UPDATE hiçbir satıra dokunmaz ve
 * fonksiyon `false` döner. Aynı kuponla eşzamanlı gelen iki sipariş arasındaki
 * yarış böylece veritabanı seviyesinde çözülür; uygulama katmanında "önce oku,
 * sonra yaz" yapan bir kontrol bu yarışı kaybeder ve 50 kullanımlık kampanya
 * 52 kez kullanılabilirdi.
 *
 * Sipariş işleminin **içinde** çağrılır: kupon yazılamazsa sipariş de yazılmaz,
 * dolayısıyla indirimi uygulanmış ama kullanımı sayılmamış bir sipariş oluşamaz.
 */
export async function redeemCoupon(
  tx: Prisma.TransactionClient,
  input: { code: string; orderId: string; amountCents: number }
): Promise<boolean> {
  const code = normalizeCouponCode(input.code);
  if (!code || input.amountCents <= 0) return false;

  const coupon = await tx.coupon.findUnique({
    where: { code },
    select: { id: true, maxRedemptions: true },
  });
  if (!coupon) return false;

  const updated = await tx.coupon.updateMany({
    where: {
      id: coupon.id,
      active: true,
      // Sınırsız kuponda koşul her zaman doğrudur; sınırlıda sayaç tavana
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

type CouponRecordRow = {
  id: string;
  code: string;
  kind: CouponKind;
  value: number;
  minOrderCents: number;
  maxDiscountCents: number;
  fulfillment: Fulfillment | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  maxRedemptions: number;
  redeemedCount: number;
  active: boolean;
  createdAt: Date;
};

export type CouponRecord = CouponRecordRow;

export type CouponInput = {
  code: string;
  kind: CouponKind;
  value: number;
  minOrderCents: number;
  maxDiscountCents: number;
  fulfillment: Fulfillment | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  maxRedemptions: number;
  active: boolean;
};

/**
 * Panelde gösterilen liste.
 *
 * Sıra: önce aktifler, sonra en yeni. Kapatılmış kampanyalar listenin altına
 * iner ama **silinmez** — geçmiş siparişler kuponun kaydına bakıyor.
 */
export async function listCoupons(): Promise<CouponRecord[]> {
  return prisma.coupon.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });
}

export async function createCoupon(input: CouponInput): Promise<CouponRecord> {
  return prisma.coupon.create({
    data: { ...input, code: normalizeCouponCode(input.code) },
  });
}

/**
 * Kuponu günceller; kayıt yoksa null.
 *
 * `redeemedCount` bilinçli olarak güncellenemez: sayaç kullanımın kendisinden
 * doğar (`redeemCoupon`), panelden elle düzeltilmesi "kaç kez kullanıldı"
 * sorusunun cevabını uydurulabilir kılardı.
 */
export async function updateCoupon(
  id: string,
  patch: Partial<CouponInput>
): Promise<CouponRecord | null> {
  try {
    return await prisma.coupon.update({
      where: { id },
      data: {
        ...patch,
        ...(patch.code !== undefined ? { code: normalizeCouponCode(patch.code) } : {}),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return null;
    }
    throw error;
  }
}

/**
 * Kuponu kaldırır — **kullanılmamışsa siler, kullanılmışsa pasifleştirir.**
 *
 * Kullanılmış bir kuponu silmek, ona bağlı sipariş kayıtlarını da götürürdü
 * (`CouponRedemption` üzerinde Cascade) ve "bu siparişte hangi kampanya
 * uygulandı" sorusu cevapsız kalırdı. Kupon kayıtları da siparişler gibi
 * muhasebe belgesinin parçası.
 *
 * Panelde ikisi de aynı düğmedir: işletmecinin istediği şey "bu kod artık
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
  // veri); ikisinden **herhangi biri** doluysa kupon kullanılmış sayılır.
  const used = coupon.redeemedCount > 0 || coupon._count.redemptions > 0;

  if (used) {
    await prisma.coupon.update({ where: { id }, data: { active: false } });
    return { kind: "deactivated" };
  }

  await prisma.coupon.delete({ where: { id } });
  return { kind: "deleted" };
}
