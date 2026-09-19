import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { withDatabase } from "@/lib/security/dbGuard";
import { checkThrottle, pickClientIp, recordFailure, throttleKeys } from "@/lib/security/throttle";
import {
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from "@/lib/account/schema";
import {
  consumePasswordResetToken,
  createPasswordResetToken,
} from "@/lib/account/passwordReset";
import { sendPasswordResetMail } from "@/lib/mail/orders";

/**
 * Parola sıfırlama — istek ve onay, tek uç.
 *
 * İki adım aynı dosyada çünkü aynı güvenlik kurallarını paylaşıyorlar ve
 * ikisi de aynı hız sınırı kovasına düşmeli: jeton isteyip denemeyi
 * dönüşümlü yapan bir saldırgan, iki ayrı sayaç arasında saklanamamalı.
 *
 * **Hesabın varlığı sızdırılmaz.** İstek adımı, e-posta kayıtlı olsun ya da
 * olmasın her zaman aynı cevabı ve aynı durum kodunu döner. Aksi hâlde bu uç,
 * "bu adres bu sitede kayıtlı mı?" sorusunu herkese cevaplayan bir araca
 * dönüşürdü — bir döner dükkânında bile bu, müşterinin nerede yemek yediğini
 * ifşa etmek demektir.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(): string {
  const h = headers();
  return pickClientIp(h.get("x-real-ip"), h.get("x-forwarded-for"));
}

export async function POST(request: Request) {
  return withDatabase(async () => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
    }

    const keys = [throttleKeys.passwordResetIp(clientIp())];
    const throttled = await checkThrottle(keys);
    if (throttled.blocked) {
      return NextResponse.json(
        { error: "Zu viele Versuche. Bitte später erneut versuchen." },
        { status: 429 }
      );
    }

    const input = body as Record<string, unknown>;

    /* ------------------------------------------------- 2. adım: yeni parola */

    if (typeof input.token === "string") {
      const parsed = passwordResetConfirmSchema.safeParse(body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return NextResponse.json(
          { error: issue?.message ?? "Ungültige Eingabe.", field: issue?.path.join(".") },
          { status: 400 }
        );
      }

      const result = await consumePasswordResetToken(parsed.data.token, parsed.data.password);
      if (!result.ok) {
        /*
         * Geçersiz jeton denemesi sayaca yazılır: bağlantıyı tahmin etmeye
         * çalışan biri hızla kilitlensin. Başarılı sıfırlama yazılmaz.
         */
        await recordFailure(keys);
        return NextResponse.json(
          {
            error:
              "Dieser Link ist nicht mehr gültig. Bitte fordern Sie einen neuen an.",
            reason: result.reason,
          },
          { status: 400 }
        );
      }

      return NextResponse.json({ ok: true });
    }

    /* ----------------------------------------------- 1. adım: bağlantı iste */

    const parsed = passwordResetRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Ungültige E-Mail-Adresse." },
        { status: 400 }
      );
    }

    const customer = await prisma.customer.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, name: true, email: true, lang: true, active: true, anonymizedAt: true },
    });

    /*
     * Kayıt yoksa sessizce hiçbir şey yapılmaz ve aşağıdaki aynı cevap döner.
     * `recordFailure` burada çağrılmaz: çağrılsaydı kilitlenme süresi
     * "adres kayıtlı değil"i ele verirdi.
     *
     * Kapatılmış ve anonimleştirilmiş hesaplar da elenir — girişteki ölçütün
     * aynısı (`lib/account/repository.ts`). DSGVO Art. 17 ile silinmiş bir
     * hesaba sıfırlama bağlantısı göndermek, silinmeyi geri almak olurdu.
     */
    if (customer && customer.active && customer.anonymizedAt === null) {
      const token = await createPasswordResetToken(customer.id);
      await sendPasswordResetMail({
        to: customer.email,
        name: customer.name,
        lang: customer.lang,
        token,
      });
    }

    return NextResponse.json({
      ok: true,
      message:
        "Wenn ein Konto mit dieser E-Mail-Adresse existiert, haben wir einen Link zum Zurücksetzen gesendet.",
    });
  });
}
