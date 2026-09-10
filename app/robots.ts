import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Tarayıcı robotları.
 *
 * Kapatılan yollar tanıtım değil **iş** yüzeyleridir ve dizine girmeleri ya
 * zararlı ya anlamsız olurdu:
 *  - `/admin`  — panel; giriş zaten korumalı ama arama sonucunda görünmesi
 *                saldırganın işini kolaylaştırmaktan başka bir şey yapmaz.
 *  - `/konto`  — kişiye özel sayfalar.
 *  - `/checkout` — boş sepetle açıldığında menüye yönlendiren geçici bir sayfa.
 *  - `/bestellung/` — imzalı jetonlu takip bağlantıları; jeton adresin içinde
 *                taşınıyor, dizine girerse sipariş başkasının eline geçer.
 *  - `/api/`  — makine uçları.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/konto", "/checkout", "/bestellung/", "/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
