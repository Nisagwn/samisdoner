import { prisma } from "@/lib/db";

/**
 * Kaba kuvvet kısıtlayıcısı — veritabanı destekli.
 *
 * Neden bellekte değil: bellekteki bir sayaç sunucu her yeniden başladığında
 * sıfırlanır ve çok örnekli (serverless) dağıtımda hiç çalışmaz — her istek
 * başka bir örneğe düşer, hiçbiri diğerinin sayacını görmez. Yani bellekteki
 * kısıtlayıcı yalnızca tek örnekli geliştirme ortamında bir şey yapar; canlıda
 * hiçbir şey yapmaz. `LoginAttempt` tablosu tam bu yüzden şemada duruyor.
 *
 * İki ayrı anahtar üzerinden sayılır:
 *  - IP: tek bir kaynaktan çok sayıda hesabın denenmesini (kullanıcı adı
 *    püskürtme) yakalar.
 *  - E-posta: dağıtık IP'lerden tek bir hesaba yüklenmeyi yakalar.
 * Yalnızca IP'ye bakmak ikincisini, yalnızca e-postaya bakmak birincisini
 * kaçırır.
 */

/** Sayacın sıfırlandığı süre. Bu kadar sessizlikten sonra defter temizlenir. */
const WINDOW_MS = 15 * 60 * 1000;
/** Bu sayıdan sonra engel devreye girer. */
const MAX_ATTEMPTS = 8;
/** Engelin süresi. */
const BLOCK_MS = 15 * 60 * 1000;

export type ThrottleState =
  | { blocked: false }
  | { blocked: true; retryAfterSeconds: number };

/**
 * İstemci adresini başlıklardan seçer — **saf işlev**, bu yüzden sınanabilir.
 *
 * Sıra önemli ve eskiden yanlıştı. Önceki sürüm `X-Forwarded-For`'un İLK
 * değerini alıyordu; o değer istemcinin kendi yazdığı bir değer olabilir:
 *
 *   Caddy gelen `X-Forwarded-For` başlığını SİLMEZ, kendi gördüğü adresi
 *   sonuna EKLER (`trusted_proxies` ayarlanmadıkça — bkz. deploy/Caddyfile,
 *   orada da yok). Yani saldırgan `X-Forwarded-For: 1.2.3.4` yollarsa
 *   uygulamaya "1.2.3.4, <gerçek adres>" ulaşır ve ilk değer saldırganındır.
 *
 * Sonuç, her istekte başlığı değiştirerek **bütün hız sınırlarının**
 * atlanabilmesiydi: panel girişi kaba kuvveti, müşteri girişi, kayıt, parola
 * sıfırlama, sipariş oluşturma ve kupon kodu denemesi. Sayaç her seferinde
 * yeni bir anahtara yazıldığı için hiçbir eşik dolmuyordu.
 *
 * Doğru kaynak `X-Real-IP`: ters vekil bunu her istekte kendi gördüğü soket
 * adresiyle **ezer**, dolayısıyla istemci etkileyemez. Caddyfile bunu tam da
 * bu amaçla yazıyor (`header_up X-Real-IP {remote_host}`); Vercel de aynı
 * başlığı doldurur.
 *
 * `X-Forwarded-For` yalnızca yedek ve artık SON değer okunuyor: zincirin sonunu
 * bize en yakın vekil yazar, başını isteyen yazabilir.
 */
export function pickClientIp(realIp: string | null, forwardedFor: string | null): string {
  const real = realIp?.trim();
  if (real) return real;

  const chain = (forwardedFor ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (chain.length > 0) return chain[chain.length - 1];

  return "unknown";
}

/** İstekten IP adresi. */
export function clientIp(request: Request): string {
  return pickClientIp(
    request.headers.get("x-real-ip"),
    request.headers.get("x-forwarded-for")
  );
}

/**
 * Anahtarların engelli olup olmadığını söyler; **sayacı artırmaz**.
 *
 * Ayrım bilinçli: başarılı bir giriş sayacı artırmamalı. Önce bakılır, işlem
 * yapılır, yalnızca başarısızsa `recordFailure` çağrılır.
 */
export async function checkThrottle(keys: string[]): Promise<ThrottleState> {
  const now = new Date();
  const rows = await prisma.loginAttempt.findMany({
    where: { key: { in: keys }, blockedUntil: { gt: now } },
    select: { blockedUntil: true },
  });

  if (rows.length === 0) return { blocked: false };

  const until = rows.reduce(
    (latest, row) => (row.blockedUntil! > latest ? row.blockedUntil! : latest),
    rows[0].blockedUntil!
  );
  return {
    blocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000)),
  };
}

/**
 * Başarısız denemeyi yazar; eşik aşılırsa engeli kurar.
 *
 * Pencere dolmuşsa sayaç sıfırlanır — bu yüzden `upsert` yerine önce okuma
 * yapılır. Yarış hâlinde en kötü ihtimalle bir deneme fazla sayılır, ki bu
 * güvenlik açısından zararsız yöndür.
 */
export async function recordFailure(keys: string[]): Promise<void> {
  const now = new Date();

  await Promise.all(
    keys.map(async (key) => {
      const existing = await prisma.loginAttempt.findUnique({ where: { key } });

      const expired = !existing || now.getTime() - existing.firstAt.getTime() > WINDOW_MS;
      const count = expired ? 1 : existing.count + 1;
      const blockedUntil = count >= MAX_ATTEMPTS ? new Date(now.getTime() + BLOCK_MS) : null;

      await prisma.loginAttempt.upsert({
        where: { key },
        create: { key, count, firstAt: now, blockedUntil },
        update: {
          count,
          ...(expired ? { firstAt: now } : {}),
          blockedUntil,
        },
      });
    })
  );
}

/** Başarılı girişten sonra defteri temizler. */
export async function clearAttempts(keys: string[]): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { key: { in: keys } } });
}

/** Anahtar biçimi tek yerde: farklı uçların sayaçları karışmasın. */
export const throttleKeys = {
  adminIp: (ip: string) => `admin:ip:${ip}`,
  customerIp: (ip: string) => `customer:ip:${ip}`,
  customerEmail: (email: string) => `customer:email:${email.toLowerCase()}`,
  passwordResetIp: (ip: string) => `reset:ip:${ip}`,
  /**
   * Sipariş oluşturma. Oturum gerektirmeyen tek para dokunan uç olduğu için
   * kendi anahtarı var: giriş sayacıyla aynı kovaya düşseydi, çok sipariş veren
   * bir müşteri kendini panele girişten de kilitlerdi.
   */
  orderIp: (ip: string) => `order:ip:${ip}`,
  /**
   * Kupon kodu denemesi. Sipariş sayacından ayrı: kodu yanlış yazan müşteri
   * kendini sipariş vermekten kilitlememeli, kod deneyen bir betik de
   * siparişin kotasını yiyerek fark edilmeden kalmamalı.
   */
  couponIp: (ip: string) => `coupon:ip:${ip}`,
};
