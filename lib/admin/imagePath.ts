/**
 * Ürün görseli yolları — hangi adreslerin kabul edildiği tek yerde.
 *
 * İki kaynak var:
 *   /assets/<ad>.webp          imajla gelen hazır görseller (public/assets)
 *   /uploads/<özet>.webp       panelden yüklenenler (kalıcı birim, bkz. upload.ts)
 *
 * Yüklenen dosyanın adı içeriğinin SHA-256 özetidir. Ad içerikten türediği için
 * aynı adda farklı bir dosya olamaz: tarayıcı ve Caddy bir yıl önbellekleyebilir,
 * görseli değiştirmek yeni bir ad üretir.
 *
 * Bu dosya `sharp` içe aktarmaz; doğrulama katmanı ve istemci bileşenleri
 * görüntü işleme kütüphanesini yüklemeden kullanabilsin.
 */

export const UPLOAD_PREFIX = "/uploads/";

/** Yükleme sınırı. Güncel telefon fotoğrafları 3-6 MB; iki katı pay bırakılır. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const UPLOAD_NAME = /^[a-f0-9]{32}\.webp$/;
const ASSET_PATH = /^\/assets\/[\w-]+(\.[\w-]+)*\.(webp|png|jpe?g|avif)$/i;

/** Yüklenen dosya adı mı (`<32 hex>.webp`)? Dizin geçişine yer bırakmaz. */
export function isUploadName(name: string): boolean {
  return UPLOAD_NAME.test(name);
}

/** Ürüne yazılabilecek bir görsel yolu mu? Dış adresler ve `//alan/...` reddedilir. */
export function isImagePath(value: string): boolean {
  if (ASSET_PATH.test(value)) return true;
  return value.startsWith(UPLOAD_PREFIX) && isUploadName(value.slice(UPLOAD_PREFIX.length));
}
