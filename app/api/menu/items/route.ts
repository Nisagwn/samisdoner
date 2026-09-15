import { NextResponse } from "next/server";
import { getMenuItemsByIds, getSuggestions } from "@/lib/admin/store";
import { withDatabase } from "@/lib/security/dbGuard";
import type { MenuItem } from "@/data/speisekarte";

/**
 * Tek tek menü satırları.
 *
 * İki müşterisi var ve ikisi de sepet çekmecesinde yaşıyor:
 *
 *  1. **Satır düzenleme** (`?ids=a,b`): müşteri sepetteki bir satırın
 *     seçeneklerini değiştirmek istediğinde ürün penceresinin o ürünün
 *     gruplarına ihtiyacı var. Sepet yalnızca kimlik taşıdığı için (bkz.
 *     lib/cart.tsx) grupları buradan çeker.
 *  2. **Çapraz satış** (`?suggest=3`): sepete eklenen dönerin yanına içecek
 *     önermek.
 *
 * Neden tek uç: ikisi de "birkaç menü satırı ver" diyor ve aynı şekli
 * döndürüyor. İki ayrı uç, aynı eşleyicinin iki çağrı yeri ve iki ayrı
 * önbellek davranışı demekti.
 *
 * Fiyat burada da bağlayıcı değildir: yanıttaki tutarlar gösterim içindir,
 * tahsil edilen tutar her zaman `/api/menu/quote`'tan gelir.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type MenuItemsResponse = { items: MenuItem[] };

/** Tek istekte istenebilecek en çok satır; üstü kurcalanmış bir istektir. */
const MAX_IDS = 20;
const MAX_SUGGESTIONS = 6;

function idList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id.length <= 120)
    .slice(0, MAX_IDS);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const suggest = url.searchParams.get("suggest");

  return withDatabase(async () => {
    if (suggest !== null) {
      const limit = Math.min(MAX_SUGGESTIONS, Math.max(1, Number(suggest) || 3));
      const items = await getSuggestions(idList(url.searchParams.get("exclude")), limit);
      return NextResponse.json<MenuItemsResponse>({ items });
    }

    const ids = idList(url.searchParams.get("ids"));
    // Kimlik verilmediyse boş liste: tüm menüyü döndürmek, bu ucun işi değil
    // (o zaten sayfanın sunucu tarafında geliyor).
    if (ids.length === 0) return NextResponse.json<MenuItemsResponse>({ items: [] });

    const items = await getMenuItemsByIds(ids);
    return NextResponse.json<MenuItemsResponse>({ items });
  });
}
