import Redis from "ioredis";

/**
 * Paylaşımlı önbellek katmanı — Redis (varsa) + süreç içi bellek.
 *
 * NEDEN VAR
 *
 * Menü, fiyat ayarları, çalışma saatleri ve teslimat bölgeleri **nadiren**
 * değişir ama neredeyse her istekte okunur: ana sayfa, kart, sepet çekmecesi
 * (`/api/menu/status`), fiyat teklifi, sipariş oluşturma. Her okumanın
 * veritabanına gitmesi, sayfa hızını veritabanına olan ağ gecikmesine bağlar.
 * Ölçüm: uzak (Supabase Frankfurt) havuzlanmış bağlantıda sorgu başına
 * ~450 ms, doğrudan bağlantıda ~87 ms, aynı makinedeki Postgres'te ~1 ms.
 *
 * Daha önce bu iş `next/cache`'in `unstable_cache`'i ile yapılıyordu. İki
 * sınırı vardı:
 *
 *  1. Önbellek **süreç içindeydi**: uygulama yeniden başladığında ya da ikinci
 *     bir kopya çalıştığında baştan doluyordu.
 *  2. Yalnızca katalog önbellekleniyordu; sipariş akışının okuduğu ayarlar,
 *     saatler ve bölgeler her istekte veritabanına gidiyordu.
 *
 * Bu modül ikisini de çözer ve tek bir sözleşme sunar: `cached(anahtar, ttl, yükleyici)`.
 *
 * İKİ KATMAN
 *
 *  L1 — süreç içi Map. Aynı istek dalgasındaki tekrar okumalar Redis'e bile
 *       gitmez (yerel Redis ~0.2 ms, bellek ~0 ms; asıl kazanç Redis kopukken
 *       sitenin yavaşlamamasıdır).
 *  L2 — Redis. Süreçler ve yeniden başlatmalar arasında paylaşılır.
 *
 * REDIS YOKSA
 *
 * `REDIS_URL` tanımlı değilse modül yalnızca L1 ile çalışır ve hiçbir çağrı
 * hata vermez. Yani Redis **zorunlu bağımlılık değil, hızlandırıcıdır**:
 * bağlantı koparsa istekler veritabanına düşer, site ayakta kalır. Bu bilinçli
 * bir tercih — bir döner dükkânının sitesi, önbellek sunucusu düştü diye
 * sipariş almayı bırakmamalı.
 *
 * TUTARLILIK
 *
 * Yazma işlemi ilgili anahtarı `invalidate()` ile düşürür. Redis'te silme
 * anında olur; diğer süreçlerin L1'i ise `invalidate` kanalından gelen yayınla
 * temizlenir. Yayın ulaşmazsa (Redis kopuksa) L1 girdisi en geç
 * `L1_MAX_TTL_MS` sonunda kendiliğinden düşer — bayatlığın üst sınırı budur.
 */

/* ------------------------------------------------------------- anahtarlar */

/**
 * Önbellek anahtarları tek yerde.
 *
 * Anahtarı yazma tarafında elle dizmek, bir gün "settings" ile "setting"
 * arasındaki farkın sessizce bayat fiyat göstermesi demektir.
 */
export const CACHE_KEYS = {
  /** Tüm katalog: kategoriler + ürünler + fiyat ayarları. */
  catalog: "catalog",
  /** Sipariş akışının okuduğu işletme ayarları (açık/kapalı anahtarları). */
  orderSettings: "order-settings",
  /** Haftalık çalışma saatleri. */
  openingHours: "opening-hours",
  /** Bugünden itibaren geçerli tatil günleri. */
  closures: "closures",
  /** Teslimat bölgeleri listesi. */
  zones: "zones",
  /**
   * Yayındaki değerlendirmeler ve ortalama puan.
   *
   * Ana sayfada ve "Hakkımızda" sayfasında görünür, yani neredeyse her
   * ziyarette okunur; değişmesi ise günde birkaç kez. Önbelleğe tam olarak
   * uyan iş yükü bu.
   */
  reviews: "reviews",
  /**
   * Otomatik kampanyalar (kodsuz). Sepetin her fiyat teklifinde ve menü
   * sayfasında okunur. Kullanım sayacı bayat kalabilir; sınır zaten sipariş
   * yazılırken koşullu UPDATE ile uygulanıyor (bkz. `redeemCoupon`).
   */
  campaigns: "campaigns",
} as const;

export type CacheKey = (typeof CACHE_KEYS)[keyof typeof CACHE_KEYS];

/**
 * Anahtar öneki.
 *
 * Sürüm numarası **saklanan verinin biçimi değiştiğinde** artırılır: yeni kod
 * eski biçimde saklanmış JSON'u okuyup eksik alanlarla çalışmasın. Aynı Redis'i
 * başka bir uygulama paylaşırsa da çakışma olmaz.
 */
const NAMESPACE = process.env.CACHE_NAMESPACE || "doner:v1";
const INVALIDATION_CHANNEL = `${NAMESPACE}:invalidate`;

/** L1'de bir girdinin yaşayabileceği en uzun süre (bkz. TUTARLILIK). */
const L1_MAX_TTL_MS = 60_000;

/* ---------------------------------------------------------------- durumlar */

type Entry = { value: unknown; expiresAt: number };

/**
 * Geliştirmede modüller sıcak yeniden yüklenir; her yüklemede yeni bir Redis
 * bağlantısı açılırsa bağlantılar birikir. Prisma istemcisiyle aynı sebeple
 * global nesnede saklanır.
 */
const globalForCache = globalThis as unknown as {
  cacheL1?: Map<string, Entry>;
  cacheInflight?: Map<string, Promise<unknown>>;
  cacheRedis?: Redis | null;
  cacheSubscriber?: Redis | null;
};

const l1 = (globalForCache.cacheL1 ??= new Map<string, Entry>());

/**
 * Aynı anahtar için uçuşta olan yükleme.
 *
 * Önbellek boşken gelen üç eşzamanlı istek üç ayrı veritabanı sorgusu
 * açmasın diye: ilki yükler, diğerleri aynı sözü bekler.
 */
const inflight = (globalForCache.cacheInflight ??= new Map<string, Promise<unknown>>());

/* ------------------------------------------------------------------ redis */

/**
 * Redis istemcisi — `REDIS_URL` yoksa `null`.
 *
 * Ayarlar bilinçli olarak "hızlı pes et" tarafında: önbellek sunucusuna
 * ulaşılamıyorsa istek Redis'i beklemek yerine hemen veritabanına düşmeli.
 *  - `enableOfflineQueue: false` → bağlantı yokken komut kuyruğa girmez, anında hata verir.
 *  - `maxRetriesPerRequest: 1`   → tek deneme; ısrar gecikmeye dönüşür.
 *  - `connectTimeout: 1000`      → el sıkışma bir saniyeyi geçerse vazgeçilir.
 */
function createClient(role: string): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  const client = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    // Yeniden bağlanma denemeleri seyrelerek uzar; kopuk Redis, günlüğü
    // saniyede yüzlerce satırla doldurmasın.
    retryStrategy: (times) => Math.min(times * 500, 10_000),
  });

  // `error` dinleyicisi olmadan Node bağlantı hatasını yakalanmamış istisna
  // sayar ve süreci düşürür — yani Redis'in kopması siteyi çökertirdi.
  let warned = false;
  client.on("error", (error: Error) => {
    if (warned) return; // her denemede değil, durum değişince yaz
    warned = true;
    console.warn(`[cache] redis (${role}) ulaşılamıyor, veritabanına düşülüyor:`, error.message);
  });
  client.on("ready", () => {
    warned = false;
  });

  return client;
}

function redis(): Redis | null {
  if (globalForCache.cacheRedis === undefined) {
    globalForCache.cacheRedis = createClient("client");
    subscribe();
  }
  return globalForCache.cacheRedis;
}

/**
 * Geçersizleme yayınına abone olur.
 *
 * Redis'te bir bağlantı abone moduna geçtiğinde başka komut kabul etmez; bu
 * yüzden ikinci bir istemci gerekir.
 */
function subscribe(): void {
  if (globalForCache.cacheSubscriber !== undefined) return;

  const subscriber = createClient("subscriber");
  globalForCache.cacheSubscriber = subscriber;
  if (!subscriber) return;

  subscriber.subscribe(INVALIDATION_CHANNEL).catch(() => {
    /* abone olunamadıysa L1 kendi süresiyle düşer; sessizce devam */
  });

  subscriber.on("message", (channel: string, message: string) => {
    if (channel !== INVALIDATION_CHANNEL) return;
    for (const key of message.split(",")) l1.delete(key);
  });
}

/* ------------------------------------------------------------------ okuma */

/**
 * Anahtarı önbellekten okur; yoksa yükleyiciyi çalıştırıp saklar.
 *
 * Yükleyicinin fırlattığı hata **yutulmaz**: veritabanına ulaşılamıyorsa
 * çağıran taraf bunu bilmeli (`withDatabase` 503'e çevirir). Yutulan tek şey
 * Redis'in kendi arızasıdır.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  const hit = l1.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = (async () => {
    const client = redis();

    if (client) {
      try {
        const raw = await client.get(`${NAMESPACE}:${key}`);
        if (raw !== null) {
          const value = JSON.parse(raw) as T;
          rememberLocally(key, value, ttlSeconds);
          return value;
        }
      } catch {
        /* Redis okunamadı — veritabanına düşülür. */
      }
    }

    const value = await loader();
    rememberLocally(key, value, ttlSeconds);

    if (client) {
      try {
        await client.set(`${NAMESPACE}:${key}`, JSON.stringify(value), "EX", ttlSeconds);
      } catch {
        /* yazılamadıysa da değer döner; bir sonraki istek yeniden dener */
      }
    }

    return value;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

function rememberLocally(key: string, value: unknown, ttlSeconds: number): void {
  l1.set(key, { value, expiresAt: Date.now() + Math.min(ttlSeconds * 1000, L1_MAX_TTL_MS) });
}

/* ----------------------------------------------------------- geçersizleme */

/**
 * Anahtarları düşürür — hem yerelde, hem Redis'te, hem diğer süreçlerde.
 *
 * Veriyi değiştiren **her** yazma bunu çağırmak zorundadır; unutulan bir çağrı,
 * panelde değişmiş ama müşteride eski görünen bir fiyat demektir.
 */
export async function invalidate(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  for (const key of keys) l1.delete(key);

  const client = redis();
  if (!client) return;

  try {
    await client.del(...keys.map((key) => `${NAMESPACE}:${key}`));
    await client.publish(INVALIDATION_CHANNEL, keys.join(","));
  } catch {
    /* Redis kapalıysa L1 zaten temizlendi; diğer süreçler süre dolunca yakalar */
  }
}

/* ---------------------------------------------------------------- sağlık */

/** `/api/health` için: önbellek katmanı ayakta mı. */
export async function cacheStatus(): Promise<"disabled" | "ready" | "unreachable"> {
  const client = redis();
  if (!client) return "disabled";
  try {
    await client.ping();
    return "ready";
  } catch {
    return "unreachable";
  }
}
