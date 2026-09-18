import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { UPLOAD_PREFIX, isUploadName } from "./imagePath";

/**
 * Panelden yüklenen ürün görselleri.
 *
 * NEDEN SUNUCU DİSKİ (nesne deposu ya da veritabanı değil)
 *
 * - Site tek sunucuda çalışıyor; görseller aynı makinedeki kalıcı bir Docker
 *   biriminde durur. Ek hizmet, ek anahtar, ek fatura yok.
 * - Veritabanına (bytea) koymak her günlük pg_dump'ı görseller kadar büyütürdü;
 *   uzak arşiv sekiz yıl silinmeden tutulduğu için bu her gün yeniden ödenirdi.
 *   Diskteki dosyalar ise rclone ile artımlı kopyalanır (bkz. deploy/backup.sh).
 * - S3/R2 bir döner dükkânının 50-100 görseli için gereksiz bir parça ve
 *   DSGVO tarafında yeni bir alt işleyen olurdu.
 *
 * Yükleme sırasında görsel yeniden kodlanır: en uzun kenar 1600 px, WebP. Bu
 * hem 5 MB'lık telefon fotoğrafını ~200 KB'a indirir hem de dosyanın gerçekten
 * görsel olduğunu kanıtlar — uzantıya ya da istemcinin bildirdiği türe
 * güvenilmez. EXIF (konum bilgisi dahil) çıktıya yazılmaz.
 */

const MAX_EDGE = 1600;
/** Sıkıştırma bombasına karşı: 8000×8000'den büyük görsel açılmaz. */
const MAX_INPUT_PIXELS = 64_000_000;
/** `heif`, sharp'ın AVIF için döndürdüğü biçim adıdır. GIF/SVG/TIFF bilinçli olarak yok. */
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "heif"]);

export function uploadDir(): string {
  return process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
}

export type ProcessedImage =
  | { ok: true; name: string; data: Buffer }
  | { ok: false; error: string };

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  let format: string | undefined;
  try {
    format = (await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()).format;
  } catch {
    return { ok: false, error: "Dosya bir görsel olarak okunamadı." };
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) {
    return { ok: false, error: "Yalnızca JPG, PNG, WebP veya AVIF yüklenebilir." };
  }

  try {
    const data = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      // Telefon fotoğrafları yönünü EXIF'te taşır; meta veri atılmadan önce uygulanır.
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const name = `${createHash("sha256").update(data).digest("hex").slice(0, 32)}.webp`;
    return { ok: true, name, data };
  } catch {
    // Çoğunlukla iPhone'un HEIC biçimi (sharp'ın hazır derlemesi okuyamaz) ya da
    // piksel sınırını aşan dev bir görsel.
    return {
      ok: false,
      error: "Görsel işlenemedi. Çok büyük olabilir ya da HEIC biçimindedir; JPG olarak yeniden deneyin.",
    };
  }
}

/** Dosyayı yazar ve ürüne kaydedilecek yolu döner. Aynı içerik ikinci kez yazılmaz. */
export async function saveUpload(name: string, data: Buffer): Promise<string> {
  if (!isUploadName(name)) throw new Error(`Geçersiz yükleme adı: ${name}`);
  const dir = uploadDir();
  const target = path.join(dir, name);

  const exists = await fs.access(target).then(() => true, () => false);
  if (!exists) {
    await fs.mkdir(dir, { recursive: true });
    // Önce geçici ada: yarım yazılmış bir dosya hiçbir zaman gerçek adıyla görünmesin.
    const temp = path.join(dir, `.${name}.${randomUUID()}.tmp`);
    await fs.writeFile(temp, data);
    await fs.rename(temp, target);
  }

  return `${UPLOAD_PREFIX}${name}`;
}

export async function readUpload(name: string): Promise<Buffer | null> {
  if (!isUploadName(name)) return null;
  try {
    return await fs.readFile(path.join(uploadDir(), name));
  } catch {
    return null;
  }
}
