import type { CartLineInput } from "@/lib/admin/store";

/**
 * İstemciden gelen sepet tarifinin doğrulanması.
 *
 * Gövde tamamen güvenilmezdir: yalnızca ürün kimliği, boy ve adet okunur.
 * Para ile ilgili hiçbir alan kabul edilmez — fiyat hesabı her zaman sunucuda
 * (`priceCart`) yapılır. Tanınmayan satır türü sessizce düşer; kaldırılan
 * yapılandırıcının satırları da buradan geçemez.
 */

const MAX_LINES = 60;
const MAX_ID = 120;

function id(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ID) return null;
  return trimmed;
}

function qty(value: unknown): number {
  const n = typeof value === "number" ? Math.floor(value) : Number.NaN;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 99);
}

export function parseCartLines(value: unknown): CartLineInput[] {
  if (!Array.isArray(value)) return [];

  const lines: CartLineInput[] = [];
  for (const raw of value.slice(0, MAX_LINES)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;

    if (entry.kind === "product") {
      const productId = id(entry.productId);
      if (!productId) continue;
      const variantSize = typeof entry.variantSize === "string" ? entry.variantSize.slice(0, 40) : undefined;
      lines.push({
        kind: "product",
        productId,
        ...(variantSize ? { variantSize } : {}),
        qty: qty(entry.qty),
      });
    }
  }
  return lines;
}

export function parseLang(value: unknown): "tr" | "de" {
  return value === "de" ? "de" : "tr";
}
