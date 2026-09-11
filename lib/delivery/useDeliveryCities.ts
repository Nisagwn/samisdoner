"use client";

import { useEffect, useState } from "react";
import type { DeliveryCity } from "@/app/api/menu/delivery/route";

export type DeliveryCitiesState = {
  /** `null` = henüz yüklenmedi. */
  cities: DeliveryCity[] | null;
  /** Uç okunamadı — çağıran taraf serbest metne düşmeli. */
  failed: boolean;
};

/**
 * Teslimat yapılan belediye listesi.
 *
 * Adres soran her ekran aynı listeyi kullanır: ödeme formu da, hesap
 * ekranındaki adres defteri de. Liste iki yerde ayrı ayrı çekilse ikisi
 * ayrışırdı — kayıtlı adres defterine ödeme formunun kabul etmediği bir yer
 * yazılabilir, müşteri onu seçtiğinde sipariş sunucuda reddedilirdi.
 *
 * Hata sessizce yutulmaz ama ekranı da kilitlemez: `failed` dönince çağıran
 * taraf serbest metin alanına düşer. Kayıtlı adresini düzeltmek isteyen bir
 * müşteriyi, teslimat ucunun o anki durumu yüzünden formdan çıkarmak
 * ölçüsüzdür — adresin geçerliliği zaten sipariş anında yeniden denetleniyor
 * (`findDeliveryZone`).
 */
export function useDeliveryCities(): DeliveryCitiesState {
  const [cities, setCities] = useState<DeliveryCity[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/menu/delivery", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("zones"))))
      .then((data: { cities: DeliveryCity[] }) => setCities(data.cities))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });

    return () => controller.abort();
  }, []);

  return { cities, failed };
}

/** Seçili belediyenin posta kodları; belediye listede yoksa boş. */
export function zipsForCity(cities: DeliveryCity[] | null, city: string) {
  return cities?.find((entry) => entry.city === city)?.zips ?? [];
}
