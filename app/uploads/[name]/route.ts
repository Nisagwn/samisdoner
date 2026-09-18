import { readUpload } from "@/lib/admin/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Panelden yüklenen görselleri sunar.
 *
 * Neden `public/` değil: Next'in üretim sunucusu yalnızca derleme anında
 * `public/` içinde olan dosyaları sunar, sonradan eklenenleri görmez; üstelik
 * her dağıtımda imaj yenilendiği için dosyalar silinirdi.
 *
 * Neden Caddy'den doğrudan değil: `next/image` görseli küçültürken kaynağı
 * uygulamanın içinden ister. Bu uç olduğu sürece menüdeki `<Image>` bileşenleri
 * değişmeden çalışır ve 64 px'lik küçük resim için 1600 px'lik dosya inmez.
 *
 * Ad içerik özeti olduğu için yanıt bir yıl ve `immutable` önbelleklenir.
 */
export async function GET(_request: Request, { params }: { params: { name: string } }) {
  const data = await readUpload(params.name);
  if (!data) return new Response("Not found", { status: 404 });

  // Node'un Buffer tipi fetch'in BodyInit tipine uymuyor; ~200 KB'lık kopya önemsiz.
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
