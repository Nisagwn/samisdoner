"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCart } from "@/lib/cart";
import { formatCents } from "@/lib/money";
import AllergenWarning from "@/components/legal/AllergenWarning";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { createOrderAction } from "@/lib/orders/actions";
import type { OrderError } from "@/lib/orders/result";
import {
  EMPTY_CHECKOUT_FORM,
  toCreateOrderInput,
  validateCheckoutForm,
  type CheckoutFieldErrors,
  type CheckoutFormValues,
} from "@/lib/checkout/validate";
import { Button, Field, Notice, TextInput } from "@/components/ui";
import { BUSINESS_INFO } from "@/data/businessInfo";
import type { DeliveryCity } from "@/app/api/menu/delivery/route";
import type { MenuStatus } from "@/app/api/menu/status/route";
import type { AddressRecord } from "@/lib/account/addresses";
import type { OrderOptions } from "@/app/api/orders/options/route";
import { AddressFields } from "./AddressFields";
import { SavedAddresses } from "./SavedAddresses";
import { FulfillmentSwitch } from "./FulfillmentSwitch";
import { MinimumProgress, SummaryPanel } from "./SummaryPanel";
import { TimingPicker } from "./TimingPicker";
import { PaymentMethodPicker, type PaymentMethodChoice } from "./PaymentMethodPicker";
import { TipSelector } from "./TipSelector";
import { CouponField, describeRejection } from "./CouponField";
import { useCheckoutQuote } from "./useCheckoutQuote";

/**
 * Ödeme sayfası.
 *
 * Bu ekran sepet çekmecesinden çıkarıldı. Sebebi tek cümleyle: siparişlerin
 * büyük çoğunluğu telefondan veriliyor ve adres formu 420 piksellik sabit bir
 * çekmecenin içine sığmıyordu — o dosyada tek bir duyarlı sınıf bile yoktu.
 * Artık mobilde tam sayfa tek sütun, masaüstünde solda form / sağda yapışkan
 * özet.
 *
 * Değişmeyen kural: burada **hiçbir tutar hesaplanmaz.** Satır fiyatı, ücretler,
 * KDV ve genel toplam `/api/menu/quote` yanıtından okunur; sipariş
 * `createOrderAction` ile gönderilir ve orası aynı `buildCheckoutQuote`
 * fonksiyonunu çağırır. Ekrandaki tutarla tahsil edilen tutar ayrışamaz.
 *
 * Onay adımı yoktur: ödeme Stripe'ın barındırdığı sayfada yapılır, müşteri
 * oradan doğrudan /bestellung/[token] takip sayfasına döner.
 */
export function CheckoutView() {
  const { t, lang } = useLanguage();
  const searchParams = useSearchParams();
  const { lines, count, loaded, fulfillment, zip, setFulfillment, setZip } = useCart();

  const [form, setForm] = useState<CheckoutFormValues>(EMPTY_CHECKOUT_FORM);
  const [city, setCity] = useState("");
  const [zones, setZones] = useState<DeliveryCity[] | null>(null);
  const [zonesFailed, setZonesFailed] = useState(false);
  const [status, setStatus] = useState<MenuStatus | null>(null);
  const [errors, setErrors] = useState<CheckoutFieldErrors>({});

  /*
   * Ödeme adımının kendi seçimleri.
   *
   * Hiçbiri sepet bağlamında tutulmuyor: üçü de yalnızca bu ekranda anlamlı ve
   * sepet çekmecesinde görünmüyor. Müşteri sekmeyi kapatıp geri dönerse
   * sıfırlanırlar — kupon ve bahşiş gibi kararların "hatırlanması", müşterinin
   * farkında olmadan bahşiş ödemesi demek olurdu.
   */
  const [options, setOptions] = useState<OrderOptions | null>(null);
  const [timing, setTiming] = useState<"asap" | "scheduled">("asap");
  const [slot, setSlot] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodChoice>("ONLINE");
  const [tipCents, setTipCents] = useState(0);
  /** Sunucuya gönderilen kod. Alana yazılan taslak `CouponField` içinde durur. */
  const [couponCode, setCouponCode] = useState("");
  /**
   * Teklifi girdiler değişmeden yeniden istemek için sayaç. Otomatik bir
   * kampanya sipariş anında bittiğinde (`campaign_gone`) ekrandaki tutar
   * eskidir; müşteri yeni tutarı görmeden yeniden onaylamamalı.
   */
  const [quoteRevision, setQuoteRevision] = useState(0);
  /**
   * Hesaba kayıtlı adresler.
   *
   * Misafir akışında boş kalır (uç 401 döner) ve seçici hiç görünmez; üyelik
   * ödeme sayfasının hiçbir yerinde zorunlu hâle gelmez.
   */
  const [savedAddresses, setSavedAddresses] = useState<AddressRecord[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  /** Oturum açık mı — yalnızca "bu adresi kaydet" kutusunu göstermek için. */
  const [loggedIn, setLoggedIn] = useState(false);
  const [saveAddress, setSaveAddress] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Ön doldurma yalnızca bir kez denenir; kullanıcının düzeltmesi ezilmesin. */
  const prefilled = useRef(false);
  /**
   * Sepetteki posta kodunun en güncel hâli.
   *
   * `setZip` sepet bağlamından geliyor ve güncelleyici fonksiyon kabul etmiyor;
   * efekt içinde `zip` değişkenini okumak ise efekt bir kez çalıştığı için
   * mount anındaki (çoğu zaman boş) değeri okurdu. Ref, "kullanıcının/sepetin
   * zaten bir posta kodu var mı" sorusunu doğru cevaplar.
   */
  const zipRef = useRef(zip);
  zipRef.current = zip;

  const isDelivery = fulfillment === "DELIVERY";

  /** "En kısa sürede"de boş; ileri saatte seçilen kutunun ISO değeri. */
  const requestedAt = timing === "scheduled" ? slot : "";

  /*
   * Tutarlar bu ekranın kendi teklifinden okunur (kupon, bahşiş ve ileri saat
   * de hesaba girsin diye). Sepet çekmecesinin kendi teklifi değişmeden
   * çalışmaya devam eder.
   */
  const { quote, pricing } = useCheckoutQuote(
    { lines, lang, fulfillment, zip, couponCode, tipCents, requestedAt, revision: quoteRevision },
    loaded
  );

  const totalsReady = quote !== null && pricing !== "error";
  const hasUnavailable = quote?.hasUnavailable ?? false;

  /*
   * Bahşiş yalnızca online ödemede sorulur: kapıda ödemede müşteri bahşişi
   * elden veriyor, ekranda ikinci kez sormak aynı parayı iki kez istemek gibi
   * görünürdü.
   */
  const tipVisible = paymentMethod === "ONLINE";

  /** Stripe'tan vazgeçip dönen müşteri: sepeti ve formu duruyor. */
  const cancelled = searchParams.get("abgebrochen") === "1";

  /* ------------------------------------------------------------- veri çekme */

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/menu/delivery", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("zones"))))
      .then((data: { cities: DeliveryCity[] }) => {
        setZones(data.cities);
        setZonesFailed(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Bölgeler gelmediyse adres seçtiremeyiz; sebebi ekranda söylenir.
        setZonesFailed(true);
      });

    fetch("/api/menu/status", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("status"))))
      .then((data: MenuStatus) => setStatus(data))
      .catch(() => {
        // Durum okunamadı: uyarı gösteremeyiz ama siparişi engellemeyiz;
        // kesin karar zaten sunucuda, sipariş oluşturulurken veriliyor.
      });

    /*
     * Zaman aralıkları ve açık ödeme yöntemleri.
     *
     * Okunamazsa akış **online ödeme + en kısa sürede** olarak devam eder:
     * ikisi de her zaman geçerli olan varsayılanlar. Ön sipariş ve kapıda
     * ödeme seçenekleri o durumda hiç görünmez — gösterilip sunucuda
     * reddedilmelerindense hiç görünmemeleri yeğdir.
     */
    fetch("/api/orders/options", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("options"))))
      .then((data: OrderOptions) => setOptions(data))
      .catch(() => undefined);

    return () => controller.abort();
  }, []);

  /*
   * Dükkân kapalıyken tek meşru sipariş biçimi ön sipariştir; seçim
   * kendiliğinden oraya kayar. Müşteriye "kapalıyız" deyip elinde çalışmayan
   * bir "en kısa sürede" düğmesi bırakmanın anlamı yok.
   */
  useEffect(() => {
    if (!options || options.openNow || options.slots.length === 0) return;
    setTiming((current) => (current === "asap" ? "scheduled" : current));
  }, [options]);

  /*
   * Kapıda ödeme panelden kapatılmışsa seçim online'a döner. Sunucu da aynı
   * kararı veriyor; buradaki düzeltme, müşterinin sipariş düğmesine basana
   * kadar bunu öğrenmemesini engelliyor.
   */
  useEffect(() => {
    if (options && !options.onSitePaymentEnabled) setPaymentMethod("ONLINE");
  }, [options]);

  /* Bahşiş yalnızca online ödemede sorulur; yöntem değişince tutar düşer. */
  useEffect(() => {
    if (!tipVisible) setTipCents(0);
  }, [tipVisible]);

  /*
   * Oturum açıksa formu kayıtlı bilgilerle doldur.
   *
   * Kullanıcının elle yazdığı bir şeyin üzerine ASLA yazılmaz: yalnızca boş
   * alanlar doldurulur. 401 (oturum yok) beklenen bir durumdur, hata değil —
   * misafir akışı aynen devam eder.
   */
  useEffect(() => {
    if (prefilled.current) return;

    const controller = new AbortController();

    /*
     * Bayrak isteğin **sonucu geldiğinde** kalkar, başlarken değil.
     *
     * React geliştirme kipinde (StrictMode) her efekti bir kurar, hemen bozar
     * ve yeniden kurar. Bayrak efektin başında kalkarsa: ilk kurulum isteği
     * başlatır, temizlik onu iptal eder, ikinci kurulum ise bayrağı kalkmış
     * bulup hiç istek atmaz. Sonuç, oturum açmış müşteriye bomboş bir ödeme
     * formu ve hiç görünmeyen bir "kayıtlı adresler" şeridiydi — hesabına
     * adres kaydetmenin anlamı kalmıyordu.
     *
     * İptal edilmiş istek "denendi" sayılmaz; bir sonraki kurulum yeniden
     * dener. Gerçekten tamamlanan (ya da ağ hatasıyla biten) istekten sonra
     * ise ikinci bir deneme yapılmaz.
     */
    const settled = () => {
      if (!controller.signal.aborted) prefilled.current = true;
    };

    fetch("/api/account/profile", { signal: controller.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { customer?: Record<string, string> } | null) => {
        const saved = data?.customer;
        if (!saved) return;
        setForm((current) => ({
          ...current,
          name: current.name || saved.name || "",
          phone: current.phone || saved.phone || "",
          email: current.email || saved.email || "",
          street: current.street || saved.street || "",
          houseNo: current.houseNo || saved.houseNo || "",
        }));
        if (saved.city) setCity((current) => current || saved.city);
      })
      .catch(() => {
        // Ağ hatası: form boş kalır, kullanıcı elle doldurur. Siparişi
        // engellemeye değecek bir arıza değil.
      });

    /*
     * Kayıtlı adresler.
     *
     * Varsayılan adres, kullanıcı henüz bir şey yazmadıysa forma uygulanır.
     * Yazdığının üzerine ASLA yazılmaz — sayfayı açtıktan sonra adres girmeye
     * başlayan biri, ağ yanıtı geldiğinde yazdığını kaybetmemeli.
     */
    fetch("/api/account/addresses", { signal: controller.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { addresses?: AddressRecord[] } | null) => {
        const list = data?.addresses ?? [];
        if (!data) return;
        setLoggedIn(true);
        setSavedAddresses(list);

        const preferred = list.find((address) => address.isDefault) ?? list[0];
        if (!preferred) return;

        setForm((current) =>
          current.street || current.houseNo
            ? current
            : {
                ...current,
                street: preferred.street,
                houseNo: preferred.houseNo,
                floor: current.floor || preferred.floor,
                bellName: current.bellName || preferred.bellName,
              }
        );
        setSelectedAddressId((current) => current ?? preferred.id);
        setCity((current) => current || preferred.city);
        if (!zipRef.current) setZip(preferred.zip);
      })
      .catch(() => {
        // Misafir ya da ağ hatası: form elle doldurulur, akış değişmez.
      })
      .finally(settled);

    return () => controller.abort();
  }, [setZip]);

  /** Seçili şehrin posta kodları; şehir seçilmediyse boş. */
  const zipsForCity = useMemo(
    () => zones?.find((c) => c.city === city)?.zips ?? [],
    [zones, city]
  );

  /** Teslimat yapılan tüm posta kodları; kayıtlı adresi işaretlemek için. */
  const deliverableZips = useMemo(
    () => new Set((zones ?? []).flatMap((entry) => entry.zips.map((z) => z.zip))),
    [zones]
  );

  /**
   * Kayıtlı adresi forma taşır.
   *
   * Alanlar kilitlenmez: seçilen adresin katı değişmiş olabilir, müşteri
   * üstünde düzeltme yapabilmeli. Düzeltme yapılması seçimi bozmaz; adres
   * yalnızca "yeni adres gir" ile bırakılır.
   */
  function applyAddress(address: AddressRecord) {
    setSelectedAddressId(address.id);
    setForm((current) => ({
      ...current,
      street: address.street,
      houseNo: address.houseNo,
      floor: address.floor,
      bellName: address.bellName,
    }));
    setCity(address.city);
    setZip(address.zip);
    setSaveAddress(false);
    setErrors({});
  }

  function clearSelectedAddress() {
    setSelectedAddressId(null);
    setForm((current) => ({ ...current, street: "", houseNo: "", floor: "", bellName: "" }));
    setCity("");
    setZip("");
  }

  /*
   * Kayıtlı posta kodundan şehri geri bul: "posta kodu seçili ama şehir boş"
   * gibi tutarsız bir form görünmesin.
   */
  useEffect(() => {
    if (!zones || city || !zip) return;
    const owner = zones.find((c) => c.zips.some((z) => z.zip === zip));
    if (owner) setCity(owner.city);
  }, [zones, city, zip]);

  /* Tek posta kodu olan şehirde seçim yaptırmanın anlamı yok. */
  useEffect(() => {
    if (!isDelivery || !city) return;
    if (zipsForCity.length === 1 && zip !== zipsForCity[0].zip) {
      setZip(zipsForCity[0].zip);
    }
  }, [isDelivery, city, zipsForCity, zip, setZip]);

  /* --------------------------------------------------------------- gönderim */

  const setField = (field: keyof CheckoutFormValues, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  /** Sunucudan dönen ret sebebini müşterinin dilinde bir cümleye çevirir. */
  const errorMessage = (error: OrderError): string => {
    switch (error.code) {
      case "ordering_paused":
        return t.cart.errPaused;
      case "closed":
        return t.cart.errClosed;
      case "fulfillment_disabled":
        return error.fulfillment === "DELIVERY" ? t.cart.errDeliveryOff : t.cart.errPickupOff;
      case "out_of_delivery_area":
        return t.cart.errOutOfArea.replace("{zip}", error.zip);
      case "below_minimum":
        return t.cart.errBelowMinimum.replace("{amount}", formatCents(error.minOrderCents));
      case "unavailable_items":
        return t.cart.errUnavailableItems.replace("{items}", error.items.join(", "));
      case "payment_unavailable":
        return t.cart.errPaymentUnavailable;
      case "too_many_requests":
        return t.cart.errTooManyRequests;
      case "empty_cart":
        return t.cart.empty;
      case "invalid_input":
        return error.message;
      case "slot_unavailable":
        return t.orderFlow.errSlotUnavailable;
      case "payment_method_unavailable":
        return t.orderFlow.errPaymentMethod;
      case "coupon_gone":
        return t.orderFlow.couponGone;
      case "campaign_gone":
        return t.orderFlow.campaignGone;
      /*
       * Kupon ret sebepleri sipariş düğmesine basıldığında da dönebilir:
       * müşteri kodu girdikten sonra sepetten ürün çıkarıp asgari tutarın
       * altına düşmüş olabilir. Cümleyi üreten `describeRejection`, kod
       * alanının altındakiyle aynı — iki yerde iki farklı açıklama,
       * müşterinin hangisine inanacağını bilememesi demek.
       */
      case "coupon_unknown":
      case "coupon_inactive":
      case "coupon_not_started":
      case "coupon_expired":
      case "coupon_exhausted":
      case "coupon_wrong_fulfillment":
      case "coupon_below_minimum":
      case "coupon_no_items":
      case "coupon_too_many_attempts":
        return describeRejection(error, t);
    }
  };

  const submit = async () => {
    if (submitting) return;

    const found = validateCheckoutForm({
      values: form,
      fulfillment,
      zip,
      city,
      messages: {
        name: t.cart.errName,
        phone: t.cart.errPhone,
        email: t.cart.errEmail,
        street: t.cart.errStreet,
        houseNo: t.cart.errHouseNo,
        zip: t.cart.errZip,
        city: t.cart.errCity,
      },
    });
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // Hatalı ilk alana götür: uzun bir formda ekranın dışında kalan bir
      // hata mesajı, hiç gösterilmemiş sayılır.
      document.getElementById(Object.keys(found)[0])?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    /*
     * "Bu adresi kaydet" işaretliyse önce adres defterine yazılır.
     *
     * Siparişten ÖNCE: sipariş sonrası Stripe'a yönlendirme yapılıyor ve o
     * noktadan sonra bu sekmede çalışacak kod kalmıyor. Kayıt başarısız
     * olursa sipariş yine de devam eder — adres defteri, siparişin önünde
     * duracak kadar önemli değil.
     */
    if (loggedIn && saveAddress && isDelivery) {
      await fetch("/api/account/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: "",
          street: form.street.trim(),
          houseNo: form.houseNo.trim(),
          floor: form.floor.trim(),
          bellName: form.bellName.trim(),
          zip,
          city: city.trim(),
          isDefault: savedAddresses.length === 0,
        }),
      }).catch(() => undefined);
    }

    try {
      const result = await createOrderAction(
        toCreateOrderInput({
          lines,
          lang,
          fulfillment,
          values: form,
          zip,
          city,
          paymentMethod,
          /*
           * Kupon ve bahşiş, **sunucunun onayladığı** hâlleriyle gönderilir
           * (`quote.couponCode`, `quote.tipCents`) — ekranda yazan ne ise o.
           * Yerel taslakları göndermek, reddedilmiş bir kodu ya da
           * kelepçelenmemiş bir bahşişi siparişe taşımak olurdu.
           */
          couponCode: quote?.couponCode ?? "",
          tipCents: quote?.tipCents ?? 0,
          requestedAt,
        })
      );

      if (!result.ok) {
        setSubmitError(errorMessage(result.error));
        setSubmitting(false);
        if (result.error.code === "campaign_gone") setQuoteRevision((revision) => revision + 1);
        return;
      }

      // Ödeme sayfasına geç. Sepet burada TEMİZLENMEZ: müşteri ödemeden
      // vazgeçip geri dönerse sepetini bulmalı. Temizlik, ödeme tamamlandıktan
      // sonra takip sayfasında yapılır.
      window.location.href = result.checkoutUrl;
    } catch {
      setSubmitError(t.cart.errSubmit);
      setSubmitting(false);
    }
  };

  /* ------------------------------------------------------------ görünürlük */

  /** Sipariş alınamıyorsa sebebini söyleyen üst bant; alınabiliyorsa null. */
  const blockingNotice = (() => {
    if (status && !status.orderingEnabled) return t.cart.statusPaused;
    if (status && !status.open) return t.cart.statusClosed;
    if (isDelivery && status && !status.deliveryEnabled) return t.cart.fulfillmentDeliveryOff;
    if (!isDelivery && status && !status.pickupEnabled) return t.cart.fulfillmentPickupOff;
    return null;
  })();

  /** Sipariş düğmesi basılabilir mi. Karar yine sunucuda, bu yalnızca önden uyarı. */
  const canSubmit =
    totalsReady &&
    !hasUnavailable &&
    quote.rejection === null &&
    // Geçersiz bir kuponla sipariş verilemez: sunucu da reddediyor, ama
    // müşteri bunu düğmeye basmadan önce görmeli.
    quote.couponRejection === null &&
    !submitting &&
    (!isDelivery || /^\d{5}$/.test(zip)) &&
    // İleri saat seçildiyse saat de seçilmiş olmalı; yoksa sipariş sessizce
    // "en kısa sürede"ye düşerdi.
    (timing === "asap" || slot !== "");

  /**
   * Yasal uyarı metnindeki {agb} / {privacy} yer tutucularını bağlantıya
   * çevirmek için metni üç parçaya böler. Yer tutucu bulunamazsa cümle
   * bölünmeden gösterilir: yasal metnin hiç görünmemesi, biçiminin bozulmasından
   * çok daha kötüdür.
   */
  const legalHintParts = useMemo(() => {
    const [before = "", rest = ""] = t.cart.legalHint.split("{agb}");
    const [middle = "", after = ""] = rest.split("{privacy}");
    return { before, middle, after };
  }, [t.cart.legalHint]);

  /* Sepet localStorage'dan okunmadan "boş" demeyiz. */
  if (loaded && lines.length === 0) {
    return (
      <div className="mx-auto w-full max-w-md px-5 py-24 text-center">
        <h1 className="font-display text-2xl font-extrabold text-bone">
          {t.checkout.emptyTitle}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-smoke">{t.checkout.emptyText}</p>
        <Link
          href="/speisekarte"
          className="focus-ring tag mt-6 inline-flex min-h-[44px] items-center border border-amber bg-amber/10 px-5 text-amber transition-colors hover:bg-amber hover:text-void"
        >
          {t.checkout.emptyBtn} →
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-5 pb-40 pt-8 lg:pb-16">
      <header className="mb-8">
        <Link
          href="/speisekarte"
          className="focus-ring tag inline-block text-smoke transition-colors hover:text-amber"
        >
          {t.checkout.backToCart}
        </Link>
        <h1 className="mt-3 font-display text-3xl font-extrabold text-bone sm:text-4xl">
          {t.checkout.heading}
        </h1>
        <p className="tag mt-2 text-smoke">
          {count === 1 ? t.cart.itemsOne : t.cart.itemsOther.replace("{count}", String(count))}
        </p>
      </header>

      <div className="mb-6 space-y-3">
        {cancelled && (
          <Notice tone="warn" title={t.checkout.cancelledTitle}>
            {t.checkout.cancelledText}
          </Notice>
        )}
        {blockingNotice && <Notice tone="bad">{blockingNotice}</Notice>}
        {pricing === "error" && <Notice tone="bad">{t.cart.priceError}</Notice>}
        {hasUnavailable && <Notice tone="bad">{t.cart.unavailableHint}</Notice>}
        {zonesFailed && isDelivery && <Notice tone="bad">{t.cart.zonesError}</Notice>}
      </div>

      <div className="grid gap-10 lg:grid-cols-[1fr_380px] lg:items-start lg:gap-8">
        {/* --------------------------------------------------------- form */}
        <div className="space-y-8">
          <FulfillmentSwitch
            value={fulfillment}
            onChange={setFulfillment}
            status={status}
            labels={{
              title: t.cart.fulfillmentTitle,
              delivery: t.cart.fulfillmentDelivery,
              pickup: t.cart.fulfillmentPickup,
            }}
          />

          <section aria-labelledby="contact-title" className="space-y-4">
            <h2 id="contact-title" className="section-heading">
              <span className="font-mono text-amber">1</span> {t.checkout.contactTitle}
            </h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.cart.nameLabel} htmlFor="name" error={errors.name}>
                <TextInput
                  id="name"
                  type="text"
                  autoComplete="name"
                  value={form.name}
                  invalid={Boolean(errors.name)}
                  placeholder={t.cart.namePh}
                  onChange={(e) => setField("name", e.target.value)}
                />
              </Field>
              <Field label={t.cart.phoneLabel} htmlFor="phone" error={errors.phone}>
                <TextInput
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={form.phone}
                  invalid={Boolean(errors.phone)}
                  placeholder={t.cart.phonePh}
                  onChange={(e) => setField("phone", e.target.value)}
                />
              </Field>
            </div>

            <Field label={t.cart.emailLabel} htmlFor="email" error={errors.email}>
              <TextInput
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={form.email}
                invalid={Boolean(errors.email)}
                placeholder={t.cart.emailPh}
                onChange={(e) => setField("email", e.target.value)}
              />
            </Field>
          </section>

          <section aria-labelledby="delivery-title" className="space-y-4">
            <h2 id="delivery-title" className="section-heading">
              <span className="font-mono text-amber">2</span>{" "}
              {isDelivery ? t.checkout.addressTitle : t.checkout.pickupTitle}
            </h2>

            {isDelivery ? (
              <>
              <SavedAddresses
                addresses={savedAddresses}
                deliverableZips={deliverableZips}
                selectedId={selectedAddressId}
                onSelect={applyAddress}
                onClear={clearSelectedAddress}
                t={t}
              />
              <AddressFields
                zones={zones}
                zonesFailed={zonesFailed}
                city={city}
                onCityChange={(next) => {
                  setCity(next);
                  // Şehir değişince eski posta kodu artık o şehre ait
                  // olmayabilir; bırakılırsa yanlış bölgenin ücreti kalırdı.
                  setZip("");
                }}
                zip={zip}
                onZipChange={setZip}
                zipsForCity={zipsForCity}
                street={form.street}
                houseNo={form.houseNo}
                floor={form.floor}
                bellName={form.bellName}
                onFieldChange={setField}
                errors={errors}
                etaMinutes={quote?.etaMinutes ?? null}
                t={t}
              />

              {/* Kutu yalnızca oturum açıkken ve kayıtlı bir adres SEÇİLİ
                  değilken görünür: seçilmiş bir adresi ikinci kez kaydetmek
                  defteri kopyalarla doldururdu. */}
              {loggedIn && !selectedAddressId && (
                <label className="flex items-center gap-3 text-sm text-smoke">
                  <input
                    type="checkbox"
                    checked={saveAddress}
                    onChange={(e) => setSaveAddress(e.target.checked)}
                    className="h-4 w-4 accent-amber"
                  />
                  {t.checkout.saveAddress}
                </label>
              )}
              </>
            ) : (
              <div className="border border-line bg-void/40 px-4 py-4">
                <p className="tag mb-2 text-smoke">{t.cart.pickupNote}</p>
                <p className="text-sm leading-relaxed text-bone">
                  {BUSINESS_INFO.address.street}
                  <br />
                  {BUSINESS_INFO.address.postalCode} {BUSINESS_INFO.address.city}
                </p>
                {quote?.etaMinutes != null && (
                  <p className="mt-2 font-mono text-[11px] text-amber">
                    {t.cart.etaPickup.replace("{minutes}", String(quote.etaMinutes))}
                  </p>
                )}
              </div>
            )}

            {/*
              Teslim zamanı adresin hemen altında: Lieferando'da da seçici
              adres ve kişisel bilgilerin altında duruyor. Sıra mantıklı —
              "nereye" sorusunun cevabı verilmeden "ne zaman" sorusunun cevabı
              anlam taşımıyor (bölgeye göre süre değişiyor).
            */}
            <TimingPicker
              options={options}
              mode={timing}
              slot={slot}
              onModeChange={(next) => {
                setTiming(next);
                // "En kısa sürede"ye dönüldüğünde seçili saat bırakılmaz:
                // ekranda görünmeyen bir saatin siparişe gitmesi, müşterinin
                // beklemediği bir teslim saati demek.
                if (next === "asap") setSlot("");
              }}
              onSlotChange={setSlot}
              t={t}
            />

            <Field label={t.cart.noteLabel} htmlFor="note">
              <TextInput
                id="note"
                value={form.note}
                maxLength={200}
                placeholder={t.cart.notePh}
                onChange={(e) => setField("note", e.target.value)}
              />
            </Field>
          </section>

          {/*
            Ödeme yöntemi, kupon ve bahşiş.

            Üçü de sol sütunda, özetin dışında: § 312j Abs. 2 BGB özet bloğu
            ile sipariş düğmesinin arasına yasal metin dışında hiçbir şeyin
            girmesine izin vermiyor. Bu alanlar tutarları değiştiriyor,
            dolayısıyla özetin ÜSTÜNDE değil, ayrı bir sütunda durmaları
            gerekiyor — değişiklikleri özete anında yansıyor.
          */}
          <section aria-labelledby="pay-how-title" className="space-y-6">
            <h2 id="pay-how-title" className="section-heading">
              <span className="font-mono text-amber">3</span> {t.orderFlow.paymentTitle}
            </h2>

            <PaymentMethodPicker
              value={paymentMethod}
              onChange={setPaymentMethod}
              onSiteEnabled={options?.onSitePaymentEnabled ?? false}
              isDelivery={isDelivery}
              t={t}
            />

            <CouponField
              appliedCode={quote?.couponCode ?? ""}
              // Yalnızca kodun kendi indirimi: otomatik kampanyalar kod
              // alanında "uygulandı" gibi görünmesin.
              discountCents={
                quote?.campaigns.find((campaign) => campaign.code !== "" && campaign.code === quote.couponCode)
                  ?.amountCents ?? 0
              }
              rejection={quote?.couponRejection ?? null}
              checking={pricing === "loading"}
              onApply={setCouponCode}
              onRemove={() => setCouponCode("")}
              t={t}
            />

            {tipVisible && (
              <TipSelector
                subtotalCents={quote?.subtotalCents ?? 0}
                tipCents={quote?.tipCents ?? 0}
                onChange={setTipCents}
                t={t}
              />
            )}
          </section>
        </div>

        {/* ------------------------------------------------------- özet */}
        <aside
          aria-labelledby="payment-title"
          className="space-y-4 lg:sticky lg:top-[calc(var(--nav-h)+1.5rem)]"
        >
          <h2 id="payment-title" className="section-heading">
            <span className="font-mono text-amber">4</span> {t.checkout.summaryTitle}
          </h2>

          {totalsReady && quote.remainingForMinimumCents > 0 && (
            <MinimumProgress
              subtotalCents={quote.subtotalCents}
              minOrderCents={quote.zone?.minOrderCents ?? 0}
              label={t.cart.minOrderRemaining.replace(
                "{amount}",
                formatCents(quote.remainingForMinimumCents)
              )}
            />
          )}

          {totalsReady && quote.remainingForFreeServiceCents > 0 && (
            <p className="text-xs text-smoke/70">
              {t.cart.freeDeliveryThreshold.replace(
                "{amount}",
                formatCents(quote.remainingForFreeServiceCents)
              )}
            </p>
          )}

          {/*
            § 312j Abs. 2 BGB: özet bloğu ile sipariş düğmesinin arasına yasal
            metin dışında HİÇBİR ŞEY girmemeli. Aşağıdaki sıra korunmalı:
            özet → ret sebebi → yasal uyarı → düğme.
          */}
          {totalsReady ? (
            <SummaryPanel quote={quote} t={t} />
          ) : (
            <p className="border border-line bg-void/40 px-4 py-6 text-center text-sm text-smoke">
              {t.cart.loading}
            </p>
          )}

          {totalsReady && quote.rejection && (
            <p role="alert" className="text-sm text-flame">
              {errorMessage(quote.rejection)}
            </p>
          )}

          {submitError && (
            <p role="alert" className="text-sm text-flame">
              {submitError}
            </p>
          )}

          {/* Sözleşmeye giriliyor: hangi koşulların geçerli olduğu ve cayma
              hakkının bulunmadığı, butona basılmadan ÖNCE söylenmek
              zorunda (Art. 246a EGBGB). */}
          <p className="text-[11px] leading-relaxed text-smoke/70">
            {legalHintParts.before}
            <a href="/agb" target="_blank" rel="noopener" className="text-amber underline">
              {t.cart.legalAgb}
            </a>
            {legalHintParts.middle}
            <a href="/datenschutz" target="_blank" rel="noopener" className="text-amber underline">
              {t.cart.legalPrivacy}
            </a>
            {legalHintParts.after}
            <br />
            {t.cart.legalNoWithdrawal}
          </p>

          {/*
            Masaüstünde düğme burada, özetin hemen altında. Mobilde bu kopya
            gizlenir ve ekranın altına yapışan çubuktaki eşi kullanılır —
            uzun formda düğmenin sayfa sonunda kalması, müşteriyi aramaya
            zorlar. İki kopya da aynı `submit`i çağırır.
          */}
          <div className="hidden lg:block">
            <PayButton
              onClick={submit}
              disabled={!canSubmit}
              label={submitting ? t.cart.redirecting : t.cart.checkoutBtn}
            />
            {/* Yöntem değiştiğinde açıklama da değişmeli: kapıda ödeyen
                müşteriye "Stripe'a yönlendirileceksiniz" demek yanlış. */}
            <p className="mt-3 text-xs leading-relaxed text-smoke/60">
              {paymentMethod === "ONLINE"
                ? t.cart.payOnlineNote
                : paymentMethod === "CASH"
                  ? isDelivery
                    ? t.orderFlow.paymentCashHint
                    : t.orderFlow.paymentCashPickupHint
                  : isDelivery
                    ? t.orderFlow.paymentCardHint
                    : t.orderFlow.paymentCardPickupHint}
            </p>
          </div>
        </aside>
      </div>

      {/*
        Alerjen uyarısı.

        Sayfanın en altında, özetten ve ödeme düğmesinden SONRA duruyor:
        § 312j Abs. 2 BGB özet bloğu ile düğmenin arasına yasal metin dışında
        hiçbir şeyin girmesine izin vermiyor, dolayısıyla uyarının yeri o
        aralığın dışıdır. Menünün altındaki uyarının aynı bileşenidir — iki
        yüzeyde tek metin, tek yerden düzeltilir.
      */}
      <AllergenWarning tone="strong" className="mt-12" />

      {/*
        Mobil ödeme çubuğu.
        `env(safe-area-inset-bottom)`: iPhone'un ana ekran göstergesi düğmenin
        üstüne binmesin. `max()` ile normal dolgu da korunur.
      */}
      <div className="fixed inset-x-0 bottom-0 z-[60] border-t border-line bg-char/95 px-5 pt-3 backdrop-blur-md pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <div className="mx-auto flex max-w-5xl items-center gap-4">
          <div className="min-w-0 shrink-0">
            <p className="tag text-smoke">{t.cart.total}</p>
            <p className="font-display text-xl font-extrabold text-amber tabular-nums">
              {totalsReady ? formatCents(quote.totalCents) : "—"}
            </p>
          </div>
          <PayButton
            onClick={submit}
            disabled={!canSubmit}
            label={submitting ? t.cart.redirecting : t.cart.checkoutBtn}
            className="flex-1"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Ödeme düğmesi.
 *
 * § 312j Abs. 3 BGB: düğmenin yazısı ödeme yükümlülüğünü açıkça belirtmek
 * zorunda ("zahlungspflichtig bestellen"). Metin çeviri dosyasından gelir ve
 * orada da serbest çeviri değildir.
 */
function PayButton({
  onClick,
  disabled,
  label,
  className = "",
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="primary"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-xs tracking-wider ${className}`}
    >
      {label}
    </Button>
  );
}
