import LoginForm from "@/components/admin/LoginForm";
import { readRecoveryFlag, sharedPasswordMode, type SharedPasswordMode } from "@/lib/admin/recovery";
import { countOwners } from "@/lib/admin/staff";

export const dynamic = "force-dynamic";

/**
 * Giriş ekranı, sunucuda hangi yolun açık olduğuna bakarak çizilir.
 *
 * Form iki yolu birden göstermez. Panelde hiç sahip hesabı yoksa ekran "ilk
 * kurulum" olur ve yalnızca kurulum parolası sorulur; hesap açıldıktan sonra
 * ekranda yalnızca e-posta + parola kalır. Böylece giriş ekranına bakan kişi
 * her zaman **tek bir yol** görür — "iki ayrı admin girişi" görüntüsü buradan
 * çıkıyordu.
 */
export default async function AdminLoginPage() {
  let mode: SharedPasswordMode = "closed";
  try {
    mode = sharedPasswordMode({
      activeOwners: await countOwners(),
      recoveryFlag: readRecoveryFlag(process.env.ADMIN_RECOVERY),
      passwordConfigured: Boolean(process.env.ADMIN_PASSWORD),
    });
  } catch {
    /*
     * Veritabanı okunamıyorsa olağan ekran çizilir.
     *
     * Ters tercih tehlikeli olurdu: sorgu hatasında "ilk kurulum" gösterilseydi
     * veritabanı kopukken herkese kurulum parolası sorulan bir ekran çıkardı ve
     * bu, hesapların silindiği izlenimini verirdi. Kurulum parolası zaten uçta
     * ayrıca denetleniyor; ekranın yanılması yetki vermez.
     */
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-16 bg-void">
      <LoginForm mode={mode} />
    </div>
  );
}
