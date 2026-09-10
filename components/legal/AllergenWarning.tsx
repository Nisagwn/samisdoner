"use client";

import { BUSINESS_INFO } from "@/data/businessInfo";
import { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * Alerjen uyarısı — sitenin **tek** alerjen bildirimi.
 *
 * Önceden bu bilgi üç ayrı yerde yaşıyordu: her ürün satırının altında harf ve
 * rakam kodları, kartanın sonunda 28 satırlık bir kod açıklaması ve ürün
 * bazında ayrı bir `/allergene` sayfası. Üçü de panelden ürün ürün doldurulan
 * bir tabloya bağlıydı; yüzden fazla satırın hepsini tek tek işaretlemek
 * pratikte hiç bitmiyor, bitmediği için de menüde en çok görünen şey "lütfen
 * sorunuz" uyarısı oluyordu. Her ürüne yapıştırılmış bir uyarı, hiçbir ürünü
 * ayırt etmediği an uyarı olmaktan çıkar.
 *
 * Onun yerine tek bir yer: menünün altı ve sipariş sayfasının altı. Ağır
 * alerjisi olan müşterinin ihtiyacı zaten bir harf listesi değil,
 * **arayabileceği bir numara** — bu yüzden telefon uyarının içinde ve
 * tıklanabilir duruyor.
 *
 * `tone` yalnızca çerçeveyi değiştirir, metni değiştirmez:
 *  - `"quiet"` kartanın altındaki sakin not,
 *  - `"strong"` sipariş sayfasındaki, sözleşme kurulmadan önce okunması
 *    gereken vurgulu blok (LMIV Art. 14 bu bilgiyi sipariş bağlayıcı hâle
 *    gelmeden önce ister).
 */
export default function AllergenWarning({
  tone = "quiet",
  className = "",
}: {
  tone?: "quiet" | "strong";
  className?: string;
}) {
  const { lang } = useLanguage();
  const de = lang === "de";

  const strong = tone === "strong";

  return (
    <section
      aria-labelledby="allergen-warning-title"
      className={`${
        strong
          ? "border border-amber/50 bg-amber/[0.06] px-4 py-4"
          : "border-t border-line pt-6"
      } ${className}`}
    >
      <h2
        id="allergen-warning-title"
        className={`font-display text-sm font-bold ${strong ? "text-amber" : "text-amber"}`}
      >
        {de ? "Allergene und Zusatzstoffe" : "Alerjenler ve katkı maddeleri"}
      </h2>

      <p className="mt-2 max-w-[80ch] text-xs leading-relaxed text-smoke">
        {de
          ? "Unsere Speisen können Allergene nach Anhang II der LMIV (VO (EU) Nr. 1169/2011) sowie kennzeichnungspflichtige Zusatzstoffe nach ZZulV enthalten. In unserer Küche werden viele Zutaten gemeinsam verarbeitet; Spuren weiterer allergener Stoffe lassen sich trotz sorgfältiger Arbeit nicht ausschließen."
          : "Yemeklerimiz LMIV (AB 1169/2011) Ek II kapsamındaki alerjenleri ve ZZulV uyarınca bildirimi zorunlu katkı maddelerini içerebilir. Mutfağımızda birçok malzeme birlikte işlendiği için, özenli çalışmaya rağmen diğer alerjenlerin eser miktarda bulunması dışlanamaz."}
      </p>

      <p className="mt-2.5 max-w-[80ch] text-xs leading-relaxed text-bone">
        {de
          ? "Angaben zu einzelnen Speisen erhalten Sie kostenlos vor Ihrer Bestellung — rufen Sie uns bitte an: "
          : "Tek tek ürünlere ait bilgiyi siparişinizden önce ücretsiz olarak veriyoruz — lütfen bizi arayın: "}
        <a
          href={BUSINESS_INFO.phoneTel}
          className="whitespace-nowrap text-amber underline transition-colors hover:text-flame"
        >
          {BUSINESS_INFO.formattedPhone}
        </a>
      </p>
    </section>
  );
}
