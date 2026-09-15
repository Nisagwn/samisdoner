import type { Metadata } from "next";
import AdminShell from "@/components/admin/AdminShell";
import { getAdminSession } from "@/lib/admin/guard";

export const metadata: Metadata = {
  title: "Yönetim Paneli // Sami´s Döner",
  // panel arama motorlarına kapalı
  robots: { index: false, follow: false },
};

/**
 * Düzen artık dinamik.
 *
 * Kenar çubuğu rolü bilmek zorunda: personelin hiç açamayacağı ekranların
 * menüde durması, "bende neden çalışmıyor" ile geçen bir vardiya demek.
 * Oturum yoksa (giriş ekranı) en dar rol varsayılır — kabuk zaten o sayfada
 * menüyü hiç çizmiyor, ama varsayılanın en az yetki olması doğru olan.
 */
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  return <AdminShell role={session?.role ?? "STAFF"}>{children}</AdminShell>;
}
