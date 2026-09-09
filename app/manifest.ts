import type { MetadataRoute } from "next";
import { BUSINESS_INFO } from "@/data/businessInfo";

/**
 * Web uygulaması bildirimi.
 *
 * Müşterinin siteyi ana ekrana eklemesi için gereken asgari dosya. `standalone`
 * bilinçli değil — sipariş akışı Stripe'ın barındırdığı sayfaya çıkıp geri
 * dönüyor; tarayıcı çubuğu olmayan bir kabukta müşteri adres çubuğundaki
 * `stripe.com` alan adını göremez ve ödeme sayfasının gerçekliğini
 * doğrulayamaz. `browser` görüntüsü bu güveni korur.
 *
 * `start_url` menüdür, ana sayfa değil: simgeye basan kişi zaten karar vermiş,
 * onu tanıtım sayfasının en üstüne bırakmak bir kaydırma fazlası demek.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BUSINESS_INFO.name} — ${BUSINESS_INFO.address.city}`,
    short_name: "Sami´s Döner",
    description:
      "Sami´s Döner Straßkirchen: Speisekarte ansehen und direkt online bestellen.",
    start_url: "/speisekarte",
    display: "browser",
    background_color: "#070604",
    theme_color: "#070604",
    lang: "de",
    categories: ["food", "shopping"],
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
    ],
  };
}
