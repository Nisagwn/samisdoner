# Sami's Döner — üretim imajı.
#
# Dört aşama, iki çıktı:
#
#   deps → builder → runner    (siteyi çalıştıran küçük imaj)
#   deps → migrator            (şemayı kuran, bir kez çalışıp biten imaj)
#
# Neden ayrı: Prisma CLI ve `tsx` yalnızca göç ve tohumlama için gerekir.
# Bunları siteyi çalıştıran imaja koymak, hem ~200 MB fazla yer kaplar hem de
# canlı kabın içine "veritabanını sıfırla" yeteneği koyar. Göç kendi kabında
# çalışır, biter, kaybolur.
#
# Kurma (`bun`) ve çalıştırma (`node`) ayrı: bun kurulumu ve derlemeyi belirgin
# şekilde hızlandırır, Next'in standalone çıktısı ise düz Node ile çalışır ve
# çalışma anında bun'ın getireceği bir kazanç yoktur.

# ───────────────────────────────────────────────────────────── bağımlılıklar
FROM oven/bun:1.3-debian AS deps
WORKDIR /app

# Yalnızca kilit dosyaları kopyalanır: kaynak kod değiştiğinde bu katman
# önbellekten gelir ve kurulum tekrar çalışmaz.
COPY package.json bun.lock ./
# `postinstall` prisma generate çağırır ve şemaya ihtiyaç duyar.
COPY prisma ./prisma
RUN bun install --frozen-lockfile

# ─────────────────────────────────────────────────────────────────── derleme
FROM oven/bun:1.3-debian AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Derleme, veritabanına bağlanmayı denemez ama Prisma istemcisi `DATABASE_URL`
# tanımlı değilse modül yüklenirken hata verir. Sahte bir değer yeterli:
# gerçek adres çalışma anında ortamdan gelir.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
RUN bunx prisma generate && bun run build

# ────────────────────────────────────────────────────────────────────── göç
FROM oven/bun:1.3-debian AS migrator
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
# Tohumlama betiğinin okuduğu iki dosya (katalog verisi ve para dönüşümü).
COPY data ./data
COPY lib/money.ts ./lib/money.ts
COPY deploy/migrate.sh /usr/local/bin/migrate.sh
RUN chmod +x /usr/local/bin/migrate.sh

ENTRYPOINT ["/usr/local/bin/migrate.sh"]

# ─────────────────────────────────────────────────────────────────── yedek
# `pg_dump` + `rclone` bir arada. Postgres imajı temel alınır çünkü dump'ı alan
# aracın sunucudakiyle **aynı ana sürüm** olması gerekir; rclone ise yedeği
# makine dışına taşır (bkz. deploy/backup.sh).
#
# rclone çalışma anında `apk add` ile kurulabilirdi ama o zaman her kap
# başlangıcı ağa bağımlı olurdu — yedek almanın en çok gerektiği an, işlerin
# zaten ters gittiği andır. Bu yüzden imaja gömülü.
FROM postgres:16-alpine AS backup
RUN apk add --no-cache rclone
COPY deploy/backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]

# ────────────────────────────────────────────────────────────────── çalıştır
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Standalone sunucu varsayılanda yalnızca localhost'u dinler; kap dışından
# erişilebilmesi için tüm arayüzlere bağlanması gerekir.
ENV HOSTNAME=0.0.0.0

# Prisma'nın sorgu motoru OpenSSL'e bağlıdır; slim imajda kurulu değildir.
# `wget` sağlık kontrolü için gerekli (compose healthcheck bunu çağırır).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates wget \
  && rm -rf /var/lib/apt/lists/*

# Panelden yüklenen görsellerin dizini (compose'da kalıcı birim bağlanır).
# İmajda `node`a ait olarak var olmak zorunda: Docker boş bir birimi ilk
# bağlayışta sahipliği buradan kopyalar. Dizin yoksa birim root'a ait gelir ve
# her yükleme EACCES ile düşer.
RUN mkdir -p /app/uploads && chown node:node /app/uploads

# Kap root olarak çalışmaz: bir açık, kapın içinde yazma yetkisi bulmasın.
# node imajı `node` kullanıcısını hazır getirir.
USER node

# Standalone çıktı `node_modules`'ün tamamını değil, izlenerek bulunmuş
# parçasını içerir. `static` ve `public` ayrı kopyalanmak zorunda: Next bunları
# çıktının içine koymaz (çoğu dağıtımda CDN'den servis edilirler).
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
