-- Ürün seçenek grupları ve menü rozetleri.
--
-- Katalog tarafı genişliyor: her ürün kendi seçenek gruplarını (et türü, sos,
-- ekstra malzeme) taşıyabiliyor ve menüde rozet gösterilebiliyor.
--
-- Kullanım dışı BuilderGroup/BuilderOption tablolarına dokunulmadı; neden ayrı
-- bir model kurulduğu prisma/schema.prisma içinde anlatılıyor.
--
-- Mevcut kayıtlar için hepsi güvenli varsayılanlarla gelir: rozet yok, seçenek
-- grubu yok — yani bu göçten sonra menü bire bir aynı görünür.

-- CreateEnum
CREATE TYPE "Diet" AS ENUM ('NONE', 'VEGETARIAN', 'VEGAN');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isPopular" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isNew" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "diet" "Diet" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "spicyLevel" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OptionGroup" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameTr" TEXT NOT NULL DEFAULT '',
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OptionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionChoice" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameTr" TEXT NOT NULL DEFAULT '',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OptionChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OptionGroup_productId_sortOrder_idx" ON "OptionGroup"("productId", "sortOrder");

-- CreateIndex
CREATE INDEX "OptionChoice_groupId_sortOrder_idx" ON "OptionChoice"("groupId", "sortOrder");

-- AddForeignKey
ALTER TABLE "OptionGroup" ADD CONSTRAINT "OptionGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionChoice" ADD CONSTRAINT "OptionChoice_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OptionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
