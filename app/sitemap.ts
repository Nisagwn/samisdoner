import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Site haritası.
 *
 * Yalnızca herkese açık ve kalıcı sayfalar. Sipariş akışının rotaları
 * (`/checkout`, `/bestellung/…`, `/konto`, `/admin`) burada yok; `robots.ts`
 * onları ayrıca kapatıyor.
 *
 * `priority` bilinçli olarak dar bir aralıkta: menü sipariş verilen sayfadır,
 * ana sayfa onun kapısıdır, yasal metinler ise arananmadıkları hâlde bulunmak
 * zorundadır (§ 5 TMG). Tarihler derleme anına sabitlenir — sayfalar
 * içeriklerini istekte katalogdan aldığı için dosya tarihi bir şey söylemez.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const entry = (
    path: string,
    priority: number,
    changeFrequency: "daily" | "weekly" | "monthly" | "yearly"
  ) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  });

  return [
    entry("/", 1, "weekly"),
    entry("/speisekarte", 0.9, "daily"),
    entry("/ueber-uns", 0.6, "monthly"),
    entry("/impressum", 0.3, "yearly"),
    entry("/datenschutz", 0.3, "yearly"),
    entry("/agb", 0.3, "yearly"),
    entry("/widerruf", 0.3, "yearly"),
  ];
}
