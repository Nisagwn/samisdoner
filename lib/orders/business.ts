import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CACHE_KEYS, invalidate } from "@/lib/cache";

/**
 * İşletme ayarlarının veri katmanı — panel tarafı.
 *
 * Sipariş akışı bu değerleri `availability.ts` üzerinden okur; burada yalnızca
 * panelin ihtiyaç duyduğu okuma ve yazma işlemleri var. İkisi de aynı satırlara
 * bakar, kural tek yerde kalır.
 *
 * Neden katalog deposundan (`lib/admin/store.ts`) ayrı: orası menüyü ve
 * fiyatları yönetir, burası dükkânın açık olup olmadığını. İkisi aynı
 * `Settings` satırını paylaşsa da farklı sorulara cevap verirler ve farklı
 * ekranlardan değişirler; tek bir tipte birleştirmek, menü fiyatı değiştiren
 * bir isteğin yanlışlıkla sipariş alımını kapatabilmesi demek olurdu.
 *
 * Bu ekran gelene kadar `orderingEnabled`, `deliveryEnabled`, `pickupEnabled`
 * ve `prepMinutes` şemada vardı ama **hiçbir arayüzden değiştirilemiyordu**:
 * acil durumda sipariş alımını durdurmanın yolu veritabanına elle girmekti.
 */

export type BusinessSettings = {
  /** Acil kapatma anahtarı. Kapalıyken hiçbir sipariş kabul edilmez. */
  orderingEnabled: boolean;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  /** Ortalama hazırlık süresi (dk); gel-al siparişinde müşteriye bu gösterilir. */
  prepMinutes: number;
};

export type OpeningHourRow = {
  id: string;
  /** 0 = Pazar … 6 = Cumartesi (JS getDay ile aynı). */
  weekday: number;
  /** Gün başından itibaren dakika (11:00 → 660). */
  openMinute: number;
  closeMinute: number;
};

export type ClosureRow = {
  id: string;
  /** "2026-12-24" — saat bileşeni yok. */
  date: string;
  reason: string;
};

const DEFAULTS: BusinessSettings = {
  orderingEnabled: true,
  deliveryEnabled: true,
  pickupEnabled: false,
  prepMinutes: 30,
};

/* ------------------------------------------------------------- ayarlar */

export async function getBusinessSettings(): Promise<BusinessSettings> {
  const row = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!row) return DEFAULTS;
  return {
    orderingEnabled: row.orderingEnabled,
    deliveryEnabled: row.deliveryEnabled,
    pickupEnabled: row.pickupEnabled,
    prepMinutes: row.prepMinutes,
  };
}

export async function updateBusinessSettings(
  patch: Partial<BusinessSettings>
): Promise<BusinessSettings> {
  const data: Prisma.SettingsUncheckedUpdateInput = {};
  if (patch.orderingEnabled !== undefined) data.orderingEnabled = patch.orderingEnabled;
  if (patch.deliveryEnabled !== undefined) data.deliveryEnabled = patch.deliveryEnabled;
  if (patch.pickupEnabled !== undefined) data.pickupEnabled = patch.pickupEnabled;
  if (patch.prepMinutes !== undefined) data.prepMinutes = patch.prepMinutes;

  // Ayar satırı henüz yoksa (yeni kurulum) varsayılanlarla oluşturulur;
  // panelin ilk kaydında "kayıt yok" hatası almak anlamsız olurdu.
  const row = await prisma.settings.upsert({
    where: { id: 1 },
    create: { id: 1, ...DEFAULTS, ...patch },
    update: data,
  });

  // Acil kapatma anahtarı burada: önbellek düşmezse "sipariş almayı durdur"
  // düğmesi dakikalarca etkisiz kalır ve müşteri sipariş vermeye devam eder.
  await invalidate(CACHE_KEYS.orderSettings, CACHE_KEYS.catalog);

  return {
    orderingEnabled: row.orderingEnabled,
    deliveryEnabled: row.deliveryEnabled,
    pickupEnabled: row.pickupEnabled,
    prepMinutes: row.prepMinutes,
  };
}

/* ------------------------------------------------------- çalışma saatleri */

export async function listOpeningHours(): Promise<OpeningHourRow[]> {
  return prisma.openingHour.findMany({
    orderBy: [{ weekday: "asc" }, { openMinute: "asc" }],
    select: { id: true, weekday: true, openMinute: true, closeMinute: true },
  });
}

/**
 * Haftalık takvimi topluca değiştirir.
 *
 * Satır satır güncelleme yerine "sil ve yaz": bir gün tamamen kapatıldığında
 * (o güne ait tüm aralıklar silindiğinde) tek tek hangi satırın gideceğini
 * hesaplamak, arayüzde satır kimliği taşımayı zorunlu kılardı. İşlem bir
 * transaction içinde döner; yarım kalmış bir takvim oluşamaz.
 */
export async function replaceOpeningHours(
  rows: { weekday: number; openMinute: number; closeMinute: number }[]
): Promise<OpeningHourRow[]> {
  await prisma.$transaction([
    prisma.openingHour.deleteMany({}),
    prisma.openingHour.createMany({ data: rows }),
  ]);
  await invalidate(CACHE_KEYS.openingHours);
  return listOpeningHours();
}

/* ------------------------------------------------------------ tatil günü */

/** Bugünden itibaren geçerli kapalı günler; geçmiş tarihler listeyi şişirmesin. */
export async function listClosures(): Promise<ClosureRow[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const rows = await prisma.specialClosure.findMany({
    where: { date: { gte: today } },
    orderBy: { date: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    date: row.date.toISOString().slice(0, 10),
    reason: row.reason,
  }));
}

/** Aynı gün ikinci kez eklenirse sebebi güncellenir, hata verilmez. */
export async function upsertClosure(date: string, reason: string): Promise<ClosureRow> {
  const day = new Date(`${date}T00:00:00.000Z`);
  const row = await prisma.specialClosure.upsert({
    where: { date: day },
    create: { date: day, reason },
    update: { reason },
  });
  await invalidate(CACHE_KEYS.closures);
  return { id: row.id, date: row.date.toISOString().slice(0, 10), reason: row.reason };
}

export async function deleteClosure(id: string): Promise<boolean> {
  try {
    await prisma.specialClosure.delete({ where: { id } });
    await invalidate(CACHE_KEYS.closures);
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return false;
    }
    throw error;
  }
}
