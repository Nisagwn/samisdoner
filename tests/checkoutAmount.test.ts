import { describe, expect, it } from "vitest";
import type { PricedLine } from "@/lib/admin/store";
import { checkoutAmountOf } from "@/lib/payments/provider";
import { composeTotals } from "@/lib/orders/totals";

/**
 * Tahsil edilen tutar ile siparişe yazılan tutarın aynılığı.
 *
 * İki ayrı hesap var ve ikisi de aynı sayıyı vermek zorunda:
 *
 *  - `composeTotals` — katalog fiyatlarından siparişin toplamını kurar,
 *    `Order.totalCents` olarak dondurur. Kapıda ödemede kuryenin isteyeceği
 *    tutar da budur.
 *  - `checkoutAmountOf` — ödeme sağlayıcısına gönderilecek kalemlerden
 *    (satırlar + ücret + bahşiş − indirim) toplamı kurar.
 *
 * Ayrıştıkları gün müşteriden ekranda yazandan başka bir tutar çekilir ve fark
 * ancak muhasebede görülür. Bu yüzden eşitlik kupon, bahşiş ve ücretlerin
 * bütün birleşimlerinde sınanıyor — tek bir senaryo, kuruş artığının nereye
 * gittiğini yakalamaya yetmiyor.
 */

function line(overrides: Partial<PricedLine> = {}): PricedLine {
  return {
    key: "k",
    input: { kind: "product", productId: "p", qty: 1 },
    label: "Döner",
    detail: "",
    unitCents: 700,
    lineCents: 700,
    qty: 1,
    vatRate: 7,
    unavailable: false,
    ...overrides,
  };
}

/** %7 yemek + %19 içecek; ara toplam 1700. */
const lines: PricedLine[] = [
  line({ key: "a", unitCents: 700, lineCents: 1400, qty: 2, vatRate: 7 }),
  line({ key: "b", label: "Cola", unitCents: 300, lineCents: 300, qty: 1, vatRate: 19 }),
];
const SUBTOTAL = 1700;

/** `createOrderAction`'ın sağlayıcıya gönderdiği kalemlerin aynısı. */
const asCheckoutLines = (source: PricedLine[]) =>
  source.map((l) => ({ label: l.label, detail: l.detail, unitCents: l.unitCents, qty: l.qty }));

describe("sipariş toplamı = sağlayıcıya gönderilen tutar", () => {
  const cases = [
    { name: "sade", serviceFeeCents: 0, deliveryFeeCents: 0, discountCents: 0, tipCents: 0 },
    { name: "ücretli", serviceFeeCents: 149, deliveryFeeCents: 250, discountCents: 0, tipCents: 0 },
    { name: "kuponlu", serviceFeeCents: 149, deliveryFeeCents: 250, discountCents: 333, tipCents: 0 },
    { name: "bahşişli", serviceFeeCents: 149, deliveryFeeCents: 250, discountCents: 0, tipCents: 199 },
    {
      name: "kupon + bahşiş",
      serviceFeeCents: 149,
      deliveryFeeCents: 250,
      discountCents: 333,
      tipCents: 199,
    },
    {
      name: "kupon sepeti sıfırlıyor + bahşiş",
      serviceFeeCents: 0,
      deliveryFeeCents: 0,
      discountCents: SUBTOTAL,
      tipCents: 500,
    },
    {
      name: "kuruşlu birleşim",
      serviceFeeCents: 99,
      deliveryFeeCents: 1,
      discountCents: 1,
      tipCents: 1,
    },
  ];

  for (const input of cases) {
    it(input.name, () => {
      const totals = composeTotals({ lines, subtotalCents: SUBTOTAL, ...input });

      /*
       * `createOrderAction` ücretleri sağlayıcıya tek satır olarak gönderiyor
       * (servis + kurye), bahşişi ve indirimi ayrı alanlarda taşıyor.
       */
      const requested = checkoutAmountOf({
        lines: asCheckoutLines(lines),
        feeCents: totals.serviceFeeCents + totals.deliveryFeeCents,
        tipCents: totals.tipCents,
        discountCents: totals.discountCents,
      });

      expect(requested).toBe(totals.totalCents);
    });
  }

  /*
   * Kapıda ödemede sağlayıcıya hiç gidilmiyor; kuryenin isteyeceği tutar
   * doğrudan `Order.totalCents`. Online yolla aynı sayıyı vermesi gerekiyor,
   * yoksa aynı sepet iki ödeme yönteminde iki farklı tutar eder.
   */
  it("kapıda ödemede istenecek tutar, online tahsil edilecek tutarla aynıdır", () => {
    const input = { serviceFeeCents: 149, deliveryFeeCents: 250, discountCents: 333, tipCents: 199 };
    const totals = composeTotals({ lines, subtotalCents: SUBTOTAL, ...input });

    const online = checkoutAmountOf({
      lines: asCheckoutLines(lines),
      feeCents: totals.serviceFeeCents + totals.deliveryFeeCents,
      tipCents: totals.tipCents,
      discountCents: totals.discountCents,
    });

    // Kapıda ödemede müşteriye gösterilen tutar (bkz. takip sayfası).
    const atTheDoor = totals.totalCents;

    expect(atTheDoor).toBe(online);
    expect(atTheDoor).toBe(1700 + 149 + 250 - 333 + 199);
  });

  /*
   * Bahşiş KDV matrahının dışında (Abschn. 10.1 Abs. 5 UStAE) ama tahsil
   * edilen tutarın içinde. Bu iki cümlenin aynı anda doğru kalması, para
   * hesabının kupon ve bahşişten sonra da tutarlı olmasının özü.
   */
  it("bahşiş tahsilata girer, KDV matrahına girmez", () => {
    const totals = composeTotals({
      lines,
      subtotalCents: SUBTOTAL,
      serviceFeeCents: 149,
      deliveryFeeCents: 250,
      discountCents: 333,
      tipCents: 199,
    });

    const gross = totals.vatBreakdown.reduce((sum, b) => sum + b.grossCents, 0);
    expect(gross).toBe(totals.totalCents - 199);

    const requested = checkoutAmountOf({
      lines: asCheckoutLines(lines),
      feeCents: totals.serviceFeeCents + totals.deliveryFeeCents,
      tipCents: totals.tipCents,
      discountCents: totals.discountCents,
    });
    expect(requested).toBe(gross + 199);
  });
});
