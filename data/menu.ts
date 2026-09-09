import type { BuilderGroup } from "@/lib/admin/types";

/**
 * "Kendin Seç" yapılandırıcısının **ilk kurulum** verisi.
 *
 * Buradaki değerler yalnızca depo (`data/store/catalog.json`) ilk kez
 * oluşturulurken kullanılır. Sonrasında geçerli olan tek kaynak katalogtur:
 * ek ücretler admin panelinden (/admin/pricing) değiştirilir ve yapılandırıcı,
 * sepet ve sipariş toplamı o değerleri kullanır.
 */
export const BUILDER_GROUPS_SEED: BuilderGroup[] = [
  {
    id: "bread",
    mode: "single",
    options: [
      { id: "kalin", label: "Kalın Pide", labelDe: "Dickes Fladenbrot", desc: "Dolgun, yoğun iç", descDe: "Artisan Pita, saftig", price: 0, kcal: 320, image: "/assets/ing-bun-thick.webp" },
      { id: "ince", label: "İnce Pide", labelDe: "Dünnes Fladenbrot", desc: "Hafif, gevrek kabuk", descDe: "Leicht und knusprig", price: 0, kcal: 240, image: "/assets/ing-bun-bottom.webp" },
    ],
  },
  {
    id: "protein",
    mode: "single",
    options: [
      { id: "et-tek", label: "Tek Porsiyon Et", labelDe: "Einzelne Portion Fleisch", desc: "180g, şişten taze kesim", descDe: "180g, frisch vom Spieß", price: 0, kcal: 340, image: "/assets/ing-meat.webp" },
      { id: "et-cift", label: "Çift Porsiyon Et", labelDe: "Doppelte Portion Fleisch", desc: "320g, doyurucu seçim", descDe: "320g, extra Fleisch", price: 4, kcal: 610, image: "/assets/ing-meat.webp" },
    ],
  },
  {
    id: "veggies",
    mode: "multi",
    options: [
      { id: "domates", label: "Domates", labelDe: "Tomaten", desc: "Dilim dilim taze", descDe: "Sonnengereift & frisch", price: 0, kcal: 18, image: "/assets/ing-tomato.webp" },
      { id: "sogan", label: "Kırmızı Soğan", labelDe: "Rote Zwiebeln", desc: "İnce halka kesim", descDe: "Feine Zwiebelringe", price: 0, kcal: 12, image: "/assets/ing-onion.webp" },
      { id: "marul", label: "Marul", labelDe: "Kopfsalat", desc: "Buz gibi taze", descDe: "Knackig & frisch", price: 0, kcal: 8, image: "/assets/ing-lettuce.webp" },
    ],
  },
  {
    id: "sauce",
    mode: "single",
    options: [
      { id: "sarimsak", label: "Sarımsak Sos", labelDe: "Knoblauchsoße", desc: "Yoğurt bazlı, otlu", descDe: "Mit Kräutern & Joghurt", price: 0, kcal: 90, image: "/assets/ing-sauce.webp" },
      { id: "acili", label: "Acı Sos", labelDe: "Scharfe Soße", desc: "Köz biber, ateşli", descDe: "Chili & Paprika", price: 0, kcal: 45, image: "/assets/ing-ketchup.webp" },
      { id: "ikisi", label: "İkisi Birden", labelDe: "Beides zusammen", desc: "Kararsız kalanlar için", descDe: "Für Unentschlossene", price: 0.7, kcal: 120, image: "/assets/ing-sauce-mix.webp" },
    ],
  },
];

/** Taban fiyatın okunacağı varsayılan ürün (katalogdaki gerçek döner). */
export const BUILDER_BASE_PRODUCT_ID = "drehspiess--drehspiess-xl-03";
