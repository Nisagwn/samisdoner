import { describe, expect, it } from "vitest";
import {
  REVIEW_DELAY_MINUTES,
  REVIEW_WINDOW_DAYS,
  asksDeliveryRating,
  averageRating,
  displayName,
  isValidRating,
  reviewClosesAt,
  reviewEligibility,
  reviewOpensAt,
  type ReviewableOrder,
} from "@/lib/reviews/eligibility";
import {
  PRODUCT_REVIEW_LIMIT,
  groupReviewsByProduct,
  type ReviewWithOrder,
} from "@/lib/reviews/products";

/**
 * Değerlendirme uygunluğu.
 *
 * Buradaki kural ticari bir tercih değil, hukuki bir zorunluluk:
 * UWG § 5b Abs. 3 uyarınca tüketici değerlendirmesi yayımlayan işletme, bu
 * yorumların gerçekten üründen yararlanmış kişilerden geldiğini temin etmek
 * zorunda. Kuralın delindiği her durum, sitedeki "gerçek sipariş" iddiasını
 * yalan hâline getirir — bu yüzden testlerin çoğu "kabul ediyor mu" değil,
 * **"reddediyor mu"** sorusunu soruyor.
 */

const NOW = new Date("2026-09-15T20:00:00Z");

/** Teslim edilmiş, iki saat önce kapanmış bir teslimat siparişi. */
function order(patch: Partial<ReviewableOrder> = {}): ReviewableOrder {
  return {
    status: "DELIVERED",
    fulfillment: "DELIVERY",
    deliveredAt: new Date(NOW.getTime() - 2 * 60 * 60_000),
    createdAt: new Date(NOW.getTime() - 3 * 60 * 60_000),
    ...patch,
  };
}

describe("değerlendirme uygunluğu", () => {
  it("teslim edilmiş siparişe pencere içinde izin verir", () => {
    expect(reviewEligibility(order(), NOW, false)).toEqual({ ok: true });
  });

  it("gel-al siparişi de değerlendirilebilir", () => {
    // Teslim alınmış sipariş de yenmiş bir yemektir; yalnızca teslimat puanı
    // sorulmaz (bkz. aşağıdaki teslimat puanı testleri).
    expect(reviewEligibility(order({ status: "PICKED_UP" }), NOW, false)).toEqual({
      ok: true,
    });
  });

  it("henüz teslim edilmemiş siparişi reddeder", () => {
    for (const status of ["PAID", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] as const) {
      expect(reviewEligibility(order({ status }), NOW, false)).toEqual({
        ok: false,
        reason: "not_completed",
      });
    }
  });

  it("iptal edilen siparişi reddeder", () => {
    // Orada değerlendirilecek bir yemek hiç olmadı; şikâyetin yeri iade.
    for (const status of ["CANCELLED", "REJECTED", "EXPIRED"] as const) {
      expect(reviewEligibility(order({ status }), NOW, false)).toEqual({
        ok: false,
        reason: "not_completed",
      });
    }
  });

  it("kurye kapıdayken verilen puanı reddeder", () => {
    // Yemek daha yenmedi. Bekleme süresinin bir dakika altı hâlâ erken.
    const justDelivered = order({
      deliveredAt: new Date(NOW.getTime() - (REVIEW_DELAY_MINUTES - 1) * 60_000),
    });
    expect(reviewEligibility(justDelivered, NOW, false)).toEqual({
      ok: false,
      reason: "too_early",
    });
  });

  it("bekleme süresi dolduğu anda açılır", () => {
    const ripe = order({
      deliveredAt: new Date(NOW.getTime() - REVIEW_DELAY_MINUTES * 60_000),
    });
    expect(reviewEligibility(ripe, NOW, false)).toEqual({ ok: true });
  });

  it("pencere kapandıktan sonra reddeder", () => {
    const stale = order({
      deliveredAt: new Date(
        NOW.getTime() - (REVIEW_WINDOW_DAYS * 24 * 60 + 1) * 60_000
      ),
    });
    expect(reviewEligibility(stale, NOW, false)).toEqual({
      ok: false,
      reason: "window_closed",
    });
  });

  it("aynı siparişe ikinci değerlendirmeyi reddeder", () => {
    expect(reviewEligibility(order(), NOW, true)).toEqual({
      ok: false,
      reason: "already_reviewed",
    });
  });

  it("zaten yazılmış olmak, erken olmaktan önce gelir", () => {
    // Sıra önemli: "henüz erken" diyen bir cevap, müşteriye sonradan tekrar
    // deneyebileceğini söyler — oysa yazmış olduğu için hiç yazamayacak.
    const justDelivered = order({ deliveredAt: NOW });
    expect(reviewEligibility(justDelivered, NOW, true)).toEqual({
      ok: false,
      reason: "already_reviewed",
    });
  });

  it("teslim tarihi boş olan eski kayıtta sipariş tarihine düşer", () => {
    const legacy = order({
      deliveredAt: null,
      createdAt: new Date(NOW.getTime() - 3 * 60 * 60_000),
    });
    expect(reviewEligibility(legacy, NOW, false)).toEqual({ ok: true });
  });
});

describe("değerlendirme penceresi", () => {
  it("açılış anı teslim + bekleme süresidir", () => {
    const delivered = new Date("2026-09-15T18:00:00Z");
    expect(reviewOpensAt(order({ deliveredAt: delivered })).toISOString()).toBe(
      new Date(delivered.getTime() + REVIEW_DELAY_MINUTES * 60_000).toISOString()
    );
  });

  it("kapanış anı teslim + 14 gündür", () => {
    const delivered = new Date("2026-09-01T18:00:00Z");
    expect(reviewClosesAt(order({ deliveredAt: delivered })).toISOString()).toBe(
      new Date("2026-09-15T18:00:00Z").toISOString()
    );
  });
});

describe("teslimat puanı", () => {
  it("yalnızca teslimat siparişinde sorulur", () => {
    expect(asksDeliveryRating("DELIVERY")).toBe(true);
  });

  it("gel-al siparişinde sorulmaz", () => {
    // Olmayan bir teslimata puan vermek zorunda bırakmak, ortalamayı ölçülen
    // şeyin olmadığı değerlerle kirletirdi.
    expect(asksDeliveryRating("PICKUP")).toBe(false);
  });
});

describe("puan doğrulaması", () => {
  it("1–5 arası tam sayıyı kabul eder", () => {
    for (const value of [1, 2, 3, 4, 5]) expect(isValidRating(value)).toBe(true);
  });

  it("aralık dışını, ondalığı ve sayı olmayanı reddeder", () => {
    for (const value of [0, 6, -1, 4.5, "5", null, undefined, NaN]) {
      expect(isValidRating(value)).toBe(false);
    }
  });
});

describe("ortalama puan", () => {
  it("tek ondalık basamağa yuvarlar", () => {
    // İki basamak, yüz yorumluk bir örneklemde karşılığı olmayan bir kesinlik
    // iddiasıdır.
    expect(averageRating([5, 5, 5, 4])).toBe(4.8);
    expect(averageRating([5, 4, 4])).toBe(4.3);
  });

  it("hiç yorum yoksa null döner, sıfır değil", () => {
    // Sıfır puanlı bir restoran gibi görünmektense hiç puan göstermemek doğru.
    expect(averageRating([])).toBeNull();
  });

  it("tek yorumda o yorumun puanını verir", () => {
    expect(averageRating([3])).toBe(3);
  });
});

describe("yayımlanan ad", () => {
  it("soyadı baş harfe indirger", () => {
    // Tam ad, o kişiyi tanıyan herkes için "o akşam ne yedi" kaydıdır.
    expect(displayName("Mehmet Yılmaz", true)).toBe("Mehmet Y.");
  });

  it("tek isimde olduğu gibi bırakır", () => {
    expect(displayName("Sami", true)).toBe("Sami");
  });

  it("çok parçalı adda yalnızca son parçayı kısaltır", () => {
    expect(displayName("Ayşe Nur Demir", true)).toBe("Ayşe Nur D.");
  });

  it("ad yoksa dile göre nötr bir karşılık kullanır", () => {
    // E-posta adresi hiçbir koşulda görünmemeli.
    expect(displayName("", true)).toBe("Gast");
    expect(displayName("   ", false)).toBe("Misafir");
  });
});

/* ────────────────────────────────── ürüne dağıtılan sipariş puanları */

/**
 * Ürün penceresindeki puan.
 *
 * Buradaki tek iddia şu: gösterilen sayı "bu ürünü içeren siparişlerin
 * ortalaması"dır. Sınanan kurallar, o iddiayı yalan hâline getirebilecek üç
 * durum — bir siparişin ortalamaya iki kez girmesi, gizlenmiş bir yorumun
 * sayılması (veri katmanı süzüyor, burada kaynağa hiç girmiyor) ve yorumsuz
 * bir puanın listede metinsiz bir kutu olarak görünmesi.
 */

function review(patch: Partial<ReviewWithOrder> = {}): ReviewWithOrder {
  return {
    id: "r1",
    orderId: "o1",
    authorName: "Nisa G.",
    foodRating: 5,
    deliveryRating: 5,
    comment: "çok iyi",
    reply: "",
    createdAt: "2026-09-15T18:00:00.000Z",
    ...patch,
  };
}

describe("sipariş puanlarının ürünlere dağıtılması", () => {
  it("siparişteki her ürüne siparişin puanını yazar", () => {
    const index = groupReviewsByProduct(
      [review({ foodRating: 4 })],
      [
        { orderId: "o1", productId: "doener" },
        { orderId: "o1", productId: "ayran" },
      ]
    );

    expect(index.doener.average).toBe(4);
    expect(index.ayran.average).toBe(4);
    expect(index.doener.count).toBe(1);
  });

  it("aynı ürün siparişte iki satırdaysa puanı bir kez sayar", () => {
    // Üç dürüm söyleyen bir müşteri üç müşteri gibi sayılmamalı.
    const index = groupReviewsByProduct(
      [review({ foodRating: 2 })],
      [
        { orderId: "o1", productId: "doener" },
        { orderId: "o1", productId: "doener" },
      ]
    );

    expect(index.doener.count).toBe(1);
    expect(index.doener.average).toBe(2);
  });

  it("ürüne bağlı olmayan satırı yok sayar", () => {
    const index = groupReviewsByProduct([review()], [{ orderId: "o1", productId: null }]);
    expect(index).toEqual({});
  });

  it("başka siparişin satırına puan yazmaz", () => {
    const index = groupReviewsByProduct([review({ orderId: "o1" })], [
      { orderId: "o2", productId: "doener" },
    ]);
    expect(index).toEqual({});
  });

  it("yorumsuz değerlendirme ortalamaya girer ama listede görünmez", () => {
    const index = groupReviewsByProduct(
      [
        review({ id: "r1", orderId: "o1", foodRating: 5, comment: "" }),
        review({ id: "r2", orderId: "o2", foodRating: 3, comment: "idare eder" }),
      ],
      [
        { orderId: "o1", productId: "doener" },
        { orderId: "o2", productId: "doener" },
      ]
    );

    expect(index.doener.count).toBe(2);
    expect(index.doener.average).toBe(4);
    expect(index.doener.items.map((item) => item.id)).toEqual(["r2"]);
  });

  it("listeyi üst sınırda keser, ortalamayı kesmez", () => {
    const many = Array.from({ length: PRODUCT_REVIEW_LIMIT + 3 }, (_, i) =>
      review({ id: `r${i}`, orderId: `o${i}` })
    );
    const lines = many.map((item) => ({ orderId: item.orderId, productId: "doener" }));

    const index = groupReviewsByProduct(many, lines);

    expect(index.doener.items).toHaveLength(PRODUCT_REVIEW_LIMIT);
    expect(index.doener.count).toBe(many.length);
  });

  it("hiç değerlendirme yoksa boş dizin döner", () => {
    expect(groupReviewsByProduct([], [{ orderId: "o1", productId: "doener" }])).toEqual({});
  });
});
