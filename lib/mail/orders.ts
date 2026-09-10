import { Resend } from "resend";
import { formatCents } from "@/lib/money";
import { BUSINESS_INFO } from "@/data/businessInfo";
import type { OrderWithDetails } from "@/lib/orders/repository";
import { orderTrackingUrl } from "@/lib/orders/token";
import { SITE_URL } from "@/lib/site";

/**
 * Sipariş e-postaları.
 *
 * Tasarım kuralı: **e-posta gönderimi siparişi bloke etmez.** Resend anahtarı
 * yoksa ya da sağlayıcı hata verirse sipariş yine de alınmış sayılır; hata
 * loglanır ve akış devam eder. Ödeme tamamlanmış bir siparişi bir bildirim
 * hatası yüzünden düşürmek kabul edilemez.
 *
 * Bu yüzden bildirim, işletmenin siparişi görmesinin **tek** yolu değildir:
 * asıl kanal panelde sesli uyarıdır, e-posta yedektir.
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

/** Gönderimi dener; başarısızlığı yutar ve loglar. */
async function send(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
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

/* --------------------------------------------------------------- biçimler */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linesTable(order: OrderWithDetails): string {
  const rows = order.lines
    .map(
      (line) => `
      <tr>
        <td style="padding:6px 0;">
          <strong>${line.qty}×</strong> ${escapeHtml(line.label)}
          ${line.detail ? `<br><span style="color:#666;font-size:12px;">${escapeHtml(line.detail)}</span>` : ""}
        </td>
        <td style="padding:6px 0;text-align:right;white-space:nowrap;">${formatCents(line.lineCents)}</td>
      </tr>`
    )
    .join("");

  const fees: string[] = [];
  if (order.deliveryFeeCents > 0) {
    fees.push(feeRow("Liefergebühr", order.deliveryFeeCents));
  }
  if (order.serviceFeeCents > 0) {
    fees.push(feeRow("Servicegebühr", order.serviceFeeCents));
  }

  return `
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${rows}
      ${fees.join("")}
      <tr>
        <td style="padding:10px 0 0;border-top:1px solid #ddd;"><strong>Gesamt</strong></td>
        <td style="padding:10px 0 0;border-top:1px solid #ddd;text-align:right;">
          <strong>${formatCents(order.totalCents)}</strong>
        </td>
      </tr>
    </table>`;
}

function feeRow(label: string, cents: number): string {
  return `<tr><td style="padding:6px 0;color:#666;">${label}</td>
    <td style="padding:6px 0;text-align:right;">${formatCents(cents)}</td></tr>`;
}

/**
 * KDV dökümü.
 *
 * Sipariş anında dondurulmuş `vatBreakdown` alanından okunur — güncel ürün
 * fiyatlarından yeniden hesaplanmaz.
 */
function vatTable(order: OrderWithDetails): string {
  const buckets = Array.isArray(order.vatBreakdown)
    ? (order.vatBreakdown as unknown as { rate: number; netCents: number; vatCents: number }[])
    : [];
  if (buckets.length === 0) return "";

  const rows = buckets
    .map(
      (b) =>
        `<tr><td style="padding:2px 0;">Netto ${b.rate}%</td>
         <td style="padding:2px 0;text-align:right;">${formatCents(b.netCents)}</td>
         <td style="padding:2px 0;text-align:right;">MwSt ${formatCents(b.vatCents)}</td></tr>`
    )
    .join("");

  return `<table style="width:100%;border-collapse:collapse;font-size:12px;color:#666;margin-top:12px;">${rows}</table>`;
}

function addressBlock(order: OrderWithDetails): string {
  if (order.fulfillment === "PICKUP") return "<p><strong>Abholung</strong></p>";
  return `<p style="margin:0 0 4px;"><strong>Lieferadresse</strong><br>
    ${escapeHtml(order.customerName)}<br>
    ${escapeHtml(order.street)} ${escapeHtml(order.houseNo)}<br>
    ${escapeHtml(order.zip)} ${escapeHtml(order.city)}<br>
    Tel: ${escapeHtml(order.phone)}</p>`;
}

function shell(title: string, body: string): string {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
    <h1 style="font-size:18px;margin:0 0 16px;">${escapeHtml(title)}</h1>
    ${body}
    <p style="margin-top:24px;font-size:12px;color:#888;">
      ${escapeHtml(BUSINESS_INFO.name)} · ${escapeHtml(BUSINESS_INFO.address.fullAddress)}
    </p>
  </div>`;
}

/* ------------------------------------------------------------ gönderimler */

/**
 * İşletmeye yeni sipariş bildirimi.
 *
 * Alıcı ORDER_NOTIFY_EMAIL'den gelir; tanımlı değilse gönderim atlanır.
 */
export async function sendNewOrderNotification(order: OrderWithDetails): Promise<boolean> {
  const to = process.env.ORDER_NOTIFY_EMAIL;
  if (!to) {
    console.info("[mail] ORDER_NOTIFY_EMAIL yok, işletme bildirimi atlandı.");
    return false;
  }

  const body = `
    <p style="margin:0 0 12px;font-size:15px;">
      <strong>${escapeHtml(order.orderNo)}</strong> —
      ${order.fulfillment === "DELIVERY" ? "Lieferung" : "Abholung"} ·
      ${formatCents(order.totalCents)} (bezahlt)
    </p>
    ${addressBlock(order)}
    ${order.note ? `<p style="margin:8px 0;padding:8px;background:#fff8e1;">Notiz: ${escapeHtml(order.note)}</p>` : ""}
    ${linesTable(order)}
    ${vatTable(order)}`;

  return send({
    to,
    subject: `Neue Bestellung ${order.orderNo} — ${formatCents(order.totalCents)}`,
    html: shell("Neue Bestellung", body),
  });
}

/**
 * Müşteriye sipariş onayı.
 *
 * Takip bağlantısı buraya konur: misafir siparişinde müşterinin siparişine
 * ulaşabileceği tek adres budur.
 */
export async function sendOrderConfirmation(order: OrderWithDetails): Promise<boolean> {
  if (!order.email) {
    console.info(`[mail] ${order.orderNo} — müşteri e-postası yok, onay atlandı.`);
    return false;
  }

  const de = order.lang !== "tr";
  const url = await orderTrackingUrl(order.orderNo);

  const intro = de
    ? `Vielen Dank für Ihre Bestellung. Wir haben Ihre Zahlung erhalten und bereiten alles vor.`
    : `Siparişiniz için teşekkürler. Ödemeniz alındı, hazırlığa başlıyoruz.`;

  const trackLabel = de ? "Bestellung verfolgen" : "Siparişi takip et";

  // Widerrufsrecht: § 312g Abs. 2 BGB uyarınca çabuk bozulan hazır yemekte
  // cayma hakkı yoktur; bu bilgi onay yazısında da yer alır.
  const legal = de
    ? `Bei frisch zubereiteten, schnell verderblichen Speisen besteht gemäß § 312g Abs. 2 BGB kein Widerrufsrecht.`
    : `Çabuk bozulan taze hazırlanmış yemeklerde § 312g Abs. 2 BGB uyarınca cayma hakkı bulunmamaktadır.`;

  const body = `
    <p style="margin:0 0 12px;">${intro}</p>
    <p style="margin:0 0 16px;font-size:15px;"><strong>${escapeHtml(order.orderNo)}</strong></p>
    <p style="margin:0 0 20px;">
      <a href="${url}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">
        ${trackLabel}
      </a>
    </p>
    ${linesTable(order)}
    ${vatTable(order)}
    <p style="margin-top:20px;font-size:12px;color:#888;">${legal}</p>`;

  return send({
    to: order.email,
    subject: de
      ? `Bestellbestätigung ${order.orderNo}`
      : `Sipariş onayı ${order.orderNo}`,
    html: shell(de ? "Bestellbestätigung" : "Sipariş onayı", body),
  });
}

/**
 * Müşteriye iade bildirimi.
 *
 * İptal maili değil **para** mailidir: müşterinin bu anda öğrenmesi gereken
 * şey siparişin iptal edildiği değil (onu takip sayfasında zaten görüyor),
 * parasının geri gönderildiği ve ne zaman hesabında olacağıdır. "Birkaç iş
 * günü" ifadesi bilinçli: süreyi biz değil kartın bankası belirliyor, kesin
 * gün vermek tutulamayacak bir söz olurdu.
 *
 * İptal sebebi de burada tekrarlanır; müşteri maili açtığında elinde tek
 * parça bilgi olsun diye.
 */
export async function sendRefundNotice(
  order: OrderWithDetails,
  amountCents: number,
  reason: string
): Promise<boolean> {
  if (!order.email) {
    console.info(`[mail] ${order.orderNo} — müşteri e-postası yok, iade bildirimi atlandı.`);
    return false;
  }

  const de = order.lang !== "tr";

  const intro = de
    ? `Ihre Bestellung wurde storniert und der Betrag zurückerstattet.`
    : `Siparişiniz iptal edildi ve tutar iade edildi.`;

  const timing = de
    ? `Die Gutschrift erfolgt über Ihr ursprüngliches Zahlungsmittel. Je nach Bank kann es einige Werktage dauern, bis der Betrag auf Ihrem Konto sichtbar ist.`
    : `İade, ödemeyi yaptığınız yöntem üzerinden yapılır. Bankanıza bağlı olarak tutarın hesabınızda görünmesi birkaç iş günü sürebilir.`;

  const reasonLabel = de ? "Grund" : "Sebep";

  const body = `
    <p style="margin:0 0 12px;">${intro}</p>
    <p style="margin:0 0 16px;font-size:15px;">
      <strong>${escapeHtml(order.orderNo)}</strong> —
      <strong>${formatCents(amountCents)}</strong>
    </p>
    ${reason ? `<p style="margin:0 0 16px;padding:8px;background:#f5f5f5;">${escapeHtml(reasonLabel)}: ${escapeHtml(reason)}</p>` : ""}
    <p style="margin:0 0 16px;color:#666;font-size:13px;">${timing}</p>
    ${linesTable(order)}`;

  return send({
    to: order.email,
    subject: de
      ? `Rückerstattung ${order.orderNo} — ${formatCents(amountCents)}`
      : `İade ${order.orderNo} — ${formatCents(amountCents)}`,
    html: shell(de ? "Rückerstattung" : "İade", body),
  });
}

/**
 * Parola sıfırlama bağlantısı.
 *
 * Bu dosyadaki tek sipariş dışı gönderim. Aynı yerde durmasının sebebi
 * gönderim altyapısının (`send`, `shell`, `from()`) tek olması; ayrı bir
 * modül, `RESEND_API_KEY` yokken sessizce atlama davranışını ikinci kez
 * yazmak olurdu.
 *
 * Bağlantının geçerlilik süresi metinde açıkça yazılır: kullanıcı maili yarın
 * açtığında "bağlantı çalışmıyor" diye destek araması yerine ne olduğunu
 * anlasın.
 */
export async function sendPasswordResetMail(input: {
  to: string;
  name: string;
  lang: string;
  token: string;
}): Promise<boolean> {
  const de = input.lang !== "tr";
  const url = `${SITE_URL}/konto/passwort-neu?token=${encodeURIComponent(input.token)}`;

  const intro = de
    ? `Sie haben angefordert, Ihr Passwort zurückzusetzen. Über den folgenden Link vergeben Sie ein neues Passwort.`
    : `Parolanızı sıfırlama talebinde bulundunuz. Aşağıdaki bağlantıdan yeni bir parola belirleyebilirsiniz.`;

  const expiry = de
    ? `Der Link ist eine Stunde lang gültig und kann nur einmal verwendet werden.`
    : `Bağlantı bir saat geçerlidir ve yalnızca bir kez kullanılabilir.`;

  const ignore = de
    ? `Falls Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren — Ihr Passwort bleibt unverändert.`
    : `Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz; parolanız değişmez.`;

  const label = de ? "Neues Passwort vergeben" : "Yeni parola belirle";

  const body = `
    <p style="margin:0 0 12px;">${escapeHtml(de ? "Hallo" : "Merhaba")} ${escapeHtml(input.name)},</p>
    <p style="margin:0 0 20px;">${intro}</p>
    <p style="margin:0 0 20px;">
      <a href="${url}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">
        ${label}
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#666;">${expiry}</p>
    <p style="margin:0;font-size:13px;color:#666;">${ignore}</p>`;

  return send({
    to: input.to,
    subject: de ? "Passwort zurücksetzen" : "Parola sıfırlama",
    html: shell(de ? "Passwort zurücksetzen" : "Parola sıfırlama", body),
  });
}
