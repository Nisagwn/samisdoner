import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requirePermission, storeWrite } from "@/lib/admin/guard";
import { redeemReward } from "@/lib/account/loyalty";

/**
 * Damga kartı ödülünün kasada kullanılması.
 *
 * Müşteri kodu tezgâhta ya da telefonda söyler, personel buraya girer. Yetki
 * "orders": vardiyadaki herkes yapabilmeli — ödülü kullandırmak için müdür
 * beklemek, sırada bekleyen müşteriyi bekletmek demek.
 *
 * Kullanma işlemi tek sorguda ve `redeemedAt: null` koşuluyla yapılıyor
 * (bkz. lib/account/loyalty.ts): aynı kodu iki farklı personel aynı anda
 * girerse yalnızca biri kazanır, diğeri "zaten kullanılmış" cevabı alır.
 * İkisinin de bedava döner vermesi böylece imkânsız.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  code: z.string().trim().min(4).max(32),
});

const MESSAGES: Record<string, string> = {
  not_found: "Böyle bir ödül kodu yok.",
  already_redeemed: "Bu kod daha önce kullanılmış.",
  expired: "Bu ödülün süresi dolmuş.",
};

export async function POST(request: Request) {
  const session = await requirePermission("orders");
  if (session instanceof NextResponse) return session;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("Geçersiz istek gövdesi.");
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return badRequest("Kod eksik ya da geçersiz.");

  // Kodu kimin kullandırdığı kayda yazılır: "bu ödülü kim verdi" sorusu,
  // gün sonu sayımı tutmadığında sorulur.
  const actor = session.userId === "env" ? "admin:recovery" : `admin:${session.userId}`;

  const result = await storeWrite(() => redeemReward(parsed.data.code, actor));
  if (result instanceof NextResponse) return result;

  if (!result.ok) {
    return NextResponse.json(
      { error: MESSAGES[result.reason] },
      // 404 yalnızca "kod yok"; kullanılmış ya da süresi dolmuş bir kod
      // gerçekten vardır ve bu bir çakışmadır.
      { status: result.reason === "not_found" ? 404 : 409 }
    );
  }

  return NextResponse.json({ ok: true, customerName: result.customerName });
}
