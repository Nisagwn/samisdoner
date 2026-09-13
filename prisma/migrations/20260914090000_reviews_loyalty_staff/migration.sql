-- Değerlendirme, damga kartı, e-posta doğrulama ve panel personeli.
--
-- Dört bağımsız parça tek göçte: hepsi yeni tablo/yeni sütun ekler, hiçbiri
-- var olan veriye dokunmaz. Mevcut satırların tamamı `DEFAULT` değerlerini
-- alır, dolayısıyla göç veri kaybı riski taşımaz ve sipariş akışını durdurmaz.

-- ─────────────────────────────────────────────────────────── roller
--
-- `ALTER TYPE ... ADD VALUE` PostgreSQL'de geri alınamaz ve aynı işlem
-- bloğunda kullanılamaz; bu yüzden dosyanın en başında, tek başına durur.
ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'MANAGER' BEFORE 'STAFF';

-- ──────────────────────────────────────────────── müşteri: izinler
--
-- Reklam izni `false` başlar. Var olan hesaplara "nasılsa kayıt olmuşlar"
-- diyerek `true` vermek, UWG § 7 anlamında rıza sayılmaz ve toplu bir
-- ihlal üretirdi.
ALTER TABLE "Customer" ADD COLUMN "marketingOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN "marketingOptInAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "reviewMailsOptIn" BOOLEAN NOT NULL DEFAULT true;

-- ─────────────────────────────────────────── panel kullanıcısı: oturum sürümü
ALTER TABLE "AdminUser" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- ──────────────────────────────────────────────── e-posta doğrulama
CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailVerification_tokenHash_key" ON "EmailVerification"("tokenHash");
CREATE INDEX "EmailVerification_customerId_createdAt_idx" ON "EmailVerification"("customerId", "createdAt");

ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────────────────────────────────── değerlendirme
--
-- `orderId` benzersizdir ama yabancı anahtar DEĞİLDİR: sipariş tablosu ayrı
-- bir sorumluluk alanı ve ona geri-ilişki eklemek istenmiyor. Benzersizlik
-- kısıtı asıl güvenceyi — sipariş başına tek değerlendirme — zaten veriyor.
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL DEFAULT '',
    "customerId" TEXT NOT NULL,
    "foodRating" INTEGER NOT NULL,
    "deliveryRating" INTEGER,
    "comment" TEXT NOT NULL DEFAULT '',
    "authorName" TEXT NOT NULL DEFAULT '',
    "lang" TEXT NOT NULL DEFAULT 'de',
    "published" BOOLEAN NOT NULL DEFAULT true,
    "hiddenReason" TEXT NOT NULL DEFAULT '',
    "reply" TEXT NOT NULL DEFAULT '',
    "repliedAt" TIMESTAMP(3),
    "repliedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Review_orderId_key" ON "Review"("orderId");
-- Ana sayfadaki "yayındaki yorumlar, yeniden eskiye" sorgusunun tek indeksi.
CREATE INDEX "Review_published_createdAt_idx" ON "Review"("published", "createdAt");
CREATE INDEX "Review_customerId_createdAt_idx" ON "Review"("customerId", "createdAt");

ALTER TABLE "Review" ADD CONSTRAINT "Review_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────── damga kartı ödülü
CREATE TABLE "LoyaltyReward" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "throughOrderCount" INTEGER NOT NULL,
    "stampsUsed" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "redeemedBy" TEXT NOT NULL DEFAULT '',
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyReward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoyaltyReward_code_key" ON "LoyaltyReward"("code");
CREATE INDEX "LoyaltyReward_customerId_issuedAt_idx" ON "LoyaltyReward"("customerId", "issuedAt");

ALTER TABLE "LoyaltyReward" ADD CONSTRAINT "LoyaltyReward_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
