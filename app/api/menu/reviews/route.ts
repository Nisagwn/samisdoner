import { NextResponse } from "next/server";
import type { ProductReviewSummary } from "@/lib/reviews/products";
import { getProductReviews } from "@/lib/reviews/repository";
import { withDatabase } from "@/lib/security/dbGuard";

/**
 * Bir ürünün değerlendirmeleri.
 *
 * Neden ayrı bir uç ve sayfayla birlikte gelmiyor: menüde altmışa yakın ürün
 * var, hepsinin yorumlarını her menü isteğinde göndermek sayfanın yükünü
 * okunmayan metinle şişirirdi. Yorumlar yalnızca ürün penceresi açıldığında,
 * açılan ürün için istenir.
 *
 * Yanıttaki puanın **siparişin** puanı olduğu, ürüne tek tek verilmiş bir not
 * olmadığı unutulmamalı — gerekçesi `ProductReviewSummary` üzerinde yazılı;
 * ekran da bunu böyle söyler.
 *
 * Gizlenmiş yorumlar buraya hiç girmez (`published: true` süzgeci veri
 * katmanında); bu uç yayındaki veriyi olduğu gibi verir ve oturum istemez.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ProductReviewsResponse = ProductReviewSummary;

/** Kurcalanmış bir kimliği veri katmanına hiç götürmemek için. */
const MAX_ID_LENGTH = 120;

export async function GET(request: Request) {
  const productId = new URL(request.url).searchParams.get("productId")?.trim() ?? "";
  if (productId.length === 0 || productId.length > MAX_ID_LENGTH) {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  return withDatabase(async () => {
    return NextResponse.json<ProductReviewsResponse>(await getProductReviews(productId));
  });
}
