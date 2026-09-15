import { describe, expect, it } from "vitest";
import {
  ROLE_HINTS,
  ROLE_LABELS,
  ROLE_OPTIONS,
  can,
  type AdminPermission,
} from "@/lib/admin/roles";

/**
 * Panel yetkileri.
 *
 * Bu testlerin çoğu "şu rol şunu yapabilir" değil, **"şu rol şunu
 * yapamaz"** diyor. Sebep: bir izni yanlışlıkla fazla vermek sessizdir —
 * kimse "ben bunu yapabiliyorum ama yapmamalıydım" diye bildirmez. Eksik
 * verilen izin ise ilk denemede şikâyet olarak geri döner.
 */

const ALL: AdminPermission[] = [
  "orders",
  "shift",
  "catalog",
  "business",
  "reviews",
  "finance",
  "refund",
  "staff",
];

describe("rol yetkileri", () => {
  it("sahip her şeyi yapabilir", () => {
    for (const permission of ALL) expect(can("OWNER", permission)).toBe(true);
  });

  it("müdür personel yönetemez", () => {
    // Personel listesi erişimin kendisidir: onu değiştirebilen biri kendine
    // istediği yetkiyi verebilir.
    expect(can("MANAGER", "staff")).toBe(false);
  });

  it("müdür para iadesi yapamaz", () => {
    // İade geri alınamaz ve bankadan geri çağrılamaz.
    expect(can("MANAGER", "refund")).toBe(false);
  });

  it("müdür kurulum ekranlarını açabilir", () => {
    for (const permission of ["catalog", "business", "finance"] as const) {
      expect(can("MANAGER", permission)).toBe(true);
    }
  });

  it("personel yalnızca vardiya işlerini yapabilir", () => {
    for (const permission of ["orders", "shift", "reviews"] as const) {
      expect(can("STAFF", permission)).toBe(true);
    }
  });

  it("personel kurulum, para ve erişim ekranlarına giremez", () => {
    for (const permission of ["catalog", "business", "finance", "refund", "staff"] as const) {
      expect(can("STAFF", permission)).toBe(false);
    }
  });

  it("her rol sipariş akışını işletebilir", () => {
    // Panelin tek vazgeçilmez işi bu: sipariş alınamıyorsa panelin anlamı yok.
    for (const role of ROLE_OPTIONS) expect(can(role, "orders")).toBe(true);
  });

  it("vardiya anahtarları mutfaktaki kişinin elinde", () => {
    // Yoğunluğa cevap veren kişi mutfaktakidir ve o cevabı vermek için
    // müdür beklememeli.
    for (const role of ROLE_OPTIONS) expect(can(role, "shift")).toBe(true);
  });

  it("yetki kümeleri daralarak gider: sahip ⊇ müdür ⊇ personel", () => {
    // Tanım hiyerarşik değil ama sonuç öyle olmalı; aksi hâlde "müdüre kapalı
    // ama personele açık" gibi savunulamaz bir delik açılmış olurdu.
    for (const permission of ALL) {
      if (can("STAFF", permission)) expect(can("MANAGER", permission)).toBe(true);
      if (can("MANAGER", permission)) expect(can("OWNER", permission)).toBe(true);
    }
  });
});

describe("rol etiketleri", () => {
  it("her rolün Türkçe adı ve açıklaması var", () => {
    // Panel Türkçe; etiketi olmayan bir rol arayüzde "OWNER" diye görünürdü.
    for (const role of ROLE_OPTIONS) {
      expect(ROLE_LABELS[role].length).toBeGreaterThan(0);
      expect(ROLE_HINTS[role].length).toBeGreaterThan(0);
    }
  });

  it("seçim listesi üç rolü de içerir", () => {
    expect(ROLE_OPTIONS).toHaveLength(3);
    expect(new Set(ROLE_OPTIONS).size).toBe(3);
  });
});
