import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireCustomer } from "@/lib/account/guard";
import { withDatabase } from "@/lib/security/dbGuard";

/**
 * Bildirim tercihleri ve reklam izni.
 *
 * ── Neden ayrı bir uç ────────────────────────────────────────────────────
 *
 * Profil ucuna bir alan daha eklemek daha az kod olurdu. Ama reklam izni
 * hukuken diğer alanlara benzemiyor: DSGVO Art. 7 Abs. 1 ispat yükünü
 * işletmeye yükler — "izin verdi" demek yetmez, **ne zaman** verdiği
 * gösterilebilmelidir. Bu yüzden izin açıldığında `marketingOptInAt` damgası
 * yazılır ve kapatıldığında silinir. Ayrı bir uç, o damganın adını değiştiren
 * bir profil güncellemesiyle yanlışlıkla ezilmesini de imkânsız kılıyor.
 *
 * ── Neyin izne bağlı olmadığı ────────────────────────────────────────────
 *
 * Sipariş onayı, durum bildirimi ve iptal/iade e-postaları **kapatılamaz** ve
 * burada hiç görünmezler: bunlar reklam değil, sözleşmenin ifasına dair
 * bildirimlerdir (§ 312i BGB). Kapatılabilir olsalardı, müşteri siparişinin
 * iptal edildiğini hiç öğrenemeyebilirdi.
 *
 * Kapatılabilen iki şey var: reklam e-postası (UWG § 7 Abs. 2 Nr. 3 uyarınca
 * zaten **açık rıza** ister, varsayılanı kapalıdır) ve teslimattan sonra gelen
 * değerlendirme hatırlatması (reklam değil ama zorunlu da değil).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    marketingOptIn: z.boolean().optional(),
    reviewMailsOptIn: z.boolean().optional(),
  })
  // Boş gövde bir şey yapmaz; sessizce "kaydedildi" demek yanıltıcı olurdu.
  .refine(
    (value) => value.marketingOptIn !== undefined || value.reviewMailsOptIn !== undefined,
    { message: "Keine Änderung angegeben." }
  );

export async function GET() {
  return withDatabase(async () => {
    const customer = await requireCustomer();
    if (customer instanceof NextResponse) return customer;

    return NextResponse.json({
      marketingOptIn: customer.marketingOptIn,
      marketingOptInAt: customer.marketingOptInAt?.toISOString() ?? null,
      reviewMailsOptIn: customer.reviewMailsOptIn,
      emailVerified: customer.emailVerifiedAt !== null,
    });
  });
}

export async function PATCH(request: Request) {
  return withDatabase(async () => {
    const customer = await requireCustomer();
    if (customer instanceof NextResponse) return customer;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Ungültige Anfrage." },
        { status: 400 }
      );
    }

    const { marketingOptIn, reviewMailsOptIn } = parsed.data;

    /*
     * Rıza damgası yalnızca **durum değiştiğinde** yazılır.
     *
     * Ayarları kaydeden ama izne dokunmayan bir istek damgayı tazelemez;
     * tazeleseydi, izin kaydı "en son ne zaman ayarlara girdi" tarihine
     * dönüşür ve ispat değerini yitirirdi.
     */
    const consentChanged =
      marketingOptIn !== undefined && marketingOptIn !== customer.marketingOptIn;

    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: {
        ...(marketingOptIn !== undefined ? { marketingOptIn } : {}),
        ...(consentChanged
          ? { marketingOptInAt: marketingOptIn ? new Date() : null }
          : {}),
        ...(reviewMailsOptIn !== undefined ? { reviewMailsOptIn } : {}),
      },
      select: { marketingOptIn: true, marketingOptInAt: true, reviewMailsOptIn: true },
    });

    return NextResponse.json({
      ok: true,
      marketingOptIn: updated.marketingOptIn,
      marketingOptInAt: updated.marketingOptInAt?.toISOString() ?? null,
      reviewMailsOptIn: updated.reviewMailsOptIn,
    });
  });
}
