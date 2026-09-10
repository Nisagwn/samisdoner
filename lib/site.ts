/**
 * Sitenin kendi genel adresi — tek kaynak.
 *
 * `robots.ts`, `sitemap.ts`, açılış görseli ve `metadataBase` mutlak adres
 * ister; göreli bir yol verildiğinde Next derleme sırasında uyarır ve paylaşım
 * önizlemeleri sessizce görselsiz kalır.
 *
 * Ödeme akışındaki dönüş adresleri (`lib/orders/actions.ts`) de buradan okur:
 * iki ayrı okuma olsaydı Stripe bir alan adına, arama motoru başka bir alan
 * adına bakabilirdi ve fark yalnızca canlıda görünürdü.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");
