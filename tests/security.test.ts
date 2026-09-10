import { describe, expect, it } from "vitest";
import { createOrderToken, verifyOrderToken } from "@/lib/orders/token";
import {
  createCustomerToken,
  verifyCustomerToken,
} from "@/lib/account/session";
import {
  hashPassword,
  needsRehash,
  passwordProblem,
  verifyPassword,
} from "@/lib/account/password";
import { hashToken } from "@/lib/account/passwordReset";
import { parseCartLines, parseLang } from "@/lib/cartLines";

/**
 * Güvenlik testleri.
 *
 * Her test bir saldırı senaryosunu taklit eder. "Doğru girdide çalışıyor mu"
 * sorusu buradaki asıl soru değil; asıl soru "kurcalanmış girdide çalışmıyor
 * mu".
 */

/* ══════════════════════════════════════════ sipariş takip jetonu */

describe("sipariş takip jetonu", () => {
  it("üretilen jeton doğrulanır ve sipariş numarasını verir", async () => {
    const token = await createOrderToken("SD-260908-001");
    expect(await verifyOrderToken(token)).toBe("SD-260908-001");
  });

  it("imzasız sipariş numarası kabul edilmez", async () => {
    // Numaralar sıralı ve tahmin edilebilir; tek başına yetki kanıtı olamaz.
    expect(await verifyOrderToken("SD-260908-001")).toBeNull();
    expect(await verifyOrderToken("SD-260908-001.")).toBeNull();
  });

  it("başka bir siparişin imzası bu siparişe geçmez", async () => {
    const token = await createOrderToken("SD-260908-001");
    const signature = token.slice(token.lastIndexOf(".") + 1);
    // Komşu siparişi görmeye çalışma: numarayı değiştir, imzayı koru.
    expect(await verifyOrderToken(`SD-260908-002.${signature}`)).toBeNull();
  });

  it("kurcalanmış imza reddedilir", async () => {
    const token = await createOrderToken("SD-260908-001");
    const broken = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(await verifyOrderToken(broken)).toBeNull();
  });

  it("boş/bozuk girdide çökmez", async () => {
    expect(await verifyOrderToken(undefined)).toBeNull();
    expect(await verifyOrderToken("")).toBeNull();
    expect(await verifyOrderToken(".")).toBeNull();
    expect(await verifyOrderToken("...")).toBeNull();
  });
});

/* ═══════════════════════════════════════════ müşteri oturum jetonu */

describe("müşteri oturum jetonu", () => {
  it("üretilen jeton kimliği ve sürümü taşır", async () => {
    const token = await createCustomerToken({ customerId: "cus_1", tokenVersion: 3 });
    expect(await verifyCustomerToken(token)).toEqual({
      customerId: "cus_1",
      tokenVersion: 3,
    });
  });

  it("başka bir hesaba geçmeye izin vermez", async () => {
    const token = await createCustomerToken({ customerId: "cus_1", tokenVersion: 0 });
    const parts = token.split(".");
    // Kimliği değiştir, imzayı koru — IDOR denemesinin en basit hâli.
    expect(await verifyCustomerToken(["cus_2", parts[1], parts[2], parts[3]].join("."))).toBeNull();
  });

  it("oturum sürümü yükseltilerek eski jeton canlandırılamaz", async () => {
    const token = await createCustomerToken({ customerId: "cus_1", tokenVersion: 1 });
    const parts = token.split(".");
    expect(await verifyCustomerToken(["cus_1", "99", parts[2], parts[3]].join("."))).toBeNull();
  });

  it("son kullanma tarihi uzatılamaz", async () => {
    const token = await createCustomerToken({ customerId: "cus_1", tokenVersion: 0 });
    const parts = token.split(".");
    const later = String(Number(parts[2]) + 10_000_000);
    expect(await verifyCustomerToken(["cus_1", parts[1], later, parts[3]].join("."))).toBeNull();
  });

  it("süresi dolmuş jeton reddedilir", async () => {
    // Elle kurulmuş, geçmiş tarihli ama biçimi doğru bir jeton.
    const expired = `cus_1.0.${Date.now() - 1000}.imza`;
    expect(await verifyCustomerToken(expired)).toBeNull();
  });

  it("uydurma jeton reddedilir", async () => {
    expect(await verifyCustomerToken("cus_1.0.9999999999999.AAAA")).toBeNull();
    expect(await verifyCustomerToken("garbage")).toBeNull();
    expect(await verifyCustomerToken(undefined)).toBeNull();
  });

  it("admin jetonu müşteri jetonu yerine geçmez", async () => {
    // Farklı gizli anahtar + farklı biçim: iki alan birbirine karışamaz.
    expect(await verifyCustomerToken("admin.9999999999999.imza")).toBeNull();
  });
});

/* ═════════════════════════════════════════════════ parola özeti */

describe("parola özeti", () => {
  it("doğru parolayı tanır, yanlışı reddeder", async () => {
    const stored = await hashPassword("dogru-parola-123");
    expect(await verifyPassword("dogru-parola-123", stored)).toBe(true);
    expect(await verifyPassword("yanlis-parola-123", stored)).toBe(false);
  });

  it("aynı parola her seferinde farklı özet üretir", async () => {
    // Tuz olmasaydı, iki kullanıcının aynı parolayı kullandığı veritabanına
    // bakmakla anlaşılırdı.
    const a = await hashPassword("ayni-parola");
    const b = await hashPassword("ayni-parola");
    expect(a).not.toBe(b);
    expect(await verifyPassword("ayni-parola", a)).toBe(true);
    expect(await verifyPassword("ayni-parola", b)).toBe(true);
  });

  it("özet düz parolayı içermez", async () => {
    const stored = await hashPassword("gizli-sifre-42");
    expect(stored).not.toContain("gizli-sifre-42");
    expect(stored.startsWith("pbkdf2$sha256$600000$")).toBe(true);
  });

  it("bozuk kayıtta çökmez, false döner", async () => {
    for (const bad of ["", "duzmetin", "pbkdf2$sha256$abc$x$y", "md5$sha256$1$a$b", "a$b$c$d"]) {
      expect(await verifyPassword("herhangi", bad)).toBe(false);
    }
  });

  it("yineleme sayısı düşürülerek doğrulama ucuzlatılamaz", async () => {
    // Saldırgan veritabanına yazabilseydi bile: 1 yinelemeli bir kayıt
    // "yükseltilmesi gereken" olarak işaretlenir.
    expect(needsRehash("pbkdf2$sha256$1$AAAA$BBBB")).toBe(true);
    expect(needsRehash("pbkdf2$sha256$600000$AAAA$BBBB")).toBe(false);
    expect(needsRehash("bozuk")).toBe(true);
  });

  it("parola politikası yalnızca uzunluğa bakar", () => {
    expect(passwordProblem("kisa")).toBe("too_short");
    expect(passwordProblem("12345678")).toBeNull();
    expect(passwordProblem("a".repeat(201))).toBe("too_long");
  });
});

/* ═══════════════════════════════════ sepet girdisinin ayıklanması */

describe("sepet girdisi ayıklama", () => {
  it("fiyat alanlarını yok sayar", () => {
    // Fiyat manipülasyonunun en doğrudan denemesi: gövdeye tutar koymak.
    const lines = parseCartLines([
      {
        kind: "product",
        productId: "p1",
        qty: 2,
        priceCents: 1,
        unitCents: 1,
        lineCents: 1,
        total: 0,
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]).sort()).toEqual(["kind", "productId", "qty"].sort());
  });

  it("adedi 1..99 aralığına sıkıştırır", () => {
    const lines = parseCartLines([
      { kind: "product", productId: "a", qty: 0 },
      { kind: "product", productId: "b", qty: -5 },
      { kind: "product", productId: "c", qty: 1000 },
      { kind: "product", productId: "d", qty: 2.9 },
      { kind: "product", productId: "e", qty: "3" },
    ]);
    expect(lines.map((l) => l.qty)).toEqual([1, 1, 99, 2, 1]);
  });

  it("satır sayısını sınırlar", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      kind: "product",
      productId: `p${i}`,
      qty: 1,
    }));
    expect(parseCartLines(many).length).toBeLessThanOrEqual(60);
  });

  it("eksik yapılandırıcı seçimini atar", () => {
    expect(parseCartLines([{ kind: "builder", bread: "b", protein: "p", qty: 1 }])).toEqual([]);
  });

  it("tanınmayan ve bozuk satırları atar", () => {
    expect(
      parseCartLines([
        null,
        "metin",
        42,
        { kind: "unknown", productId: "x", qty: 1 },
        { kind: "product", qty: 1 },
        { kind: "product", productId: "", qty: 1 },
        { kind: "product", productId: "a".repeat(500), qty: 1 },
      ])
    ).toEqual([]);
  });

  it("dizi olmayan girdide boş döner", () => {
    expect(parseCartLines(null)).toEqual([]);
    expect(parseCartLines({ lines: [] })).toEqual([]);
    expect(parseCartLines(undefined)).toEqual([]);
  });

  it("dili yalnızca bilinen iki değere indirger", () => {
    expect(parseLang("de")).toBe("de");
    expect(parseLang("tr")).toBe("tr");
    expect(parseLang("en")).toBe("tr");
    expect(parseLang(null)).toBe("tr");
  });
});

/* ------------------------------------------------ parola sıfırlama jetonu */

describe("parola sıfırlama jetonu özeti", () => {
  it("aynı jeton için her zaman aynı özeti üretir", async () => {
    // Arama özet üzerinden yapılıyor (`tokenHash` @unique); deterministik
    // olmasaydı üretilen jeton hiçbir zaman bulunamazdı.
    const token = "ornek-jeton-0123456789abcdef";
    expect(await hashToken(token)).toBe(await hashToken(token));
  });

  it("farklı jetonlar farklı özet üretir", async () => {
    expect(await hashToken("jeton-a")).not.toBe(await hashToken("jeton-b"));
  });

  it("özet jetonun kendisini içermez", async () => {
    // Veritabanı sızarsa saklanan değerden jeton üretilememeli.
    const token = "cok-gizli-jeton-degeri-123456";
    const hash = await hashToken(token);
    expect(hash).not.toContain(token);
    expect(hash.length).toBeGreaterThan(20);
  });

  it("tek karakterlik fark bambaşka bir özet verir", async () => {
    const a = await hashToken("jeton-0123456789abcdefghij");
    const b = await hashToken("jeton-0123456789abcdefghik");
    expect(a).not.toBe(b);
    // İlk karakterlerin bile örtüşmemesi beklenir (çığ etkisi).
    expect(a.slice(0, 8)).not.toBe(b.slice(0, 8));
  });

  it("özet URL'de taşınabilir biçimdedir", async () => {
    // base64url: "+", "/" ve "=" yok — jeton bağlantıda, özet sütunda durur
    // ve ikisinin de kaçış gerektirmemesi kayıt/arama yollarını basitleştirir.
    const hash = await hashToken("herhangi-bir-jeton-1234567890");
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
