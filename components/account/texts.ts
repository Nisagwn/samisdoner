/**
 * Hesap alanının metinleri.
 *
 * Site iki dilli ve dil seçimi istemcide (`useLanguage`) yaşıyor; hesap
 * ekranları da aynı sözlüğü kullanır. Metinler tek bir dosyada toplandı çünkü
 * artık tek bir sayfa değil beş ekran var: aynı cümlenin iki ekranda ayrı
 * çevrilmesi, "Adreslerim" ile "Adres defterim" gibi ufak ama rahatsız edici
 * ayrışmalar üretiyordu.
 */

export type AccountTexts = ReturnType<typeof accountTexts>;

export function accountTexts(de: boolean) {
  return de ? DE : TR;
}

const DE = {
  /* --- kabuk --- */
  account: "Ihr Konto",
  navOverview: "Übersicht",
  navOrders: "Bestellungen",
  navAddresses: "Adressen",
  navFavorites: "Favoriten",
  navSettings: "Einstellungen",
  logout: "Abmelden",
  backToMenu: "Zur Speisekarte",

  /* --- genel bakış --- */
  greeting: "Hallo",
  overviewLead: "Hier sehen Sie alles, was zu Ihrem Konto gehört.",
  statOrders: "Bestellungen",
  statActive: "laufend",
  statAddresses: "Adressen",
  statFavorites: "Favoriten",
  lastOrder: "Letzte Bestellung",
  noOrdersYet: "Noch keine Bestellungen — schauen Sie sich die Speisekarte an.",
  runningOrder: "Laufende Bestellung",
  defaultAddress: "Standardadresse",
  noDefaultAddress: "Noch keine Adresse gespeichert.",
  addAddress: "Adresse hinzufügen",
  showAll: "Alle anzeigen",

  /* --- siparişler --- */
  ordersTitle: "Ihre Bestellungen",
  ordersLead:
    "Laufende Bestellungen stehen oben. Jede Bestellung lässt sich mit einem Klick erneut in den Warenkorb legen.",
  noOrders: "Noch keine Bestellungen.",
  activeTitle: "Laufende Bestellungen",
  noActive: "Zurzeit keine laufende Bestellung.",
  pastTitle: "Frühere Bestellungen",
  track: "Verfolgen",
  again: "Erneut bestellen",
  cancelledReason: "Grund der Stornierung",

  /* --- adresler --- */
  addressesTitle: "Ihre Adressen",
  addressesLead:
    "Gespeicherte Adressen können Sie beim Bestellen mit einem Klick übernehmen. Die Standardadresse füllt das Formular automatisch vor.",
  addressesEmpty:
    "Noch keine Adresse gespeichert. Die erste Adresse wird automatisch Ihre Standardadresse.",
  newAddress: "Neue Adresse",
  editAddress: "Adresse bearbeiten",
  labelLabel: "Bezeichnung",
  labelHint: "z. B. Zuhause, Arbeit",
  street: "Straße",
  houseNo: "Nr.",
  zip: "PLZ",
  city: "Ort",
  selectCity: "Ort wählen",
  selectZip: "PLZ wählen",
  loading: "Wird geladen…",
  floor: "Etage / Wohnung",
  floorHint: "optional — hilft dem Fahrer",
  bellName: "Name am Klingelschild",
  bellHint: "optional — falls abweichend",
  makeDefault: "Als Standardadresse verwenden",
  isDefault: "Standardadresse",
  setDefault: "Als Standard",
  edit: "Bearbeiten",
  remove: "Löschen",
  save: "SPEICHERN",
  saving: "SPEICHERT…",
  cancel: "Abbrechen",
  saved: "Gespeichert.",
  deleteAddressTitle: "Adresse löschen",
  deleteAddressText:
    "Diese Adresse wird aus Ihrem Adressbuch entfernt. Bereits aufgegebene Bestellungen bleiben davon unberührt.",
  addressLimit: "Sie haben die maximale Anzahl gespeicherter Adressen erreicht.",

  /* --- favoriler --- */
  favoritesTitle: "Ihre Favoriten",
  favoritesLead:
    "Mit dem Herz in der Speisekarte markieren Sie Artikel, die Sie oft bestellen. Hier liegen sie griffbereit.",
  favoritesEmpty:
    "Noch keine Favoriten. Tippen Sie in der Speisekarte auf das Herz neben einem Artikel.",
  favoriteUnavailable: "Zurzeit nicht verfügbar",
  removeFavorite: "Aus Favoriten entfernen",
  addToCart: "In den Warenkorb",
  addedToCart: "Im Warenkorb",
  toMenu: "Zur Speisekarte",

  /* --- ayarlar --- */
  settingsTitle: "Einstellungen",
  profileTitle: "Kontakt",
  profileLead:
    "Name und Telefonnummer werden beim Bestellen vorausgefüllt. Ihre Adressen verwalten Sie unter „Adressen“.",
  name: "Name",
  phone: "Telefon",
  legalTitle: "Ihre Daten",
  exportBtn: "Daten herunterladen (JSON)",
  exportHint: "Ihr Recht auf Datenübertragbarkeit nach Art. 20 DSGVO.",
  deleteTitle: "Konto löschen",
  serverError: "Server nicht erreichbar.",
  saveFailed: "Speichern fehlgeschlagen.",
};

/**
 * Türkçe sözlük.
 *
 * Anahtar kümesi Almancayla birebir aynı olmak zorunda: `AccountTexts` tipi
 * Almanca sözlükten türüyor, eksik bir anahtar derleme hatası verir.
 */
const TR: typeof DE = {
  account: "Hesabınız",
  navOverview: "Genel bakış",
  navOrders: "Siparişler",
  navAddresses: "Adresler",
  navFavorites: "Favoriler",
  navSettings: "Ayarlar",
  logout: "Çıkış yap",
  backToMenu: "Menüye git",

  greeting: "Merhaba",
  overviewLead: "Hesabınıza ait her şey burada.",
  statOrders: "Sipariş",
  statActive: "devam eden",
  statAddresses: "Adres",
  statFavorites: "Favori",
  lastOrder: "Son sipariş",
  noOrdersYet: "Henüz siparişiniz yok — menüye bir göz atın.",
  runningOrder: "Devam eden sipariş",
  defaultAddress: "Varsayılan adres",
  noDefaultAddress: "Henüz kayıtlı adres yok.",
  addAddress: "Adres ekle",
  showAll: "Tümünü gör",

  ordersTitle: "Siparişleriniz",
  ordersLead:
    "Devam eden siparişler üstte. Her siparişi tek tıkla yeniden sepete koyabilirsiniz.",
  noOrders: "Henüz siparişiniz yok.",
  activeTitle: "Aktif siparişler",
  noActive: "Şu anda devam eden siparişiniz yok.",
  pastTitle: "Geçmiş siparişler",
  track: "Takip et",
  again: "Tekrar sipariş ver",
  cancelledReason: "İptal sebebi",

  addressesTitle: "Adresleriniz",
  addressesLead:
    "Kayıtlı adresleri sipariş sırasında tek tıkla kullanabilirsiniz. Varsayılan adres formu kendiliğinden doldurur.",
  addressesEmpty:
    "Henüz kayıtlı adres yok. Eklediğiniz ilk adres kendiliğinden varsayılan olur.",
  newAddress: "Yeni adres",
  editAddress: "Adresi düzenle",
  labelLabel: "Ad",
  labelHint: "ör. Ev, İş",
  street: "Sokak",
  houseNo: "No",
  zip: "Posta kodu",
  city: "Şehir",
  selectCity: "Şehir seçin",
  selectZip: "Posta kodu seçin",
  loading: "Yükleniyor…",
  floor: "Kat / daire",
  floorHint: "isteğe bağlı — kuryeye yardımcı olur",
  bellName: "Zilde yazan isim",
  bellHint: "isteğe bağlı — farklıysa",
  makeDefault: "Varsayılan adres olsun",
  isDefault: "Varsayılan adres",
  setDefault: "Varsayılan yap",
  edit: "Düzenle",
  remove: "Sil",
  save: "KAYDET",
  saving: "KAYDEDİLİYOR…",
  cancel: "Vazgeç",
  saved: "Kaydedildi.",
  deleteAddressTitle: "Adresi sil",
  deleteAddressText:
    "Bu adres defterinizden kaldırılacak. Verilmiş siparişleriniz bundan etkilenmez.",
  addressLimit: "Kaydedebileceğiniz en fazla adres sayısına ulaştınız.",

  favoritesTitle: "Favorileriniz",
  favoritesLead:
    "Menüdeki kalp simgesiyle sık ısmarladığınız ürünleri işaretlersiniz. Hepsi burada, elinizin altında.",
  favoritesEmpty:
    "Henüz favoriniz yok. Menüde bir ürünün yanındaki kalbe dokunun.",
  favoriteUnavailable: "Şu anda mevcut değil",
  removeFavorite: "Favorilerden çıkar",
  addToCart: "Sepete ekle",
  addedToCart: "Sepete eklendi",
  toMenu: "Menüye git",

  settingsTitle: "Ayarlar",
  profileTitle: "İletişim",
  profileLead:
    "Ad ve telefon sipariş sırasında önden doldurulur. Adreslerinizi “Adresler” bölümünden yönetirsiniz.",
  name: "Ad soyad",
  phone: "Telefon",
  legalTitle: "Verileriniz",
  exportBtn: "Verilerimi indir (JSON)",
  exportHint: "Art. 20 DSGVO uyarınca veri taşınabilirliği hakkınız.",
  deleteTitle: "Hesabı sil",
  serverError: "Sunucuya ulaşılamadı.",
  saveFailed: "Kaydedilemedi.",
};
