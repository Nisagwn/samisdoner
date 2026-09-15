-- Kupon, bahşiş ve ödeme anı.
--
-- Üç ekleme bir arada, çünkü üçü de aynı ekranın (ödeme adımı) ve aynı
-- hesabın (sipariş toplamı) parçası:
--
--  1. Order.discountCents / couponCode — Gutscheincode indirimi. Tutar siparişe
--     KOPYALANIR; kupon sonradan değişse bile geçmiş sipariş değişmez.
--  2. Order.tipCents — Trinkgeld. Toplama eklenir, KDV matrahına GİRMEZ
--     (Abschn. 10.1 Abs. 5 UStAE: personele gönüllü verilen bahşiş, işletmenin
--     edimi için ödenen bedelin parçası değildir).
--  3. Order.paidAt — siparişin mutfağa düştüğü an. Müşterinin iptal penceresi
--     buna bakar. Payment.paidAt yetmiyor: kapıda ödemede Payment satırı hiç
--     oluşmuyor.
--
-- Var olan siparişlerde üç sayısal alan da 0, paidAt ise NULL kalır: geçmişte
-- kupon da bahşiş de yoktu, dolayısıyla varsayılanlar gerçeği anlatıyor.
-- paidAt'in geriye dönük doldurulmaması bilinçli — iptal penceresi zaten
-- kapanmış siparişler için bu alanın boş olması doğru cevabı verir.

-- CreateEnum
CREATE TYPE "CouponKind" AS ENUM ('PERCENT', 'FIXED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "couponCode" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "tipCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "CouponKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "minOrderCents" INTEGER NOT NULL DEFAULT 0,
    "maxDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "fulfillment" "Fulfillment",
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "maxRedemptions" INTEGER NOT NULL DEFAULT 0,
    "redeemedCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponRedemption" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_orderId_key" ON "CouponRedemption"("orderId");

-- CreateIndex
CREATE INDEX "CouponRedemption_couponId_createdAt_idx" ON "CouponRedemption"("couponId", "createdAt");

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
