-- Kuponlardan kampanyalara.
--
-- İndirim kuponu tablosu genişletildi; tablo adı bilinçli olarak aynı kaldı
-- (bkz. schema.prisma içindeki Coupon notu):
--
--  1. İki yeni tür: PRODUCT_PRICE ("ayın ürünü" — ürüne özel fiyat) ve
--     BUNDLE_PRICE ("menü fiyatı" — ürün birleşimine özel fiyat).
--  2. Coupon.code artık boş olabilir: kodu olmayan kampanya otomatiktir.
--  3. Coupon.title / titleTr — müşteriye görünen ad. Coupon.items — ürüne
--     bağlı türlerin ürün listesi.
--  4. Bir siparişe birden çok kampanya binebilir: CouponRedemption üzerindeki
--     "sipariş başına tek satır" kısıtı, "sipariş başına aynı kampanyadan tek
--     satır" kısıtına dönüşür.
--  5. Order.discountLines — uygulanan kampanyaların dondurulmuş dökümü.
--
-- Var olan kuponlar kodlu, adsız ve ürünsüz kalır; davranışları değişmez.
-- Var olan siparişlerde döküm boş dizidir: ekranlar o durumda eskisi gibi tek
-- "İndirim · KOD" satırı gösterir.

-- AlterEnum
ALTER TYPE "CouponKind" ADD VALUE 'PRODUCT_PRICE';
ALTER TYPE "CouponKind" ADD VALUE 'BUNDLE_PRICE';

-- AlterTable
ALTER TABLE "Coupon" ALTER COLUMN "code" DROP NOT NULL,
ADD COLUMN     "items" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "titleTr" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "discountLines" JSONB NOT NULL DEFAULT '[]';

-- DropIndex
DROP INDEX "CouponRedemption_orderId_key";

-- CreateIndex
CREATE INDEX "CouponRedemption_orderId_idx" ON "CouponRedemption"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_couponId_orderId_key" ON "CouponRedemption"("couponId", "orderId");
