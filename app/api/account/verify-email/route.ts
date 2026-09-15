import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireCustomer } from "@/lib/account/guard";
import {
  consumeEmailVerificationToken,
  createEmailVerificationToken,
} from "@/lib/account/emailVerification";
import { sendEmailVerificationMail } from "@/lib/mail/account";
import { withDatabase } from "@/lib/security/dbGuard";
import { checkThrottle, clientIp, recordFailure, throttleKeys } from "@/lib/security/throttle";

/**
 * E-posta doğrulama.
 *
 * POST  — oturum açmış kullanıcıya yeni bir doğrulama bağlantısı gönderir.
 * PATCH — bağlantıdaki jetonu tüketir; oturum **gerekmez**.
 *
 * İkincisinin oturumsuz çalışması şart: doğrulama bağlantısı çoğu zaman
 * telefonun e-posta uygulamasından, hesabın açık olmadığı bir tarayıcıda
 * tıklanır. Jetonun kendisi 256 bit rastgele ve tek kullanımlık — oturumdan
 * daha zayıf bir kanıt değil.
 *
 * Gönderme ucu IP başına kısıtlanır: aksi hâlde bu uç, bizim adımıza başkasının
 * gelen kutusuna e-posta yağdırmanın bedava bir yolu olurdu. Kısıt parola
 * sıfırlamayla **aynı kovayı** kullanıyor; ikisi de aynı işi yapıyor (adrese
 * bağlantı gönderiyor) ve ayrı sayaçlar yalnızca sınırı ikiye katlardı.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withDatabase(async () => {
    const customer = await requireCustomer();
    if (customer instanceof NextResponse) return customer;

    const keys = [throttleKeys.passwordResetIp(clientIp(request))];
    const throttle = await checkThrottle(keys);
    if (throttle.blocked) {
      return NextResponse.json(
        { error: "Zu viele Anfragen. Bitte später erneut versuchen." },
        { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } }
      );
    }

    // Zaten doğrulanmışsa yeni bağlantı üretilmez; "tekrar gönder"e basan
    // kullanıcıya da hata değil, olan bitenin doğrusu söylenir.
    if (customer.emailVerifiedAt) {
      return NextResponse.json({ ok: true, alreadyVerified: true });
    }

    const token = await createEmailVerificationToken(customer.id, customer.email);
    await sendEmailVerificationMail({
      to: customer.email,
      name: customer.name,
      token,
    });

    // Her istek sayaca yazılır — başarılı olanlar da. Burada "başarısız
    // deneme" diye bir şey yok: kötüye kullanım, işleyen isteğin kendisinin
    // tekrarlanmasıyla oluyor.
    await recordFailure(keys);

    return NextResponse.json({ ok: true, alreadyVerified: false });
  });
}

const confirmSchema = z.object({
  token: z.string().trim().min(20).max(200),
});

/** Jetonun reddedilme sebebinin müşteriye gösterilecek karşılığı. */
const MESSAGES: Record<string, string> = {
  invalid: "Dieser Bestätigungslink ist ungültig.",
  expired: "Dieser Bestätigungslink ist abgelaufen. Bitte fordern Sie einen neuen an.",
  used: "Dieser Bestätigungslink wurde bereits verwendet.",
  email_changed:
    "Ihre E-Mail-Adresse wurde inzwischen geändert. Bitte fordern Sie einen neuen Link an.",
};

export async function PATCH(request: Request) {
  return withDatabase(async () => {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
    }

    const parsed = confirmSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: MESSAGES.invalid }, { status: 400 });
    }

    const result = await consumeEmailVerificationToken(parsed.data.token);
    if (!result.ok) {
      return NextResponse.json(
        { error: MESSAGES[result.reason], code: result.reason },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, alreadyVerified: result.alreadyVerified });
  });
}

/** Oturumdaki hesabın doğrulama durumu — ayar ekranı bunu okur. */
export async function GET() {
  return withDatabase(async () => {
    const customer = await requireCustomer();
    if (customer instanceof NextResponse) return customer;

    const fresh = await prisma.customer.findUnique({
      where: { id: customer.id },
      select: { emailVerifiedAt: true },
    });

    return NextResponse.json({ verified: fresh?.emailVerifiedAt !== null });
  });
}
