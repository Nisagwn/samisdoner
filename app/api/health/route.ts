import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cacheStatus } from "@/lib/cache";

/**
 * Sağlık ucu — konteyner ve yük dengeleyici bunu okur.
 *
 * Docker `healthcheck` bu adrese bakar: 200 dönmeyen kap yeniden başlatılır ve
 * yeni sürüm, veritabanı bağlantısı kurulana kadar trafiğe açılmaz.
 *
 * Kural: **yalnızca uygulamanın hizmet veremeyeceği durumlar 503 döner.**
 * Veritabanı yoksa sipariş alınamaz — bu bir arızadır. Redis yoksa site
 * yavaşlar ama çalışır (`lib/cache.ts` veritabanına düşer) — bu bir arıza
 * değildir, yalnızca raporlanır. Aksi hâlde Redis'in bakımı için verilen yarım
 * dakika, tüm kabın yeniden başlatılmasına yol açardı.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cache = await cacheStatus();

  let database: "ready" | "unreachable" = "ready";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "unreachable";
  }

  const healthy = database === "ready";

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", database, cache, time: new Date().toISOString() },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
