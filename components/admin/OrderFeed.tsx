"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Fulfillment, OrderStatus, PaymentStatus } from "@prisma/client";
import { formatCents } from "@/lib/money";
import { ADMIN_STATUS_LABELS, isTerminal, needsRefund, nextStatuses } from "@/lib/orders/status";
import { CANCEL_REASONS, adminCancelLabel } from "@/lib/orders/cancelReasons";
import { playOrderAlert, unlockAudio } from "@/lib/kitchenAudio";
import { useScrollLock } from "@/lib/useScrollLock";
import { Button, TextArea, Toggle } from "./ui";
import OrderReceipt from "./OrderReceipt";

/**
 * Canlı sipariş panosu.
 *
 * Dört şey bilinçli olarak böyle:
 *
 *  1. **Sütunlu pano, düz liste değil.** Mutfak "şu an ne yapmam gerek"
 *     sorusuna bakar; yeni gelen, hazırlanan ve yolda olan siparişler tek
 *     kolonda alt alta dizildiğinde bu soru cevapsız kalıyordu.
 *  2. **Bekleme sayacı.** Bir siparişin kaç dakikadır beklediği mutfaktaki en
 *     kritik sinyaldir. Süre **sunucu saatinden** hesaplanır (`now` alanı);
 *     panel bilgisayarının saati yanlış ayarlıysa da doğru çalışır.
 *  3. **Yoklama, uzun bağlantı değil.** Beş saniyede bir istek atılır. SSE
 *     daha zarif olurdu ama sessizce ölebiliyor; kaçan bir sipariş, birkaç
 *     saniyelik gecikmeden çok daha pahalı.
 *  4. **Susmayan uyarı.** Yeni sipariş "Görüldü"ye basılana kadar düzenli
 *     aralıklarla çalar. Mutfakta tek bir çınlama duyulmayabilir.
 *  5. **Ses varsayılan olarak açık.** Panelin tek işi siparişi kaçırmamak;
 *     bunun için her açılışta bir düğmeye basılmasını beklemek yanlış
 *     varsayılandı — unutulan tek bir tık sessiz bir vardiya demekti.
 *     Tarayıcı etkileşimsiz ses çalmaya izin vermediği için kilit ilk
 *     dokunuş/tuşta kendiliğinden açılır; açılana kadar bunu söyleyen bir
 *     uyarı durur. Kapatma tercihi tarayıcıda saklanır.
 */

/** Ses tercihi burada saklanır; varsayılan "açık", yalnızca kapatma yazılır. */
const SOUND_KEY = "sami.admin.sound";

const POLL_MS = 5_000;
const ALERT_MS = 4_000;
/** Bekleme sayacının tazelenme aralığı; dakika gösterildiği için sık olmasına gerek yok. */
const TICK_MS = 15_000;
/** Bu kadar üst üste başarısız istekten sonra bağlantı kopmuş sayılır. */
const FAIL_THRESHOLD = 2;

/** Kaç dakikadan sonra sipariş "geciken" sayılır. */
const WARN_MINUTES = 12;
const LATE_MINUTES = 25;

type Line = {
  id: string;
  label: string;
  detail: string;
  qty: number;
  unitCents: number;
  lineCents: number;
  vatRate: number;
};

export type KitchenOrder = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  fulfillment: Fulfillment;
  customerName: string;
  phone: string;
  email: string;
  lang: string;
  street: string;
  houseNo: string;
  floor: string;
  bellName: string;
  zip: string;
  city: string;
  note: string;
  totalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  subtotalCents: number;
  paymentStatus: PaymentStatus;
  createdAt: string;
  acknowledgedAt: string | null;
  cancelReason: string | null;
  requestedAt: string | null;
  promisedAt: string | null;
  vatBreakdown: unknown;
  lines: Line[];
};

const ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: "Kabul et",
  // Mutfak bu düğmeye hazırlığa başlarken değil, bitirdiğinde basar.
  PREPARING: "Hazırlandı",
  READY: "Hazır",
  OUT_FOR_DELIVERY: "Yola çıktı",
  DELIVERED: "Teslim edildi",
  PICKED_UP: "Teslim alındı",
  CANCELLED: "İptal et",
  REJECTED: "Reddet",
};

/**
 * Panonun sütunları.
 *
 * Sıra iş akışını izler: gelen → mutfakta → yolda → bitti. Her sipariş tam
 * olarak bir sütuna girer, dolayısıyla "bu nerede?" diye aranmaz.
 */
const COLUMNS: {
  key: string;
  title: string;
  statuses: OrderStatus[];
  /**
   * Kartlar kapalı mı başlasın.
   *
   * Kapanmış siparişte mutfağın okuyacak bir şeyi kalmamıştır; o sütun bir
   * kayıttır, iş listesi değil. Satırların tamamı açık dururken pano gereksiz
   * yere uzuyor ve asıl bakılması gereken sütunlar aşağı kayıyordu. Numara ve
   * tutar görünür kalır — "şu siparişin parası ne kadardı" sorusu için yeter;
   * gerisi ok ile açılır.
   */
  collapsed?: boolean;
}[] = [
  { key: "new", title: "Yeni", statuses: ["PAID"] },
  { key: "kitchen", title: "Mutfakta", statuses: ["ACCEPTED", "PREPARING"] },
  { key: "out", title: "Yolda / Hazır", statuses: ["OUT_FOR_DELIVERY", "READY"] },
  {
    key: "done",
    title: "Bugün kapananlar",
    statuses: ["DELIVERED", "PICKED_UP", "CANCELLED", "REJECTED"],
    collapsed: true,
  },
];

export default function OrderFeed() {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [connected, setConnected] = useState(true);
  /**
   * Sesli uyarı açık mı — varsayılan **açık**.
   *
   * İlk render sunucuda da istemcide de `true`; tercih (yalnızca "kapalı"
   * olabilir) bağlandıktan sonra okunur, böylece hidrasyon uyuşmazlığı olmaz.
   */
  const [soundOn, setSoundOn] = useState(true);
  /** Ses açık ama tarayıcı henüz izin vermedi: kullanıcıya söylenmesi gerekir. */
  const [audioLocked, setAudioLocked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [printing, setPrinting] = useState<KitchenOrder | null>(null);
  /**
   * İptal penceresi.
   *
   * İptal/ret tek dokunuşla yapılmaz: hangi siparişin hangi durumla
   * kapatılacağı burada bekletilir, sebep seçilene kadar sunucuya hiçbir şey
   * gitmez. Sebep zorunluluğu sunucuda da var (bkz. api/admin/orders/[id]);
   * bu pencere onu atlatılabilir kılmaz, yalnızca kullanılabilir yapar.
   */
  const [cancelling, setCancelling] = useState<{
    order: KitchenOrder;
    status: OrderStatus;
  } | null>(null);

  /**
   * Sunucu ile tarayıcı saati arasındaki fark (ms).
   *
   * Mutfaktaki panel bilgisayarının saati sık sık yanlış olur. Süreleri
   * doğrudan `Date.now()` ile hesaplamak, saati beş dakika ileri olan bir
   * makinede her siparişi "5 dk gecikmiş" gösterirdi.
   */
  const [clockSkew, setClockSkew] = useState(0);
  /** Sayaçları düzenli aralıklarla yeniden çizdirmek için artan sayaç. */
  const [, setTick] = useState(0);

  const failures = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/admin/orders", { signal, cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { orders: KitchenOrder[]; now?: string };
      setOrders(data.orders);
      if (data.now) setClockSkew(new Date(data.now).getTime() - Date.now());
      failures.current = 0;
      setConnected(true);
    } catch (error) {
      if (signal?.aborted) return;
      void error;
      failures.current += 1;
      if (failures.current >= FAIL_THRESHOLD) setConnected(false);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const id = setInterval(() => void load(controller.signal), POLL_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [load]);

  // Bekleme süreleri istek gelmese de akmalı; liste değişmediğinde de tazelenir.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Onaylanmamış ödenmiş siparişler: uyarının sebebi bunlar.
  const pending = useMemo(
    () => orders.filter((o) => o.status === "PAID" && !o.acknowledgedAt),
    [orders]
  );

  /*
   * Ses kilidini kendiliğinden açma denemesi.
   *
   * Tarayıcı, sayfa etkileşim görmeden `AudioContext`i çalıştırmaz. Panel
   * genelde açık kalan bir ekranda durduğu için tek bir dokunuş yeter; bunu
   * ayrı bir düğmeye bağlamak yerine ilk dokunuşu/tuşu dinliyoruz. Deneme
   * ayrıca hemen bir kez yapılır: sayfa daha önce etkileşim görmüşse
   * (yenileme, gezinme) kilit zaten açıktır ve uyarı hiç görünmez.
   */
  useEffect(() => {
    if (!soundOn) {
      setAudioLocked(false);
      return;
    }

    let alive = true;
    const detach = () => {
      window.removeEventListener("pointerdown", attempt);
      window.removeEventListener("keydown", attempt);
    };
    function attempt() {
      void unlockAudio().then((ok) => {
        if (!alive) return;
        setAudioLocked(!ok);
        if (ok) detach();
      });
    }

    window.addEventListener("pointerdown", attempt);
    window.addEventListener("keydown", attempt);
    attempt();

    return () => {
      alive = false;
      detach();
    };
  }, [soundOn]);

  // Kapatma tercihi kalıcı; "açık" varsayılan olduğu için yazılmasına gerek yok.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SOUND_KEY) === "off") setSoundOn(false);
    } catch {
      // Özel sekmede depolama kapalı olabilir; varsayılan açık kalır.
    }
  }, []);

  useEffect(() => {
    if (!soundOn || pending.length === 0) return;
    playOrderAlert();
    const id = setInterval(playOrderAlert, ALERT_MS);
    return () => clearInterval(id);
  }, [soundOn, pending.length]);

  /**
   * Yazdırma.
   *
   * Fiş DOM'a basıldıktan **sonra** `window.print()` çağrılmak zorunda; aynı
   * karede çağrılırsa tarayıcı henüz boş olan kutuyu yazdırır. İki kare
   * beklemek, React'in yerleştirmesi ile tarayıcının boyamasının tamamlanması
   * için yeterli.
   */
  useEffect(() => {
    if (!printing) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        window.print();
        setPrinting(null);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [printing]);

  async function act(order: KitchenOrder, body: Record<string, unknown>) {
    setBusy(order.id);
    setActionError(null);
    try {
      const response = await fetch(`/api/admin/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setActionError(data?.error ?? "İşlem tamamlanamadı.");
      }
      // Başarılı ya da değil, gerçek durumu sunucudan tazele.
      await load();
    } catch {
      setActionError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmCancel(reasonId: string, reasonNote: string) {
    if (!cancelling) return;
    await act(cancelling.order, {
      action: "transition",
      status: cancelling.status,
      reasonId,
      reasonNote,
    });
    setCancelling(null);
  }

  function toggleSound(next: boolean) {
    setSoundOn(next);
    try {
      window.localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      // Tercih saklanamadı; oturum boyunca yine de geçerli.
    }
    if (!next) return;
    // Açma dokunuşu kilidi de açar; kısa bir çınlama "çalışıyor" der.
    void unlockAudio().then((ok) => {
      setAudioLocked(!ok);
      if (ok) playOrderAlert();
    });
  }

  /** Siparişin üstünden geçen dakika — sunucu saatine göre. */
  const minutesSince = (iso: string): number => {
    const elapsed = Date.now() + clockSkew - new Date(iso).getTime();
    return Math.max(0, Math.floor(elapsed / 60_000));
  };

  const byColumn = useMemo(
    () =>
      COLUMNS.map((column) => ({
        ...column,
        orders: orders.filter((order) => column.statuses.includes(order.status)),
      })),
    [orders]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {/* Varsayılan açık; bu düğme yalnızca susturmak (ve geri açmak) için. */}
        <Toggle
          checked={soundOn}
          onChange={toggleSound}
          onLabel="♪ SES AÇIK"
          offLabel="♪ SES KAPALI"
        />

        {/* Tarayıcı kilidi: ses açık görünüyor ama henüz çalamıyor. Bunu
            söylememek, uyarının sessizce kaçırılması demekti. */}
        {soundOn && audioLocked && (
          <button
            type="button"
            onClick={() => void unlockAudio().then((ok) => setAudioLocked(!ok))}
            className="focus-ring tag animate-pulse border border-amber bg-amber/10 px-3 py-2 text-amber"
          >
            Sesi açmak için dokunun
          </button>
        )}

        <span className={`tag px-3 py-2 ${connected ? "text-smoke" : "text-flame"}`}>
          {connected ? `● Canlı — ${POLL_MS / 1000} sn` : "● Bağlantı yok"}
        </span>

        {pending.length > 0 && (
          <span className="tag animate-pulse border border-flame bg-flame/15 px-3 py-2 text-flame">
            {pending.length} yeni sipariş
          </span>
        )}
      </div>

      {!connected && (
        <p role="alert" className="border border-flame/60 bg-flame/10 px-4 py-3 text-sm text-flame">
          Sunucuya ulaşılamıyor. Liste güncel olmayabilir — yeni siparişler burada görünmeyecek.
        </p>
      )}

      {actionError && (
        <p role="alert" className="border border-flame/60 bg-flame/10 px-4 py-3 text-sm text-flame">
          {actionError}
        </p>
      )}

      {!loaded ? (
        <p className="text-sm text-smoke">Yükleniyor…</p>
      ) : (
        /* Dört sütun geniş ekranda yan yana; dar ekranda alt alta yığılır.
           Mutfak panosu genelde sabit bir ekranda durur, ama telefondan
           bakıldığında da kullanılabilir olmalı. */
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          {byColumn.map((column) => (
            <section key={column.key} className="min-w-0">
              <header className="mb-3 flex items-center justify-between gap-2 border-b border-line pb-2">
                <h2 className="tag text-bone">{column.title}</h2>
                <span className="tag tabular-nums text-smoke">{column.orders.length}</span>
              </header>

              {column.orders.length === 0 ? (
                <p className="border border-line/60 bg-char/50 px-4 py-6 text-center text-xs text-smoke">
                  —
                </p>
              ) : (
                <ul className="space-y-3">
                  {column.orders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      collapsible={column.collapsed ?? false}
                      minutes={minutesSince(order.createdAt)}
                      busy={busy === order.id}
                      onAcknowledge={() => act(order, { action: "acknowledge" })}
                      onTransition={(status) =>
                        status === "CANCELLED" || status === "REJECTED"
                          ? setCancelling({ order, status })
                          : act(order, { action: "transition", status })
                      }
                      onDelay={(minutes) => act(order, { action: "delay", minutes })}
                      onPrint={() => setPrinting(order)}
                    />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {cancelling && (
        <CancelDialog
          orderNo={cancelling.order.orderNo}
          status={cancelling.status}
          /* İade, geçişin kaynağına bakar: ödemesi hiç alınmamış siparişte
             (PENDING_PAYMENT / EXPIRED) iade edilecek para yoktur. */
          refundCents={
            needsRefund(cancelling.order.status) &&
            cancelling.order.paymentStatus === "PAID"
              ? cancelling.order.totalCents
              : 0
          }
          busy={busy === cancelling.order.id}
          onCancel={() => setCancelling(null)}
          onConfirm={confirmCancel}
        />
      )}

      {/* Yazdırılacak fiş. Ekranda görünmez (`.receipt-root` gizli), yalnızca
          yazdırma sırasında ortaya çıkar — bkz. globals.css. */}
      {printing && <OrderReceipt order={printing} />}
    </div>
  );
}

function OrderCard({
  order,
  collapsible,
  minutes,
  busy,
  onAcknowledge,
  onTransition,
  onDelay,
  onPrint,
}: {
  order: KitchenOrder;
  /** Kapanmış sütunda kart özet hâlinde başlar; ayrıntı ok ile açılır. */
  collapsible: boolean;
  minutes: number;
  busy: boolean;
  onAcknowledge: () => void;
  onTransition: (status: OrderStatus) => void;
  onDelay: (minutes: 5 | 10 | 15) => void;
  onPrint: () => void;
}) {
  const [open, setOpen] = useState(false);
  const showDetails = !collapsible || open;

  const isNew = order.status === "PAID" && !order.acknowledgedAt;
  const actions = nextStatuses(order.status, order.fulfillment);
  const closed = isTerminal(order.status);

  /*
   * Bekleme süresinin rengi.
   *
   * Kapanmış siparişte süre bir uyarı değil, kayıt: teslim edilmiş bir sipariş
   * "45 dk" diye kırmızı yandığında pano boşuna alarm verir.
   */
  const ageTone = closed
    ? "text-smoke"
    : minutes >= LATE_MINUTES
      ? "text-flame"
      : minutes >= WARN_MINUTES
        ? "text-amber"
        : "text-herb";

  return (
    <li
      className={`border bg-char p-4 transition-colors ${
        isNew ? "border-flame shadow-[0_0_40px_-18px_rgba(255,61,18,0.9)]" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-base font-extrabold text-bone">{order.orderNo}</p>
          <p className="tag mt-0.5 text-smoke">
            {order.fulfillment === "DELIVERY" ? "Teslimat" : "Gel-al"} ·{" "}
            {new Date(order.createdAt).toLocaleTimeString("de-DE", {
              timeZone: "Europe/Berlin",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-lg font-extrabold tabular-nums text-amber">
            {formatCents(order.totalCents)}
          </p>
          <p className={`tag mt-0.5 tabular-nums ${ageTone}`}>{minutes} dk</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="tag text-smoke">{ADMIN_STATUS_LABELS[order.status]}</p>
        {/* Müşteriye söz verilen saat. Mutfağın bu sayıyı görmesi, gecikme
            bildirimini zamanında yapabilmesinin ön koşulu. */}
        {order.promisedAt && !closed && (
          <p className="tag text-amber">
            Söz: {new Date(order.promisedAt).toLocaleTimeString("de-DE", {
              timeZone: "Europe/Berlin",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        )}

        {collapsible && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="focus-ring tag ml-auto border border-line px-2.5 py-1 text-smoke transition-colors hover:border-amber hover:text-amber"
          >
            <span aria-hidden className="mr-1.5 inline-block">
              {open ? "▾" : "▸"}
            </span>
            {open ? "Kapat" : "Detay"}
          </button>
        )}
      </div>

      {showDetails && (
        <>
      {/* Kapanmış siparişte sebep kartın üstünde durur: müşteri arayıp
          "neden iptal edildi?" dediğinde cevabı aramak gerekmesin. */}
      {order.cancelReason && (
        <p className="mt-2 border-l-2 border-flame bg-void px-3 py-2 text-xs text-smoke">
          <span className="text-flame">İptal sebebi:</span>{" "}
          {adminCancelLabel(order.cancelReason)}
        </p>
      )}

      <ul className="mt-3 space-y-1 border-t border-line pt-3">
        {order.lines.map((line) => (
          <li key={line.id} className="flex gap-2 text-sm">
            <span className="font-mono text-amber">{line.qty}×</span>
            <span className="min-w-0 flex-1 text-bone">
              {line.label}
              {line.detail && <span className="block text-xs text-smoke">{line.detail}</span>}
            </span>
            <span className="shrink-0 font-mono tabular-nums text-smoke">
              {formatCents(line.lineCents)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 border-t border-line pt-3 text-sm text-smoke">
        <p className="text-bone">{order.customerName}</p>
        <a href={`tel:${order.phone}`} className="text-amber">
          {order.phone}
        </a>
        {order.fulfillment === "DELIVERY" && (
          <>
            <p className="mt-1">
              {order.street} {order.houseNo}, {order.zip} {order.city}
            </p>
            {/* Kat ve zil ismi kuryeye ayrı satırda ve vurgulu verilir:
                adresin içine gömülürse kapıda okunmaz. */}
            {(order.floor || order.bellName) && (
              <p className="mt-1 text-bone">
                {[order.floor, order.bellName && `Zil: ${order.bellName}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </>
        )}
        {order.note && (
          <p className="mt-2 border-l-2 border-amber pl-3 text-bone">{order.note}</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {isNew && (
          <Button onClick={onAcknowledge} disabled={busy}>
            Görüldü
          </Button>
        )}
        {actions.map((status) => (
          <Button
            key={status}
            variant={status === "CANCELLED" || status === "REJECTED" ? "danger" : "ghost"}
            onClick={() => onTransition(status)}
            disabled={busy}
          >
            {ACTION_LABELS[status] ?? ADMIN_STATUS_LABELS[status]}
          </Button>
        ))}
        <Button variant="ghost" onClick={onPrint}>
          Fiş
        </Button>
      </div>

      {/*
        Gecikme bildirimi.
        Yalnızca söz verilmiş ve kapanmamış siparişte anlamlı. Serbest dakika
        yazdırmak yerine üç sabit düğme: yoğun mutfakta tek dokunuş yeter ve
        yanlışlıkla "+120 dk" gönderilemez. Müşteri yeni saati takip
        sayfasında 20 saniye içinde görür.
      */}
      {order.promisedAt && !closed && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <span className="tag text-smoke">Gecikme bildir:</span>
          {([5, 10, 15] as const).map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => onDelay(minutes)}
              disabled={busy}
              className="focus-ring tag border border-line px-2.5 py-1.5 text-smoke transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
            >
              +{minutes} dk
            </button>
          ))}
        </div>
      )}
        </>
      )}

    </li>
  );
}


/* ------------------------------------------------------------ iptal penceresi */

/**
 * İptal/ret sebebi seçimi.
 *
 * Seçilen sebep müşteriye **kendi dilinde** gösterilir; bu yüzden panelde
 * yazılan serbest bir metin değil, listeden bir kimlik gönderilir
 * (bkz. lib/orders/cancelReasons.ts). "Diğer" seçildiğinde yazılan cümle
 * müşteriye olduğu gibi gider — bu yüzden o alanda ne yazıldığının müşteri
 * tarafından okunacağı ekranda açıkça söylenir.
 *
 * Onay düğmesi sebep seçilmeden basılamaz. Sunucu da sebepsiz iptali
 * reddeder; buradaki engel kolaylık, oradaki kural.
 */
function CancelDialog({
  orderNo,
  status,
  refundCents,
  busy,
  onCancel,
  onConfirm,
}: {
  orderNo: string;
  status: OrderStatus;
  /** İade edilecek tutar; 0 ise ödeme alınmamış demektir ve iade yapılmaz. */
  refundCents: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reasonId: string, reasonNote: string) => void;
}) {
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const isOther = reasonId === "OTHER";
  const ready = reasonId !== "" && (!isOther || note.trim().length >= 3);
  const preview = CANCEL_REASONS.find((reason) => reason.id === reasonId);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${orderNo} — iptal sebebi`}
      className="fixed inset-0 z-[80] overflow-y-auto overscroll-contain bg-void/85 backdrop-blur-sm"
    >
      {/*
        Kaydırma dış kutuda, ortalama içte.

        Pencere kısayken ortada durur; sebep listesi + serbest metin alanı
        ekrandan uzun olduğunda `min-h-full` sayesinde yukarı yapışır ve
        tamamı kaydırılarak okunur. Ortalamayı dış kutuya koymak, uzun
        içerikte pencerenin üstünü ekranın dışına itiyor ve oraya
        erişilemiyordu.
      */}
      <div className="flex min-h-full items-center justify-center p-4 md:p-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onConfirm(reasonId, note);
        }}
        className="ember-surface w-full max-w-[560px] border border-line p-6 md:p-8"
      >
        <h2 className="font-display text-xl font-extrabold text-bone">
          {status === "REJECTED" ? "Siparişi reddet" : "Siparişi iptal et"} — {orderNo}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-smoke">
          Sebebi seçin. Seçtiğiniz açıklama müşterinin sipariş takip sayfasında
          <strong className="text-bone"> kendi dilinde</strong> görünür ve
          siparişin geçmişine yazılır.
        </p>

        <div className="mt-6 space-y-1">
          {CANCEL_REASONS.map((reason) => (
            <label
              key={reason.id}
              className={`flex cursor-pointer items-start gap-3 border px-4 py-3 transition-colors ${
                reasonId === reason.id
                  ? "border-amber bg-amber/10 text-bone"
                  : "border-line bg-void text-smoke hover:border-smoke"
              }`}
            >
              <input
                type="radio"
                name="cancelReason"
                value={reason.id}
                checked={reasonId === reason.id}
                onChange={() => {
                  setReasonId(reason.id);
                  if (reason.id === "OTHER") {
                    // Serbest metin seçildiyse imleç oraya gitsin; ekstra bir
                    // tık, yoğun mutfakta kaybedilen bir saniyedir.
                    requestAnimationFrame(() => noteRef.current?.focus());
                  }
                }}
                className="mt-0.5 accent-amber"
              />
              <span className="text-sm">{reason.admin}</span>
            </label>
          ))}
        </div>

        {isOther && (
          <div className="mt-4">
            <label htmlFor="cancelNote" className="tag mb-2 block text-smoke">
              Müşteriye gösterilecek açıklama
            </label>
            <TextArea
              id="cancelNote"
              ref={noteRef}
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Bu metni müşteri aynen okuyacak."
            />
          </div>
        )}

        {preview && !isOther && (
          <div className="mt-4 border-l-2 border-amber bg-void px-4 py-3">
            <p className="tag text-smoke">Müşteri şunu görecek</p>
            <p className="mt-1.5 text-sm text-bone">{preview.tr}</p>
            <p className="mt-1 text-xs text-smoke/70">{preview.de}</p>
          </div>
        )}

        {/*
          Para uyarısı.

          Onay penceresinin buraya kadar olan kısmı "müşteri ne görecek"i
          anlatıyor; bu blok "kasadan ne çıkacak"ı. İkisi ayrı sorulardır ve
          iade geri alınamaz — tutar, onaya basmadan önce ekranda görünmeli.
        */}
        {refundCents > 0 ? (
          <div className="mt-4 border border-flame/60 bg-flame/10 px-4 py-3">
            <p className="tag text-flame">Para iadesi</p>
            <p className="mt-1.5 text-sm text-bone">
              Onaylarsanız <strong>{formatCents(refundCents)}</strong> müşteriye
              iade edilecek. Bu işlem geri alınamaz.
            </p>
          </div>
        ) : (
          <div className="mt-4 border border-line bg-void px-4 py-3">
            <p className="text-xs leading-relaxed text-smoke">
              Bu siparişin ödemesi alınmadığı için iade yapılmayacak.
            </p>
          </div>
        )}

        <div className="mt-8 flex flex-wrap justify-end gap-3 border-t border-line pt-6">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            VAZGEÇ
          </Button>
          <Button type="submit" variant="danger" disabled={!ready || busy}>
            {busy
              ? "GÖNDERİLİYOR…"
              : refundCents > 0
                ? `${status === "REJECTED" ? "REDDET" : "İPTAL ET"} VE ${formatCents(refundCents)} İADE ET`
                : status === "REJECTED"
                  ? "REDDET VE MÜŞTERİYE BİLDİR"
                  : "İPTAL ET VE MÜŞTERİYE BİLDİR"}
          </Button>
        </div>
      </form>
      </div>
    </div>
  );
}
