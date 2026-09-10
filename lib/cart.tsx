"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import type { CartLineInput } from "@/lib/admin/store";
import type { CheckoutQuote } from "@/lib/orders/checkout";
import { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * Sepet.
 *
 * Önemli kural: sepet **fiyat tutmaz**. Yalnızca "ne seçildi, nereye, nasıl"
 * bilgisini (ürün kimliği, boy, adet, teslim biçimi ve posta kodu) saklar; tutarların tamamı `/api/menu/quote` ucundan, katalogtaki
 * güncel fiyatlardan gelir — teslimat ücreti ve genel toplam dahil.
 *
 * Bunun üç sonucu var:
 *  - Admin panelinde fiyat değiştiğinde açık sepetler de doğru tutarı gösterir.
 *  - localStorage'daki eski bir sepet, eski fiyatı geri getiremez.
 *  - İstemci tarafında fiyat üretilmediği için kurcalanacak bir alan da yoktur.
 */

export type CartLine = CartLineInput;

/** Satırı sepette benzersiz kılan anahtar; sunucudaki karşılığıyla aynı biçim. */
export function lineKey(line: CartLine): string {
  return `product:${line.productId}|${line.variantSize ?? ""}`;
}

type PricingState = "idle" | "loading" | "ready" | "error";

export type Fulfillment = "DELIVERY" | "PICKUP";

/** Birleşim tipinin her üyesinden ayrı ayrı alan siler (düz `Omit` birleşimi ezer). */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** Sepete eklerken adet isteğe bağlıdır; fiyat alanı hiç yoktur. */
export type CartLineDraft = DistributiveOmit<CartLine, "qty"> & { qty?: number };

type CartState = {
  lines: CartLine[];
  count: number;
  quote: CheckoutQuote | null;
  pricing: PricingState;
  /**
   * localStorage okundu mu.
   *
   * İlk render'da sepet her zaman boştur (SSR ile uyuşmazlık olmasın diye);
   * bunu "sepetiniz boş" diye göstermek, dolu sepetle ödeme sayfasına gelen
   * müşteriye bir an boş ekran gösterir. Ayrım için bu bayrak gerekiyor.
   */
  loaded: boolean;
  isOpen: boolean;
  /** Teslim biçimi. Teklif ve teslimat ücreti buna göre hesaplanır. */
  fulfillment: Fulfillment;
  /** Seçilen teslimat posta kodu; seçilmediyse boş. */
  zip: string;
  add: (line: CartLineDraft) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  setFulfillment: (value: Fulfillment) => void;
  setZip: (value: string) => void;
  openCart: () => void;
  closeCart: () => void;
};

const CartContext = createContext<CartState | null>(null);

/** v2: eski kayıtlar fiyat içerdiği için bilinçli olarak yeni anahtar kullanılır. */
const STORAGE_KEY = "the-doner-cart-v2";
/**
 * Teslim tercihi sepetten ayrı saklanır: sepet boşalınca silinir, tercih
 * kalır. Müşteri her seferinde "gel-al" demek zorunda kalmasın.
 */
const PREFS_KEY = "the-doner-checkout-prefs-v1";
const MAX_QTY = 99;

function sanitize(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return [];
  const out: CartLine[] = [];
  for (const raw of value.slice(0, 60)) {
    if (typeof raw !== "object" || raw === null) continue;
    const line = raw as Record<string, unknown>;
    const qty = Math.min(
      MAX_QTY,
      Math.max(1, Math.floor(typeof line.qty === "number" ? line.qty : 1))
    );
    /*
     * Yalnızca ürün satırı tanınır.
     *
     * Kaldırılan "Kendin Seç" bölümünün kendi satır türü vardı ve o satırlar
     * hâlâ ziyaretçilerin localStorage'ında duruyor olabilir. Burada
     * tanınmadıkları için sessizce düşerler — sepette fiyatlanamayacak bir
     * satır bırakmaktan iyisi bu.
     */
    if (line.kind === "product" && typeof line.productId === "string") {
      out.push({
        kind: "product",
        productId: line.productId,
        ...(typeof line.variantSize === "string" ? { variantSize: line.variantSize } : {}),
        qty,
      });
    }
  }
  return out;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { lang } = useLanguage();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [pricing, setPricing] = useState<PricingState>("idle");
  const [fulfillment, setFulfillmentState] = useState<Fulfillment>("DELIVERY");
  const [zip, setZipState] = useState("");

  // İlk render'da localStorage okunmaz (SSR ile uyuşmazlık olurdu); yükleme
  // bittikten sonra yazmaya başlarız, yoksa boş sepet kayıtlıyı eziyor.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setLines(sanitize(JSON.parse(raw)));
    } catch {
      // bozuk kayıt veya erişim engeli: sepet boş başlar
    }
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const prefs = JSON.parse(raw) as { fulfillment?: unknown; zip?: unknown };
        if (prefs.fulfillment === "PICKUP" || prefs.fulfillment === "DELIVERY") {
          setFulfillmentState(prefs.fulfillment);
        }
        // Kayıtlı posta kodu bölge listesinden düşmüş olabilir; biçim tutuyorsa
        // yazılır, geçerliliğine her zaman sunucu karar verir.
        if (typeof prefs.zip === "string" && /^\d{5}$/.test(prefs.zip)) {
          setZipState(prefs.zip);
        }
      }
    } catch {
      // tercih okunamadı: varsayılan teslimat, boş posta kodu
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // kota dolu / gizli sekme: sepet yine bellekte çalışır
    }
  }, [lines, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ fulfillment, zip }));
    } catch {
      // tercih saklanamadı: oturum boyunca bellekte kalır
    }
  }, [fulfillment, zip, loaded]);

  /*
   * Sepet içeriği ya da dil değiştiğinde tutarları sunucudan tazele.
   *
   * Panelde hiç istenmez: mutfak tabletinde tarayıcı deposunda kalmış eski bir
   * sepet, sipariş ekranı her açıldığında karşılıksız bir fiyat isteği
   * doğuruyordu. Panelin sepetle işi yok — çekmecesi de çizilmiyor
   * (`components/CartMount.tsx`).
   */
  const pathname = usePathname();
  const onAdmin = pathname?.startsWith("/admin") ?? false;
  const requestId = useRef(0);
  useEffect(() => {
    if (!loaded || onAdmin) return;

    if (lines.length === 0) {
      setQuote(null);
      setPricing("idle");
      return;
    }

    const id = ++requestId.current;
    const controller = new AbortController();
    setPricing((prev) => (prev === "ready" ? "ready" : "loading"));

    fetch("/api/menu/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines, lang, fulfillment, zip }),
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("quote"))))
      .then((data: CheckoutQuote) => {
        // Yarışan istekler: yalnızca en son isteğin sonucu yazılır.
        if (id !== requestId.current) return;
        setQuote(data);
        setPricing("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || id !== requestId.current) return;
        void error;
        setPricing("error");
      });

    return () => controller.abort();
  }, [lines, lang, fulfillment, zip, loaded, onAdmin]);

  const add = useCallback((line: CartLineDraft) => {
    const qty = Math.min(MAX_QTY, Math.max(1, Math.floor(line.qty ?? 1)));
    const next = { ...line, qty } as CartLine;
    const key = lineKey(next);
    setLines((prev) => {
      const found = prev.find((l) => lineKey(l) === key);
      if (found) {
        return prev.map((l) =>
          lineKey(l) === key ? { ...l, qty: Math.min(MAX_QTY, l.qty + qty) } : l
        );
      }
      return [...prev, next];
    });
  }, []);

  const setQty = useCallback((key: string, qty: number) => {
    setLines((prev) =>
      qty <= 0
        ? prev.filter((l) => lineKey(l) !== key)
        : prev.map((l) =>
            lineKey(l) === key ? { ...l, qty: Math.min(MAX_QTY, Math.floor(qty)) } : l
          )
    );
  }, []);

  const remove = useCallback((key: string) => {
    setLines((prev) => prev.filter((l) => lineKey(l) !== key));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const setFulfillment = useCallback((value: Fulfillment) => {
    setFulfillmentState(value);
    // Gel-ala geçince posta kodu anlamını yitirir; bırakılırsa teslimata geri
    // dönüldüğünde eski bölgenin ücreti sessizce geri gelirdi.
    if (value === "PICKUP") setZipState("");
  }, []);

  const setZip = useCallback((value: string) => {
    setZipState(value.replace(/\D/g, "").slice(0, 5));
  }, []);

  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);

  const value = useMemo<CartState>(() => {
    const count = lines.reduce((n, l) => n + l.qty, 0);
    return {
      lines,
      count,
      quote,
      pricing,
      loaded,
      isOpen,
      fulfillment,
      zip,
      add,
      setQty,
      remove,
      clear,
      setFulfillment,
      setZip,
      openCart,
      closeCart,
    };
  }, [
    lines,
    quote,
    pricing,
    loaded,
    isOpen,
    fulfillment,
    zip,
    add,
    setQty,
    remove,
    clear,
    setFulfillment,
    setZip,
    openCart,
    closeCart,
  ]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart, CartProvider içinde kullanılmalı");
  return ctx;
}
