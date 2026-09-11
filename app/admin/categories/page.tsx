import { redirect } from "next/navigation";

/** Eski kategori adresi — artık menü ekranının kategori sekmesi. */
export default function AdminCategoriesRedirect() {
  redirect("/admin/menu?sekme=kategoriler");
}
