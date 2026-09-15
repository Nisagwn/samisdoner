import { Resend } from "resend";
import { SITE_URL } from "@/lib/site";

/**
 * Hesap e-postaları.
 *
 * Sipariş e-postalarından (`lib/mail/orders.ts`) ayrı bir dosyada; ikisi aynı
 * kuralı paylaşıyor ama farklı sebeplerle değişiyor. Kural: **gönderim akışı
 * bloke etmez.** Resend anahtarı yoksa ya da sağlayıcı hata verirse işlem
 * (kayıt, doğrulama isteği) yine de başarılı sayılır; hata loglanır.
 *
 * Doğrulama e-postasında bu özellikle önemli: gönderilemeyen bir bildirim
 * yüzünden kaydı düşürmek, kullanıcıyı hiçbir şey yapamaz hâle getirirdi.
 */

let client: Resend | null = null;

function resend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!client) client = new Resend(key);
  return client;
}

function from(): string {
  return process.env.ORDER_MAIL_FROM ?? "Sami's Döner <onboarding@resend.dev>";
}

async function send(options: { to: string; subject: string; html: string }): Promise<boolean> {
  const mailer = resend();
  if (!mailer) {
    console.info(`[mail] RESEND_API_KEY yok, atlandı: ${options.subject}`);
    return false;
  }
  try {
    const { error } = await mailer.emails.send({
      from: from(),
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    if (error) {
      console.error("[mail] gönderilemedi", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[mail] gönderilemedi", error);
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(title: string, body: string): string {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a;">
      <h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(title)}</h1>
      ${body}
      <hr style="border:none;border-top:1px solid #e5e5e5;margin:28px 0 12px;">
      <p style="font-size:12px;color:#777;margin:0;">Sami´s Döner · Straubinger Str. 3, 94342 Straßkirchen</p>
    </div>
  `;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;">
    <a href="${href}" style="display:inline-block;background:#e8a33d;color:#111;text-decoration:none;padding:12px 22px;font-weight:700;">${escapeHtml(label)}</a>
  </p>
  <p style="font-size:12px;color:#777;">Falls der Button nicht funktioniert, kopieren Sie diesen Link:<br>
    <span style="word-break:break-all;">${href}</span>
  </p>`;
}

/**
 * E-posta doğrulama bağlantısı.
 *
 * Metin **Almanca**: müşteriye giden her şey Almanca. Türkçe tercih eden
 * kullanıcı için ayrı bir sürüm yazılabilirdi ama doğrulama e-postası tek
 * cümlelik bir işlem bildirimi; iki dil tutmanın karşılığı, ikisinin zamanla
 * ayrışması riskinden az.
 */
export async function sendEmailVerificationMail(input: {
  to: string;
  name: string;
  token: string;
}): Promise<boolean> {
  const href = `${SITE_URL}/konto/email-bestaetigen?token=${encodeURIComponent(input.token)}`;
  const greeting = input.name ? `Hallo ${escapeHtml(input.name)},` : "Hallo,";

  return send({
    to: input.to,
    subject: "Bitte bestätigen Sie Ihre E-Mail-Adresse",
    html: layout(
      "E-Mail-Adresse bestätigen",
      `<p>${greeting}</p>
       <p>bitte bestätigen Sie mit einem Klick, dass diese Adresse Ihnen gehört. Erst dann können wir Ihr Passwort sicher zurücksetzen, falls Sie es einmal vergessen.</p>
       ${button(href, "E-MAIL BESTÄTIGEN")}
       <p style="font-size:12px;color:#777;">Der Link ist eine Woche gültig. Wenn Sie kein Konto bei uns angelegt haben, ignorieren Sie diese E-Mail einfach — es passiert dann nichts.</p>`
    ),
  });
}
