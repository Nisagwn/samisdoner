import { prisma } from "@/lib/db";

/**
 * Damga kartı.
 *
 * Almanya'da hemen her döner dükkânının tezgâhında duran kâğıt kartın
 * ("Dönerpass", 10–12 damga = bir döner bedava) dijital karşılığı. Lieferando
 * aynı fikri "Stempelkarte" adıyla, beş damgada bir indirim kuponu olarak
 * uyguluyor. Dijitalin kâğıda karşı tek üstünlüğü kaybolmaması — o yüzden
 * kurallar birebir aynı tutuldu, karmaşıklaştırılmadı.
 *
 * ── Damgalar sayılmaz, TÜRETİLİR ────────────────────────────────────────
 *
 * Bir "damga sayacı" sütunu **yok** ve bu bilinçli. Sayaç olsaydı, onu artıran
 * kodun sipariş yaşam döngüsünün içine girmesi gerekirdi ve o an bir sınıf
 * hata doğardı: iptal edilen siparişin damgası nasıl geri alınır, sayaç bir
 * çökme yüzünden artmazsa nasıl düzeltilir, iki kez artarsa nasıl fark edilir.
 *
 * Bunun yerine damga sayısı her seferinde hesaplanır: **teslim edilmiş sipariş
 * sayısı eksi daha önce ödüle çevrilenler**. `LoyaltyReward.throughOrderCount`,
 * ödül verildiği andaki kümülatif sipariş sayısını tutar; aynı siparişler
 * ikinci kez ödüle dönüşemez. İptal edilen bir sipariş sayıma zaten hiç
 * girmez, düzeltme gerekmez.
 *
 * ── Ödül neden kod, neden otomatik indirim değil ─────────────────────────
 *
 * Ödül, sepetin toplamına kendiliğinden inen bir indirim değil, tezgâhta ya da
 * telefonda söylenen bir koddur. Sebep pratik: bu kart kasadaki kâğıdın yerini
 * alıyor ve ödül çoğu zaman "bir döner bedava" gibi tutarı siparişe göre
 * değişen bir şey. Personel kodu panele girer, ödül kullanılmış işaretlenir ve
 * kod bir daha çalışmaz.
 */

/** Bir ödül için gereken damga sayısı. Dönerpass'lardaki yaygın değer. */
export const STAMPS_PER_REWARD = 10;

/** Ödülün ömrü. Süresiz bir ödül, defterde kapanmayan bir borçtur. */
const REWARD_TTL_DAYS = 90;

/**
 * Damga sayan sipariş durumları.
 *
 * Yalnızca **gerçekten teslim edilmiş** sipariş damga kazandırır. Ödemesi
 * alınmış ama mutfakta duran bir sipariş damga verseydi, sipariş sonradan
 * iptal edildiğinde geri alınması gereken bir damga kalırdı.
 */
const STAMP_STATUSES = ["DELIVERED", "PICKED_UP"] as const;

export type StampCard = {
  /** Karttaki dolu damga sayısı (0 … STAMPS_PER_REWARD - 1). */
  stamps: number;
  /** Bir sonraki ödüle kaç sipariş kaldı. */
  remaining: number;
  perReward: number;
  /** Kullanılmamış, süresi geçmemiş ödüller. */
  rewards: {
    code: string;
    issuedAt: string;
    expiresAt: string;
  }[];
};

/**
 * Kartın aritmetiği — veritabanısız, bu yüzden sınanabilir.
 *
 * `delivered` teslim edilmiş toplam sipariş sayısı, `consumed` ise daha önce
 * ödüle çevrilmiş olanların sayısı (`throughOrderCount`'ların en büyüğü).
 * İkisinin farkı karttaki ham damga sayısıdır; bundan kaç tam kart çıktığı ve
 * geriye kaç damga kaldığı burada hesaplanır.
 *
 * Fonksiyonun ayrı durmasının sebebi test değil, **doğruluğun görülebilir
 * olması**: "kaç ödül açılmalı" sorusu bir veritabanı çağrısının içine
 * gömüldüğünde, yirmi beş teslimatı olan bir müşteride iki ödül yerine bir
 * tane açan bir hata gözle fark edilmez.
 */
export function stampMath(
  delivered: number,
  consumed: number,
  perReward: number = STAMPS_PER_REWARD
): { stamps: number; rewardsToIssue: number; throughAfter: number } {
  // Negatif fark mümkün olmamalı ama bir veri düzeltmesi sonrası olabilir;
  // eksi damga göstermektense sıfırda durmak doğru.
  const raw = Math.max(0, delivered - consumed);
  const rewardsToIssue = Math.floor(raw / perReward);

  return {
    stamps: raw % perReward,
    rewardsToIssue,
    throughAfter: consumed + rewardsToIssue * perReward,
  };
}

/** "SD-7K4M-2QX9" — tezgâhta okunacağı için karışan harfler alfabede yok. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]);
  return `SD-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/**
 * Kartın bugünkü hâli; hak edilmiş ödül varsa onu da açar.
 *
 * Ödül **okuma sırasında** açılıyor ve bu, sipariş akışına hiç dokunmadan
 * çalışmasının bedeli: müşteri hesabına bakmadan ödül kaydı oluşmaz. Pratikte
 * fark etmez — ödülün varlığı zaten yalnızca hesapta görünüyor ve kod da
 * oradan okunuyor. Kazanılan hak kaybolmaz, yalnızca kaydı geç yazılır.
 */
export async function getStampCard(customerId: string): Promise<StampCard> {
  const now = new Date();

  const [delivered, rewards] = await Promise.all([
    prisma.order.count({
      where: { customerId, status: { in: [...STAMP_STATUSES] } },
    }),
    prisma.loyaltyReward.findMany({
      where: { customerId },
      orderBy: { issuedAt: "desc" },
      select: {
        code: true,
        issuedAt: true,
        expiresAt: true,
        redeemedAt: true,
        throughOrderCount: true,
      },
    }),
  ]);

  // Daha önce ödüle çevrilmiş en yüksek sipariş sayısı; damgalar bunun üstünden
  // sayılır. Kullanılmış ya da süresi geçmiş ödüller de sayılır: damga
  // harcanmıştır, ödülün sonradan ne olduğu damgayı geri getirmez.
  const consumed = rewards.reduce(
    (max, reward) => Math.max(max, reward.throughOrderCount),
    0
  );

  const math = stampMath(delivered, consumed);
  const issued: typeof rewards = [];

  /*
   * Birden fazla ödül birikmiş olabilir: hesabına aylardır bakmayan bir
   * müşteride yirmi beş teslimat, iki ödül ve beş damga eder. Döngü tam da
   * bunun için — tek bir ödül açıp gerisini yutmak, hak edilmiş bir şeyi
   * sessizce silmek olurdu.
   */
  let through = consumed;
  for (let i = 0; i < math.rewardsToIssue; i++) {
    through += STAMPS_PER_REWARD;

    const reward = await prisma.loyaltyReward.create({
      data: {
        customerId,
        code: newCode(),
        throughOrderCount: through,
        stampsUsed: STAMPS_PER_REWARD,
        expiresAt: new Date(now.getTime() + REWARD_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
      select: {
        code: true,
        issuedAt: true,
        expiresAt: true,
        redeemedAt: true,
        throughOrderCount: true,
      },
    });
    issued.push(reward);
  }

  const open = [...issued, ...rewards].filter(
    (reward) => reward.redeemedAt === null && reward.expiresAt > now
  );

  return {
    stamps: math.stamps,
    remaining: STAMPS_PER_REWARD - math.stamps,
    perReward: STAMPS_PER_REWARD,
    rewards: open.map((reward) => ({
      code: reward.code,
      issuedAt: reward.issuedAt.toISOString(),
      expiresAt: reward.expiresAt.toISOString(),
    })),
  };
}

export type RedeemResult =
  | { ok: true; customerName: string }
  | { ok: false; reason: "not_found" | "already_redeemed" | "expired" };

/**
 * Ödülü kasada kullanılmış işaretler — panelden çağrılır.
 *
 * Kullanma işlemi `redeemedAt: null` koşuluyla tek sorguda yapılır: aynı kodu
 * iki farklı personel aynı anda girerse ikisi de "kullanılmamış" görüp ikisi
 * de bedava döner veremesin. Kaybeden taraf "zaten kullanılmış" cevabı alır.
 */
export async function redeemReward(code: string, actor: string): Promise<RedeemResult> {
  const normalized = code.trim().toUpperCase();

  const reward = await prisma.loyaltyReward.findUnique({
    where: { code: normalized },
    select: {
      id: true,
      redeemedAt: true,
      expiresAt: true,
      customer: { select: { name: true, email: true } },
    },
  });
  if (!reward) return { ok: false, reason: "not_found" };
  if (reward.redeemedAt) return { ok: false, reason: "already_redeemed" };
  if (reward.expiresAt < new Date()) return { ok: false, reason: "expired" };

  const claimed = await prisma.loyaltyReward.updateMany({
    where: { id: reward.id, redeemedAt: null },
    data: { redeemedAt: new Date(), redeemedBy: actor },
  });
  if (claimed.count === 0) return { ok: false, reason: "already_redeemed" };

  return { ok: true, customerName: reward.customer.name || reward.customer.email };
}
