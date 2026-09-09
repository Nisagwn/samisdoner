import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCents } from "@/lib/money";
import { BUSINESS_INFO } from "@/data/businessInfo";
import { getOrderByNo, type OrderWithDetails } from "@/lib/orders/repository";
import { verifyOrderToken } from "@/lib/orders/token";
import {
  STATUS_HINTS,
  STATUS_LABELS,
  isTerminal,
  progressIndex,
  progressSteps,
} from "@/lib/orders/status";
import { describeCancelReason } from "@/lib/orders/cancelReasons";
import { reorderDrafts } from "@/lib/orders/reorder";
import { getCurrentCustomer } from "@/lib/account/guard";
import { AutoRefresh } from "./AutoRefresh";
import { PaymentSync } from "./PaymentSync";
import { ClearCart } from "./ClearCart";
import { ReorderButton } from "./OrderActions";

/**
 * Misafir sipariş takip sayfası.
 *
 * Erişim yalnızca imzalı jetonla olur: sipariş numarası sıralı ve tahmin
 * edilebilir olduğu için tek başına yetki kanıtı sayılmaz. Jeton geçersizse
 * "bulunamadı" gösterilir — geçersiz imza ile var olmayan sipariş arasındaki
 * farkı söylemek bilgi sızdırır.
 */

export const dynamic = "force-dynamic";

// Takip bağlantısı kişisel veri taşır; arama motorlarına girmemeli.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Params = { params: { token: string } };

export default async function OrderTrackingPage({ params }: Params) {
  const token = decodeURIComponent(params.token);
  const orderNo = await verifyOrderToken(token);
  if (!orderNo) notFound();

  const order = await getOrderByNo(orderNo);
  if (!order) notFound();

  const de = order.lang !== "tr";
  const t = de ? texts.de : texts.tr;

  /*
   * "Siparişlerim" bağlantısı yalnızca oturum açıksa gösterilir. Takip
   * bağlantısı misafire de gidebilir — kapalı bir sayfaya yollamak, oradan
   * giriş ekranına düşürmek demek olurdu.
   *
   * Siparişin sahibi olup olmadığı sorulmaz: bağlantı hesabın kendi sipariş
   * listesine gider, bu sayfaya değil. Yanlış bir şey sızdırmaz.
   */
  const loggedIn = (await getCurrentCustomer()) !== null;

  // Akışı bitmiş siparişte asıl işlem tekrar sipariş vermektir; süren
  // siparişte müşteri zaten bekliyor, ona menüyü göstermenin acelesi yok.
  const finished = isTerminal(order.status);
  const drafts = finished ? reorderDrafts(order.lines) : [];

  // Ödeme tamamlanmadan sipariş mutfağa düşmez; müşteriye de bunu söyleriz.
  const awaitingPayment = order.status === "PENDING_PAYMENT";
  const failed =
    order.status === "CANCELLED" || order.status === "REJECTED" || order.status === "EXPIRED";

  return (
    <main className="min-h-screen bg-void px-5 py-16 text-bone">
      {/* Durum panelde değiştiğinde sayfa kendiliğinden tazelensin. */}
      {!failed && <AutoRefresh seconds={20} />}
      {/* Ödeme alınmış ama webhook ulaşmamışsa siparişi Stripe'a sorarak
          kapatır; yoksa sipariş burada beklemede kalır ve panele düşmez. */}
      {awaitingPayment && <PaymentSync token={token} />}
      {/* Ödeme gerçekleştiyse sepet artık gereksiz. */}
      {!awaitingPayment && order.status !== "EXPIRED" && <ClearCart />}

      <div className="mx-auto w-full max-w-xl">
        <header className="mb-10">
          <p className="font-mono text-[11px] uppercase tracking-widest2 text-smoke">
            {t.heading}
          </p>
          <h1 className="mt-3 font-display text-3xl text-bone">{order.orderNo}</h1>
        </header>

        {failed ? (
          <Notice tone="bad" title={STATUS_LABELS[order.status][de ? "de" : "tr"]}>
            {/* Üç kaynak, bu sırayla: panelde seçilen iptal sebebi (kayıtta
                duran şey bir kimliktir, hazır cümle değil), durumun kendi
                açıklaması (süresi dolan siparişte "tahsilat yapılmadı"), ve
                hiçbiri yoksa genel cümle. */}
            {describeCancelReason(order.cancelReason, order.lang) ??
              STATUS_HINTS[order.status]?.[de ? "de" : "tr"] ??
              t.failedHint}
          </Notice>
        ) : awaitingPayment ? (
          <Notice tone="warn" title={STATUS_LABELS[order.status][de ? "de" : "tr"]}>
            {t.awaitingPayment}
          </Notice>
        ) : (
          <Progress order={order} de={de} t={t} />
        )}

        <Section title={t.items}>
          <ul className="divide-y divide-line">
            {order.lines.map((line) => (
              <li key={line.id} className="flex gap-4 py-3">
                <span className="font-mono text-sm text-amber">{line.qty}×</span>
                <span className="flex-1">
                  <span className="block text-sm text-bone">{line.label}</span>
                  {line.detail && (
                    <span className="mt-0.5 block text-xs text-smoke">{line.detail}</span>
                  )}
                </span>
                <span className="font-mono text-sm text-bone">{formatCents(line.lineCents)}</span>
              </li>
            ))}
          </ul>

          <dl className="mt-4 space-y-1.5 border-t border-line pt-4 font-mono text-sm">
            <Row label={t.subtotal} value={formatCents(order.subtotalCents)} muted />
            {order.deliveryFeeCents > 0 && (
              <Row label={t.deliveryFee} value={formatCents(order.deliveryFeeCents)} muted />
            )}
            {order.serviceFeeCents > 0 && (
              <Row label={t.serviceFee} value={formatCents(order.serviceFeeCents)} muted />
            )}
            <Row label={t.total} value={formatCents(order.totalCents)} />
          </dl>

          <VatNote order={order} label={t.vatIncluded} />
        </Section>

        <Section title={order.fulfillment === "DELIVERY" ? t.delivery : t.pickup}>
          <p className="text-sm leading-relaxed text-smoke">
            {order.fulfillment === "DELIVERY" ? (
              <>
                {order.customerName}
                <br />
                {order.street} {order.houseNo}
                <br />
                {order.zip} {order.city}
              </>
            ) : (
              <>
                {BUSINESS_INFO.name}
                <br />
                {BUSINESS_INFO.address.fullAddress}
              </>
            )}
          </p>
          {order.note && (
            <p className="mt-3 border-l-2 border-amber pl-3 text-sm text-smoke">{order.note}</p>
          )}
        </Section>

        {/*
          Buradan çıkış yolları.
          
          Sayfa kendini 20 saniyede bir tazeliyor; müşteri onu açık bırakıp
          bekleyebilir. Ama bekleyecek bir şeyi kalmadığında ya da sipariş
          verirken bir şey unuttuğunu fark ettiğinde gidecek bir yer olmalı —
          tarayıcının geri düğmesi bu iş için yeterli değil, çünkü geri gitmek
          ödeme akışının içine düşer.
        */}
        <Section title={t.next}>
          <div className="flex flex-wrap gap-3">
            <ReorderButton drafts={drafts} label={t.orderAgain} added={t.addedToCart} />
            <ActionLink href="/speisekarte" primary={!finished}>
              {t.toMenu}
            </ActionLink>
            {loggedIn && <ActionLink href="/konto">{t.myOrders}</ActionLink>}
            <ActionLink href="/">{t.backHome}</ActionLink>
          </div>
        </Section>

        <footer className="mt-12 border-t border-line pt-6 text-xs text-smoke">
          <p>{t.questions}</p>
          <a href={BUSINESS_INFO.phoneTel} className="mt-1 block text-amber">
            {BUSINESS_INFO.formattedPhone}
          </a>
        </footer>
      </div>
    </main>
  );
}

/* ----------------------------------------------------------- parçalar */

/**
 * Metin sözlüğünün yapısal tipi.
 *
 * `texts` `as const` olduğu için `texts.de` ve `texts.tr`'nin tipleri birebir
 * aynı değil (her değer kendi harfi harfine literal tipi). Doğrudan
 * `typeof texts.de` kullanmak, Türkçe sözlüğü Almanca parametreye geçirmeyi
 * imkânsız kılardı; bu eşleme her anahtarı düz `string`e indirir.
 */
type TrackingText = { [K in keyof (typeof texts)["de"]]: string };

function Progress({
  order,
  de,
  t,
}: {
  order: OrderWithDetails;
  de: boolean;
  t: TrackingText;
}) {
  const steps = progressSteps(order.fulfillment);
  const current = progressIndex(order.status, order.fulfillment);

  return (
    <div className="rounded-lg border border-line bg-char p-6">
      <Eta order={order} de={de} t={t} />

      <ol className="space-y-4">
        {steps.map((step, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={step} className="flex items-center gap-3">
              <span
                className={[
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full border font-mono text-[10px]",
                  active
                    ? "border-flame bg-flame text-void"
                    : done
                      ? "border-herb text-herb"
                      : "border-line text-smoke",
                ].join(" ")}
                aria-hidden
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className={
                  active ? "text-sm font-medium text-bone" : "text-sm text-smoke"
                }
              >
                {STATUS_LABELS[step][de ? "de" : "tr"]}
              </span>
            </li>
          );
        })}
      </ol>

    </div>
  );
}

/**
 * Söz verilen teslim saati.
 *
 * `promisedAt` ödeme onaylandığı an dondurulur ve yalnızca panelden bilinçli
 * bir gecikme bildirimiyle değişir; burada **hesaplanmaz, okunur.** Her sayfa
 * yenilemesinde yeniden hesaplanan bir tahmin sürekli kayar ve müşterinin
 * saate olan güvenini bitirir.
 *
 * Kalan dakika ise elbette akan zamana göre değişir; sayfa 20 saniyede bir
 * kendini tazelediği için sayı canlı görünür. Saat geçmişse kalan süre
 * gösterilmez — "-4 dk" diye bir şey yok, o noktada söylenecek şey "birazdan".
 */
function Eta({
  order,
  de,
  t,
}: {
  order: OrderWithDetails;
  de: boolean;
  t: TrackingText;
}) {
  if (!order.promisedAt) return null;
  if (order.status === "DELIVERED" || order.status === "PICKED_UP") return null;

  const remaining = Math.round((order.promisedAt.getTime() - Date.now()) / 60_000);
  const label = order.fulfillment === "DELIVERY" ? t.etaDelivery : t.etaPickup;

  return (
    <div className="mb-5 border-b border-line pb-5">
      <p className="tag text-smoke">{label}</p>
      <p className="mt-1.5 font-display text-2xl font-extrabold text-amber">
        {t.etaAround} {formatTime(order.promisedAt, de)}
      </p>
      <p className="mt-1 font-mono text-xs text-smoke">
        {remaining > 0 ? t.etaRemaining.replace("{minutes}", String(remaining)) : t.etaSoon}
      </p>
    </div>
  );
}

function VatNote({ order, label }: { order: OrderWithDetails; label: string }) {
  // Döküm sipariş anında dondurulmuştur; güncel fiyatlardan hesaplanmaz.
  const buckets = Array.isArray(order.vatBreakdown)
    ? (order.vatBreakdown as unknown as { rate: number; vatCents: number }[])
    : [];
  if (buckets.length === 0) return null;

  return (
    <p className="mt-3 font-mono text-[11px] text-smoke">
      {label}{" "}
      {buckets.map((b) => `${b.rate}% = ${formatCents(b.vatCents)}`).join(" · ")}
    </p>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest2 text-smoke">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Aksiyon satırındaki bağlantı.
 *
 * `primary` yalnızca birinde açıktır: iki eşit vurgulu düğme, hiç vurgu
 * olmamasıyla aynı kapıya çıkar.
 */
function ActionLink({
  href,
  primary,
  children,
}: {
  href: string;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={[
        "focus-ring border px-4 py-2.5 font-display text-xs font-extrabold tracking-wider transition-colors",
        primary
          ? "border-amber text-amber hover:bg-amber hover:text-void"
          : "border-line text-smoke hover:border-amber hover:text-amber",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-smoke" : "text-bone"}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "warn" | "bad";
  title: string;
  children: React.ReactNode;
}) {
  const border = tone === "bad" ? "border-sumac" : "border-amber";
  const text = tone === "bad" ? "text-sumac" : "text-amber";
  return (
    <div className={`rounded-lg border ${border} bg-char p-6`}>
      <p className={`font-display text-lg ${text}`}>{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-smoke">{children}</p>
    </div>
  );
}

function formatTime(date: Date, de: boolean): string {
  return new Intl.DateTimeFormat(de ? "de-DE" : "tr-TR", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/* -------------------------------------------------------------- metinler */

const texts = {
  de: {
    heading: "Ihre Bestellung",
    items: "Bestellte Artikel",
    subtotal: "Zwischensumme",
    deliveryFee: "Liefergebühr",
    serviceFee: "Servicegebühr",
    total: "Gesamt",
    vatIncluded: "inkl. MwSt:",
    delivery: "Lieferadresse",
    pickup: "Abholung",
    questions: "Fragen zu Ihrer Bestellung?",
    next: "Wie weiter?",
    toMenu: "Zur Speisekarte",
    myOrders: "Meine Bestellungen",
    orderAgain: "Erneut bestellen",
    addedToCart: "Im Warenkorb",
    backHome: "Zur Startseite",
    etaDelivery: "Voraussichtlich bei Ihnen",
    etaPickup: "Voraussichtlich abholbereit",
    etaAround: "ca.",
    etaRemaining: "noch ca. {minutes} Min.",
    etaSoon: "jeden Moment",
    awaitingPayment:
      "Die Zahlung ist noch nicht abgeschlossen. Sobald sie eingeht, beginnen wir mit der Zubereitung.",
    failedHint: "Diese Bestellung wurde nicht ausgeführt. Bei Fragen rufen Sie uns bitte an.",
  },
  tr: {
    heading: "Siparişiniz",
    items: "Sipariş içeriği",
    subtotal: "Ara toplam",
    deliveryFee: "Teslimat ücreti",
    serviceFee: "Servis ücreti",
    total: "Toplam",
    vatIncluded: "KDV dahil:",
    delivery: "Teslimat adresi",
    pickup: "Gel-al",
    questions: "Siparişinizle ilgili sorunuz mu var?",
    next: "Şimdi ne yapmak istersiniz?",
    toMenu: "Menüye git",
    myOrders: "Siparişlerim",
    orderAgain: "Tekrar sipariş ver",
    addedToCart: "Sepete eklendi",
    backHome: "Ana sayfaya dön",
    etaDelivery: "Tahmini teslimat",
    etaPickup: "Tahminen hazır olur",
    etaAround: "yaklaşık",
    etaRemaining: "yaklaşık {minutes} dk kaldı",
    etaSoon: "birazdan",
    awaitingPayment:
      "Ödeme henüz tamamlanmadı. Ödeme ulaştığında hazırlığa başlıyoruz.",
    failedHint: "Bu sipariş gerçekleştirilmedi. Sorunuz varsa lütfen bizi arayın.",
  },
} as const;
