"use client";

import type { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * Ödeme yöntemi seçimi.
 *
 * Referans (Uber Eats DE, Lieferando): yöntem **sipariş onaylanmadan önce**
 * gösterilir ve kapıda ödeme yalnızca işletme açtıysa görünür. Bizde kapıda
 * ödemenin anahtarı `Settings.cashEnabled`: nakit ve kapıda kart aynı kapıdan
 * geçiyor, çünkü işletme açısından ikisinin anlamı aynı — para teslim anında,
 * personelin elinden alınıyor.
 *
 * Buradaki gizleme bir **kolaylıktır, kural değil**: seçilen yöntemin gerçekten
 * açık olduğu sipariş oluşturulurken sunucuda yeniden denetlenir. Gizlenmiş bir
 * seçenek yetki kontrolü değildir.
 *
 * Gel-al ile teslimatta aynı yöntemler geçerli, yalnız açıklama metni değişir:
 * "kurye kart okuyucuyla geliyor" cümlesi, siparişi kendi gelip alacak bir
 * müşteriye anlamsız gelir.
 */

export type PaymentMethodChoice = "ONLINE" | "CASH" | "CARD_ON_DELIVERY";

export function PaymentMethodPicker({
  value,
  onChange,
  onSiteEnabled,
  isDelivery,
  t,
}: {
  value: PaymentMethodChoice;
  onChange: (next: PaymentMethodChoice) => void;
  /** Kapıda ödeme açık mı; sunucudan gelir. */
  onSiteEnabled: boolean;
  isDelivery: boolean;
  t: ReturnType<typeof useLanguage>["t"];
}) {
  const f = t.orderFlow;

  return (
    <fieldset className="space-y-2">
      <legend className="tag mb-2 text-smoke">{f.paymentTitle}</legend>

      <MethodOption
        name="paymentMethod"
        selected={value === "ONLINE"}
        onSelect={() => onChange("ONLINE")}
        title={f.paymentOnline}
        hint={f.paymentOnlineHint}
      />

      {onSiteEnabled && (
        <>
          <MethodOption
            name="paymentMethod"
            selected={value === "CASH"}
            onSelect={() => onChange("CASH")}
            title={f.paymentCash}
            hint={isDelivery ? f.paymentCashHint : f.paymentCashPickupHint}
          />
          <MethodOption
            name="paymentMethod"
            selected={value === "CARD_ON_DELIVERY"}
            onSelect={() => onChange("CARD_ON_DELIVERY")}
            title={f.paymentCard}
            hint={isDelivery ? f.paymentCardHint : f.paymentCardPickupHint}
          />
        </>
      )}
    </fieldset>
  );
}

/**
 * Tek bir ödeme yöntemi.
 *
 * Gerçek bir `<input type="radio">` kullanılıyor: yöntem seçimi tam olarak
 * radyo grubunun anlattığı şey ve klavye ile ok tuşlarıyla gezinme bedava
 * geliyor. Etiketin tamamı tıklanabilir, dokunma hedefi kutu kadar.
 */
function MethodOption({
  name,
  selected,
  onSelect,
  title,
  hint,
}: {
  name: string;
  selected: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
}) {
  return (
    <label
      className={[
        "flex min-h-[56px] cursor-pointer items-start gap-3 border px-4 py-3 transition-colors",
        selected ? "border-amber bg-amber/10" : "border-line hover:border-amber/60",
      ].join(" ")}
    >
      <input
        type="radio"
        name={name}
        checked={selected}
        onChange={onSelect}
        className="mt-1 h-4 w-4 shrink-0 accent-amber"
      />
      <span className="min-w-0">
        <span
          className={`block font-display text-sm font-extrabold ${selected ? "text-amber" : "text-bone"}`}
        >
          {title}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-smoke">{hint}</span>
      </span>
    </label>
  );
}
