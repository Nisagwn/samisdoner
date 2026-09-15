import { NextResponse } from "next/server";
import { requireAdmin, badRequest, storeWrite } from "@/lib/admin/guard";
import { createProduct, getCatalog } from "@/lib/admin/store";
import { parseProductBody } from "@/lib/admin/validate";
import { slugify } from "@/lib/admin/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const catalog = await getCatalog();
  return NextResponse.json(catalog);
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Geçersiz istek gövdesi.");
  }

  const { categories } = await getCatalog();
  const parsed = parseProductBody(body, categories.map((c) => c.id), false);
  if (!parsed.ok) return badRequest(parsed.error);

  const value = parsed.value as Required<
    Pick<typeof parsed.value, "name" | "description" | "categoryId" | "price">
  > &
    typeof parsed.value;

  const product = await storeWrite(() => createProduct({
    id: `${value.categoryId}--${slugify(value.name) || "urun"}`,
    no: value.no ?? "",
    name: value.name,
    nameTr: value.nameTr ?? "",
    description: value.description ?? "",
    descriptionTr: value.descriptionTr ?? "",
    categoryId: value.categoryId,
    price: value.price,
    discountPrice: value.discountPrice ?? null,
    image: value.image ?? null,
    active: value.active ?? true,
    inStock: value.inStock ?? true,
    showOnHome: value.showOnHome ?? true,
    featured: value.featured ?? false,
    variants: value.variants ?? [],
    optionGroups: value.optionGroups ?? [],
    isPopular: value.isPopular ?? false,
    isNew: value.isNew ?? false,
    diet: value.diet ?? "NONE",
    spicyLevel: value.spicyLevel ?? 0,
  }));
  if (product instanceof NextResponse) return product;

  return NextResponse.json(product, { status: 201 });
}
