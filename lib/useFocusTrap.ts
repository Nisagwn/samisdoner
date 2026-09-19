"use client";

import { useEffect, type RefObject } from "react";

/** Odak tuzağının hedef alabileceği elemanlar. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

/**
 * Açık katmanlar, kayıt sırasına göre. Yalnızca **en son kayıt olan** tuşları
 * işler.
 *
 * Buna gerek var çünkü katmanlar iç içe açılıyor: sepet çekmecesi açıkken bir
 * satırın "düzenle" düğmesi `ProductDialog`'u çekmecenin üstüne (z-80 / z-71)
 * getiriyor. İkisi de aynı olayı dinlediği için bir hakem gerekiyor — yoksa
 * Escape ikisini birden kapatır, Tab ise odağı üstteki pencereden alıp
 * altındaki çekmeceye geri çekerdi.
 *
 * Hakem olarak kayıt sırası kullanılıyor: üstteki katman her zaman sonra açılır
 * (çekmece zaten açıkken pencere açılıyor), dolayısıyla listenin sonundadır.
 * DOM'daki iç içelik ölçüt olarak kullanılamazdı: `ProductDialog` çekmecenin
 * **kardeşi** olarak çiziliyor, çocuğu değil.
 */
const layers: object[] = [];

/**
 * Bir katmanı klavyeyle "modal" yapar: Escape kapatır, Tab dışına çıkmaz.
 *
 * `aria-modal="true"` yazmak tek başına bir söz veriyor ama onu tutmuyor:
 * tarayıcı odağı DOM sırasına göre ilerletmeye devam eder ve katman
 * `position: fixed` olduğu için sıradaki durak arkadaki sayfada olur. Klavye
 * kullanan müşteri pencereden sessizce "düşer" — ekran okuyucu hâlâ pencerenin
 * içinde olduğunu söylerken odak arkadaki menüdedir. Döngü bu yüzden elle
 * kapatılıyor.
 *
 * Kapsam bilinçli olarak dar: odağı içeri **almak** çağıranın işi (hangi
 * elemanın ilk seçileceğini katman bilir), bu kanca yalnızca içeride tutar.
 *
 * @param active  Katman açık mı. Kapalıyken hiçbir dinleyici kurulmaz.
 * @param root    Odağın içinde kalacağı eleman.
 * @param onEscape Escape'e verilecek tepki (genelde kapatma).
 */
export function useFocusTrap(
  active: boolean,
  root: RefObject<HTMLElement | null>,
  onEscape: () => void
): void {
  useEffect(() => {
    if (!active) return;

    const layer = {};
    layers.push(layer);

    const onKey = (event: KeyboardEvent) => {
      // Üstümüzde bir katman varsa tuş bizim değil.
      if (layers[layers.length - 1] !== layer) return;

      if (event.key === "Escape") {
        // Altımızdaki katman da Escape dinliyor; ikisi birden kapanmasın.
        event.stopPropagation();
        onEscape();
        return;
      }

      if (event.key !== "Tab") return;

      const el = root.current;
      if (!el) return;

      // `offsetParent === null` → çizilmeyen eleman (kapalı bir kademe içinde
      // olabilir); odak verilemeyeceği için sıradan düşer.
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null
      );
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const focused = document.activeElement;
      const inside = el.contains(focused);

      // Dışarı taşan her iki yön de içeri geri sarılır. Odağın katmanın
      // dışında olması (`!inside`) da buraya girer: bir şekilde dışarı
      // çıkmışsa sıradaki Tab onu geri alır, bırakıp gitmez.
      if (event.shiftKey && (focused === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (focused === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };

    // Yakalama evresi: alttaki katmanların dinleyicilerinden önce çalışır.
    window.addEventListener("keydown", onKey, true);

    return () => {
      window.removeEventListener("keydown", onKey, true);
      const index = layers.lastIndexOf(layer);
      if (index !== -1) layers.splice(index, 1);
    };
  }, [active, root, onEscape]);
}
