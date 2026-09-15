import type { Metadata } from "next";
import { redirect } from "next/navigation";
import StaffManager from "@/components/admin/StaffManager";
import { getAdminSession } from "@/lib/admin/guard";
import { can } from "@/lib/admin/roles";
import { listStaff } from "@/lib/admin/staff";

/**
 * Personel ekranı.
 *
 * Yetki kontrolü sayfada da var, uçta da: menüde bağlantıyı gizlemek bir
 * kolaylıktır, koruma değil — adresi doğrudan yazan biri sayfayı açabilirdi.
 * Yetkisiz kullanıcı giriş ekranına değil panele döner; oturumu geçerli,
 * yalnızca bu iş onun değil.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Personel // Panel",
  robots: { index: false, follow: false },
};

export default async function AdminStaffPage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login?next=/admin/personal");
  if (!can(session.role, "staff")) redirect("/admin");

  return <StaffManager initial={await listStaff()} currentUserId={session.userId} />;
}
