import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { isImagePath, isUploadName } from "@/lib/admin/imagePath";
import { processImage } from "@/lib/admin/upload";
import { parseProductBody } from "@/lib/admin/validate";

/**
 * Panelden görsel yükleme.
 *
 * İki soru: yükleme gerçekten küçültülmüş, meta verisi atılmış bir WebP mi
 * üretiyor, ve ürüne yazılabilen yol dış bir adrese ya da dizin dışına
 * kaçabiliyor mu.
 */

const HASH = "0123456789abcdef0123456789abcdef";

function photo(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } },
  });
}

/* ══════════════════════════════════════════ görsel yolu */

describe("görsel yolu", () => {
  it("hazır görselleri ve yüklenenleri kabul eder", () => {
    expect(isImagePath("/assets/menu-klasik.webp")).toBe(true);
    expect(isImagePath("/assets/final-reveal-cross.backup.webp")).toBe(true);
    expect(isImagePath(`/uploads/${HASH}.webp`)).toBe(true);
  });

  it.each([
    "//evil.example/x.webp",
    "https://evil.example/x.webp",
    "/uploads/../.env",
    "/assets/../uploads/x.webp",
    "/uploads/abc.webp",
    `/uploads/${HASH}.png`,
    `/uploads/${HASH.toUpperCase()}.webp`,
    "/api/admin/orders",
  ])("reddeder: %s", (value) => {
    expect(isImagePath(value)).toBe(false);
  });

  it("ürün gövdesinde de aynı kural geçerli", () => {
    const ok = parseProductBody({ image: `/uploads/${HASH}.webp` }, [], true);
    expect(ok.ok && ok.value.image).toBe(`/uploads/${HASH}.webp`);

    expect(parseProductBody({ image: "//evil.example/x.webp" }, [], true).ok).toBe(false);
    expect(parseProductBody({ image: "" }, [], true)).toEqual({ ok: true, value: { image: null } });
  });

  it("yükleme adı dizin geçişine izin vermez", () => {
    expect(isUploadName(`${HASH}.webp`)).toBe(true);
    expect(isUploadName(`../${HASH}.webp`)).toBe(false);
    expect(isUploadName(`.${HASH}.webp.tmp`)).toBe(false);
  });
});

/* ══════════════════════════════════════════ görsel işleme */

describe("görsel işleme", () => {
  it("büyük fotoğrafı en uzun kenarı 1600 px olan WebP'ye indirir", async () => {
    const result = await processImage(await photo(4000, 3000).jpeg().toBuffer());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const meta = await sharp(result.data).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([1600, 1200]);
    expect(isUploadName(result.name)).toBe(true);
  });

  it("küçük görseli büyütmez", async () => {
    const result = await processImage(await photo(300, 200).png().toBuffer());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await sharp(result.data).metadata()).width).toBe(300);
  });

  it("aynı içerik aynı adı üretir", async () => {
    const input = await photo(800, 600).jpeg().toBuffer();
    const a = await processImage(input);
    const b = await processImage(input);
    expect(a.ok && b.ok && a.name === b.name).toBe(true);
  });

  it("EXIF meta verisini (konum dahil) çıktıya yazmaz", async () => {
    const input = await photo(800, 600)
      .withExif({ IFD0: { Copyright: "gizli-konum" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const result = await processImage(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await sharp(result.data).metadata()).exif).toBeUndefined();
  });

  it("görsel olmayan dosyayı reddeder", async () => {
    const result = await processImage(Buffer.from("<?php system($_GET['c']); ?>"));
    expect(result.ok).toBe(false);
  });

  it("SVG ve GIF reddedilir", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    expect((await processImage(svg)).ok).toBe(false);

    const gif = await photo(10, 10).gif().toBuffer();
    expect((await processImage(gif)).ok).toBe(false);
  });
});
