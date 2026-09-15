import { redirect } from "next/navigation";
import { getAdminSession } from "./guard";
import { can, type AdminPermission } from "./roles";

/**
 * Panel sayfaları için yetki kapısı.
 *
 * Menüden bağlantıyı kaldırmak bir kolaylıktır, koruma değil: adresi doğrudan
 * yazan ya da eski bir yer imini açan biri sayfayı yine görür. Bu yüzden her
 * korumalı sayfa açılışında burayı çağırır.
 *
 * İki farklı yönlendirme, iki farklı durum:
 *  - **Oturum yok** → giriş ekranı, geri dönülecek adresle birlikte.
 *  - **Oturum var, yetki yok** → panelin ana ekranı. Giriş ekranına atmak,
 *    parolası çalışan bir personele "parolan bozuldu" dedirtirdi.
 *
 * Uçların kendi kontrolü ayrıca duruyor (bkz. requirePermission): sayfa
 * çizilmese bile veri yazan uç korunmasız kalmamalı.
 */
export async function requirePanel(permission: AdminPermission) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (!can(session.role, permission)) redirect("/admin");
  return session;
}
