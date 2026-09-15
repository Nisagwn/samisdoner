/**
 * Ortak parolanın (`ADMIN_PASSWORD`) ne zaman geçerli olduğu.
 *
 * Panelde iki giriş yolu vardı ve ikisi de her zaman açıktı: kişisel hesap ve
 * `.env` içindeki ortak parola. İkincisi canlıda **kalıcı bir arka kapıdır** —
 * parolayı bir kez öğrenen (eski bir çalışan, sunucuya bakmış bir kişi, yanlış
 * yere yapıştırılmış bir mesaj) kimliği belirsiz bir OWNER olarak girer ve
 * panelde yaptığı hiçbir iş kimseye yazılmaz. Giriş ekranında görünür bir
 * "ortak parolayla gir" seçeneği ayrıca kişisel hesabı olan personeli de o
 * yola çeker.
 *
 * Bu yüzden ortak parola bir giriş yöntemi değil, **kurulum anahtarı** olarak
 * ele alınır: yalnızca panelde hiç etkin sahip hesabı yokken çalışır. İşletmeci
 * kendi hesabını açtığı an yol kendiliğinden kapanır — kapatmayı kimsenin
 * hatırlaması gerekmez.
 *
 * Kilitlenme durumu (tek sahip hesabının parolası unutuldu) için yol elle
 * açılır: sunucuda `ADMIN_RECOVERY=1` tanımlanır. Bunu yapabilen kişi zaten
 * sunucuya erişebilen kişidir; yani kurtarma, erişimi olmayan birine yeni bir
 * kapı açmaz. İş bitince değişken kaldırılır.
 */

export type SharedPasswordMode =
  /** Hiç sahip hesabı yok: ekran ilk kurulum kipinde, ortak parola çalışır. */
  | "setup"
  /** Sahip hesabı var ama `ADMIN_RECOVERY` açık: ortak parola geçici olarak çalışır. */
  | "recovery"
  /** Olağan hâl: yalnızca e-posta + parola. */
  | "closed";

export type SharedPasswordInput = {
  /** Etkin OWNER rollü hesap sayısı. */
  activeOwners: number;
  /** `ADMIN_RECOVERY` ortam değişkeni açık mı. */
  recoveryFlag: boolean;
  /** `ADMIN_PASSWORD` sunucuda tanımlı mı. */
  passwordConfigured: boolean;
};

export function sharedPasswordMode({
  activeOwners,
  recoveryFlag,
  passwordConfigured,
}: SharedPasswordInput): SharedPasswordMode {
  // Parola tanımlı değilse yol yok: açık bırakılmış bir kapı sanılmasın.
  if (!passwordConfigured) return "closed";
  if (activeOwners === 0) return "setup";
  return recoveryFlag ? "recovery" : "closed";
}

/** Ortam değişkeninin "açık" sayıldığı değerler. */
export function readRecoveryFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}
