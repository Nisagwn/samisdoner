import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cacheStatus } from "@/lib/cache";
import { openingHoursBypassActive } from "@/lib/orders/availability";

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

  /* Yapılandırma uyarıları — durumu (200/503) DEĞİŞTİRMEZ.
     Kasıtlı: bunlar arıza değil, "canlıda böyle kalmamalı" ayarları. 503
     döndürmek, sağlıklı bir kabı Docker'a sürekli yeniden başlattırırdı. */
  const warnings: string[] = [];
  if (openingHoursBypassActive()) {
    warnings.push(
      "ORDERS_IGNORE_OPENING_HOURS acik: calisma saati kontrolu atlanıyor, " +
        "dukkan kapaliyken de siparis alinip odeme cekilir."
    );
  }

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      database,
      cache,
      ...(warnings.length > 0 ? { warnings } : {}),
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
