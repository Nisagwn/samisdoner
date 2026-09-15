import { requirePanel } from "@/lib/admin/page";
import type { Metadata } from "next";
import BusinessManager from "@/components/admin/BusinessManager";
import {
  getBusinessSettings,
  listClosures,
  listOpeningHours,
} from "@/lib/orders/business";

/**
 * İşletme ayarları sayfası.
 *
 * Sipariş alımının açık/kapalı olması, teslim biçimleri, hazırlık süresi,
 * haftalık çalışma saatleri ve tatil günleri buradan yönetilir. Şemada baştan
 * beri var olan bu alanların hiçbirinin arayüzü yoktu.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "İşletme // Panel",
  robots: { index: false, follow: false },
};

export default async function AdminBusinessPage() {
  await requirePanel("business");

  const [settings, hours, closures] = await Promise.all([
    getBusinessSettings(),
    listOpeningHours(),
    listClosures(),
  ]);

  return <BusinessManager settings={settings} hours={hours} closures={closures} />;
}
