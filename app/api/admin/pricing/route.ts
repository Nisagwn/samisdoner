import { NextResponse } from "next/server";
import { badRequest, requirePermission, storeWrite } from "@/lib/admin/guard";
import { getCatalog, updateSettings } from "@/lib/admin/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Servis ücreti ayarları.
 *
 * Uç eskiden iki şeyi birlikte yönetiyordu: servis ücreti ve kaldırılan
 * "Kendin Seç" bölümünün seçenek başına ek ücretleri. İkinci yarı gitti;
 * gövdenin `settings` alanı aynı biçimde duruyor, `builder` alanı artık yok
 * sayılır. Adres değiştirilmedi — panelde tek çağıran var (`ServiceFeeCard`)
 * ama eski bir sekme açık kalmışsa isteği hata değil, yalnızca eksik alanla
 * geçsin.
 */

function money(value: unknown, field: string): number | { error: string } {
  const num = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  if (typeof num !== "number" || !Number.isFinite(num)) {
    return { error: `${field} geçerli bir sayı olmalı.` };
  }
  if (num < 0) return { error: `${field} negatif olamaz.` };
  if (num > 10000) return { error: `${field} çok yüksek.` };
  return Math.round(num * 100) / 100;
}

export async function GET() {
  const denied = await requirePermission("catalog");
  if (denied instanceof NextResponse) return denied;

  const catalog = await getCatalog();
  return NextResponse.json({ settings: catalog.settings });
}

export async function PATCH(request: Request) {
  const denied = await requirePermission("catalog");
  if (denied instanceof NextResponse) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Geçersiz istek gövdesi.");
  }
  const input = (body ?? {}) as Record<string, unknown>;

  if (input.settings !== undefined) {
    const raw = (input.settings ?? {}) as Record<string, unknown>;
    const fee = money(raw.serviceFee, "Servis ücreti");
    if (typeof fee !== "number") return badRequest(fee.error);
    const threshold = money(raw.freeServiceOver, "Ücretsiz servis eşiği");
    if (typeof threshold !== "number") return badRequest(threshold.error);

    const saved = await storeWrite(() =>
      updateSettings({ serviceFee: fee, freeServiceOver: threshold })
    );
    if (saved instanceof NextResponse) return saved;
  }

  const fresh = await getCatalog();
  return NextResponse.json({ settings: fresh.settings });
}
