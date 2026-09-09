import type { Metadata } from "next";
import { Unbounded, JetBrains_Mono, Inter } from "next/font/google";
import "./globals.css";
import SmoothScroll from "@/components/SmoothScroll";
import CartMount from "@/components/CartMount";
import { CartProvider } from "@/lib/cart";
import { FavoritesProvider } from "@/lib/account/FavoritesContext";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { BUSINESS_INFO } from "@/data/businessInfo";
import { SITE_URL } from "@/lib/site";
import { getLanguage } from "@/lib/i18n/server";

const display = Unbounded({
  subsets: ["latin"],
  weight: ["400", "600", "800", "900"],
  variable: "--font-display",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sami´s Döner // Straßkirchen — Dein Döner, dein Genuss",
  description:
    "Sami´s Döner in Straßkirchen: Frische Zutaten, 4.9 Google Bewertung, leckerer Döner & Spezialsoßen. Straubinger Str. 3, 94342 Straßkirchen.",
  metadataBase: new URL(SITE_URL),
  /* Paylaşım önizlemesi. Görselin kendisi `app/opengraph-image.tsx`
     dosyasından gelir; burada yalnızca onu çevreleyen metin var.
     `manifest` yazılmaz — `app/manifest.ts` bağlantıyı kendisi ekler,
     ikisi birden olsaydı sayfada iki `rel="manifest"` etiketi olurdu. */
  openGraph: {
    type: "website",
    locale: "de_DE",
    siteName: BUSINESS_INFO.name,
    title: "Sami´s Döner // Straßkirchen — Dein Döner, dein Genuss",
    description:
      "Frisch vom Drehspieß in Straßkirchen. Speisekarte ansehen und direkt online bestellen.",
    url: SITE_URL,
  },
  twitter: { card: "summary_large_image" },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Restaurant",
  name: BUSINESS_INFO.name,
  telephone: BUSINESS_INFO.phone,
  url: BUSINESS_INFO.mapsUrl,
  priceRange: BUSINESS_INFO.priceRange,
  servesCuisine: ["Döner", "Fast Food", "Imbiss"],
  address: {
    "@type": "PostalAddress",
    streetAddress: BUSINESS_INFO.address.street,
    addressLocality: BUSINESS_INFO.address.city,
    postalCode: BUSINESS_INFO.address.postalCode,
    addressRegion: BUSINESS_INFO.address.state,
    addressCountry: "DE",
  },
  geo: {
    "@type": "GeoCoordinates",
    latitude: BUSINESS_INFO.coordinates.lat,
    longitude: BUSINESS_INFO.coordinates.lng,
  },
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      opens: "11:00",
      closes: "21:00",
    },
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: "Sunday",
      opens: "12:00",
      closes: "21:00",
    },
  ],
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: String(BUSINESS_INFO.rating),
    reviewCount: String(BUSINESS_INFO.reviewCount),
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /* Dil çerezden okunur ve hem `<html lang>` hem sağlayıcının başlangıç
     değeri olur; böylece sunucu ile istemci ilk çizimde aynı dili kullanır.
     Metnin çoğu artık sunucu bileşenlerinde çözülüyor — bkz. lib/i18n/server.ts. */
  const lang = getLanguage();

  return (
    <html lang={lang} className={`${display.variable} ${mono.variable} ${body.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        <div className="grain-overlay" />
        <LanguageProvider initialLang={lang}>
          <CartProvider>
            {/* Favoriler sepetin İÇİNDE: kalp düğmesi menü satırında sepete
                ekleme düğmesinin yanında duruyor, ikisi aynı ağaçta olmalı.
                Oturum yoksa sağlayıcı kapalı kalır ve hiçbir şey çizmez. */}
            <FavoritesProvider>
              <SmoothScroll>{children}</SmoothScroll>
              {/* Sepet çekmecesi panelde çizilmez; bkz. components/CartMount.tsx. */}
              <CartMount />
            </FavoritesProvider>
          </CartProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
