import { buildVatBreakdown, type PricedLine, type VatBucket } from "@/lib/admin/store";

/**
 * Sipariş toplamının **tek** bileşimi.
 *
 * `buildCheckoutQuote` (ekranda gösterilen tutar) ve `createOrder` (siparişe
 * dondurulan tutar) bu fonksiyonu çağırır. İki yerde iki toplama işlemi
 * olsaydı, kupon ya da bahşiş eklenirken biri güncellenip diğeri unutulabilir
 * ve ekranda yazan tutarla tahsil edilen tutar sessizce ayrışabilirdi.
 *
 * FORMÜL
 *
 *   toplam = ara toplam + servis + kurye − indirim + bahşiş
 *
 * KDV DÖKÜMÜ VE BAHŞİŞ
 *
 * Döküm `toplam − bahşiş` üzerinden kurulur. Bahşişin dışarıda kalması bir
 * basitleştirme değil, kuralın kendisi: Abschn. 10.1 Abs. 5 UStAE uyarınca
 * personele gönüllü verilen bahşiş işletmenin edimi için ödenen bedelin
 * parçası değildir, dolayısıyla KDV matrahına girmez (bkz. lib/orders/tip.ts).
 *
 * KDV DÖKÜMÜ VE İNDİRİM
 *
 * İndirim **matrahı düşürür**: müşteri yemeğe daha az ödemiştir, dolayısıyla
 * daha az KDV doğar. Ücretler gibi indirim de satır tutarlarına oransal
 * dağıtılır — %7'lik yemek ile %19'luk içeceğin karışık olduğu bir sepette
 * indirimin tamamını tek orana yıkmak, iki oranın matrahını da yanlış yazardı.
 * Dağıtımı `buildVatBreakdown` yapıyor; buraya ücretlerle indirimin **net**
 * farkı tek bir sayı olarak verilir, kuruş artığı orada zaten en büyük paya
 * gidiyor.
 *
 * DEĞİŞMEZ (invariant)
 *
 *   Σ vatBreakdown[].grossCents === totalCents − tipCents
 *
 * Bu eşitlik `tests/totals.test.ts` içinde doğrudan sınanır; bozulduğu gün
 * fatura ile tahsilat ayrışmış demektir.
 */

export type OrderTotals = {
  subtotalCents: number;
  serviceFeeCents: number;
  deliveryFeeCents: number;
  /** Kupon indirimi, pozitif cent. Toplamdan düşülür. */
  discountCents: number;
  /** Bahşiş, pozitif cent. Toplama eklenir, KDV matrahına girmez. */
  tipCents: number;
  totalCents: number;
  vatBreakdown: VatBucket[];
};

export function composeTotals(input: {
  lines: PricedLine[];
  subtotalCents: number;
  serviceFeeCents: number;
  deliveryFeeCents: number;
  discountCents?: number;
  tipCents?: number;
}): OrderTotals {
  const subtotalCents = Math.max(0, Math.round(input.subtotalCents));
  const serviceFeeCents = Math.max(0, Math.round(input.serviceFeeCents));
  const deliveryFeeCents = Math.max(0, Math.round(input.deliveryFeeCents));

  /*
   * İndirim burada da kelepçelenir, `discountFor` içinde kelepçelenmiş
   * olmasına rağmen. Bu fonksiyon indirimin nereden geldiğini bilmez ve
   * bilmemeli; ara toplamı aşan bir indirim negatif bir KDV matrahı üretir ve
   * o hata faturaya kadar sessizce gider.
   */
  const discountCents = Math.min(subtotalCents, Math.max(0, Math.round(input.discountCents ?? 0)));
  const tipCents = Math.max(0, Math.round(input.tipCents ?? 0));

  // Satır tutarlarına oransal dağıtılacak net yan edim. İndirim eksi işaretli
  // girer; dağıtım matematiği işaretten bağımsız çalışır.
  const taxableExtraCents = serviceFeeCents + deliveryFeeCents - discountCents;

  return {
    subtotalCents,
    serviceFeeCents,
    deliveryFeeCents,
    discountCents,
    tipCents,
    totalCents: subtotalCents + taxableExtraCents + tipCents,
    vatBreakdown: buildVatBreakdown(input.lines, taxableExtraCents),
  };
}
