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

  /* --- değerlendirme --- */
  navReviews: "Bewertungen",
  reviewsTitle: "Ihre Bewertungen",
  reviewsLead:
    "Bewerten können Sie nur Bestellungen, die tatsächlich bei Ihnen angekommen sind — deshalb steht hinter jeder Bewertung auf unserer Seite eine echte Bestellung.",
  reviewsNonePending:
    "Zurzeit gibt es nichts zu bewerten. Nach Ihrer nächsten Lieferung erscheint die Bestellung hier.",
  reviewsFoodLabel: "Das Essen",
  reviewsDeliveryLabel: "Die Lieferung",
  reviewsCommentLabel: "Ihr Kommentar",
  reviewsCommentPlaceholder: "Was war gut, was können wir besser machen?",
  reviewsOptional: "optional",
  reviewsSubmit: "BEWERTUNG ABSCHICKEN",
  reviewsSending: "WIRD GESENDET…",
  reviewsClosesAt: "Bewertbar bis",
  reviewsError: "Die Bewertung konnte nicht gespeichert werden.",
  reviewsMineTitle: "Bereits abgegeben",
  /** Yıldızların üstündeki satır: neyi puanladığı görünür olsun. */
  reviewsItemsLabel: "Sie bewerten",
  reviewsItemLink: "Zum Gericht in der Speisekarte",
  reviewsReplyLabel: "Antwort von Sami´s Döner",
  reviewsHidden:
    "Diese Bewertung ist derzeit nicht öffentlich sichtbar.",

  /* --- izinler --- */
  consentTitle: "Benachrichtigungen",
  consentLead:
    "Bestellbestätigungen und Statusmeldungen gehören zur Bestellung und werden immer verschickt. Alles andere entscheiden Sie.",
  consentMarketing: "Angebote und Neuigkeiten per E-Mail",
  consentMarketingHint:
    "Höchstens ein paar Mal im Jahr. Sie können die Einwilligung jederzeit hier widerrufen.",
  consentReviewMails: "Erinnerung, meine Bestellung zu bewerten",
  consentReviewMailsHint:
    "Eine kurze E-Mail nach der Lieferung. Keine Werbung.",
  consentSaved: "Einstellungen gespeichert.",

  /* --- e-posta doğrulama --- */
  verifyTitle: "E-Mail-Adresse",
  verifyPending: "Noch nicht bestätigt",
  verifyDone: "Bestätigt",
  verifyLead:
    "Erst mit einer bestätigten Adresse können wir Ihr Passwort sicher zurücksetzen.",
  verifySend: "BESTÄTIGUNGSLINK SENDEN",
  verifySent:
    "Wir haben Ihnen einen Link geschickt. Er ist eine Woche gültig.",

  /* --- damga kartı --- */
  stampTitle: "Stempelkarte",
  stampLead:
    "Jede gelieferte Bestellung ist ein Stempel. Ist die Karte voll, zeigen Sie den Code bei der nächsten Bestellung vor.",
  stampProgress: "Stempel gesammelt",
  stampReady: "Ihre Karte ist voll!",
  stampCodeLabel: "Ihr Code",
  stampCodeHint:
    "Nennen Sie diesen Code am Telefon oder an der Theke. Unser Team löst ihn für Sie ein.",
  stampExpires: "Gültig bis",
  stampNone: "Noch kein voller Stempelpass.",

  /* --- misafir siparişi bağlama --- */
  claimTitle: "Frühere Bestellung zuordnen",
  claimLead:
    "Als Gast bestellt? Mit Bestellnummer und der damals angegebenen Telefonnummer holen Sie die Bestellung in Ihr Konto.",
  claimOrderNo: "Bestellnummer",
  claimPhone: "Telefonnummer der Bestellung",
  claimSubmit: "BESTELLUNG ZUORDNEN",
  claimDone: "Die Bestellung gehört jetzt zu Ihrem Konto.",
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

  navReviews: "Değerlendirmeler",
  reviewsTitle: "Değerlendirmeleriniz",
  reviewsLead:
    "Yalnızca size gerçekten ulaşan siparişleri değerlendirebilirsiniz — sitemizdeki her yorumun arkasında gerçek bir sipariş bu yüzden var.",
  reviewsNonePending:
    "Şu an değerlendirilecek bir şey yok. Bir sonraki teslimattan sonra siparişiniz burada görünecek.",
  reviewsFoodLabel: "Yemek",
  reviewsDeliveryLabel: "Teslimat",
  reviewsCommentLabel: "Yorumunuz",
  reviewsCommentPlaceholder: "Ne iyiydi, neyi daha iyi yapabiliriz?",
  reviewsOptional: "isteğe bağlı",
  reviewsSubmit: "DEĞERLENDİRMEYİ GÖNDER",
  reviewsSending: "GÖNDERİLİYOR…",
  reviewsClosesAt: "Son değerlendirme tarihi",
  reviewsError: "Değerlendirme kaydedilemedi.",
  reviewsMineTitle: "Yazdıklarınız",
  reviewsItemsLabel: "Değerlendirdiğiniz",
  reviewsItemLink: "Ürünü menüde aç",
  reviewsReplyLabel: "Sami´s Döner'in cevabı",
  reviewsHidden: "Bu değerlendirme şu anda sitede görünmüyor.",

  consentTitle: "Bildirimler",
  consentLead:
    "Sipariş onayı ve durum bildirimleri siparişin parçasıdır, her zaman gönderilir. Gerisine siz karar verirsiniz.",
  consentMarketing: "Kampanya ve haberler için e-posta",
  consentMarketingHint:
    "Yılda birkaç kez, daha fazla değil. İzni istediğiniz zaman buradan geri alabilirsiniz.",
  consentReviewMails: "Siparişimi değerlendirme hatırlatması",
  consentReviewMailsHint: "Teslimattan sonra kısa bir e-posta. Reklam değil.",
  consentSaved: "Ayarlar kaydedildi.",

  verifyTitle: "E-posta adresi",
  verifyPending: "Henüz doğrulanmadı",
  verifyDone: "Doğrulandı",
  verifyLead:
    "Parolanızı güvenle sıfırlayabilmemiz için adresin doğrulanmış olması gerekir.",
  verifySend: "DOĞRULAMA BAĞLANTISI GÖNDER",
  verifySent: "Size bir bağlantı gönderdik. Bir hafta geçerlidir.",

  stampTitle: "Damga kartı",
  stampLead:
    "Teslim edilen her sipariş bir damgadır. Kart dolduğunda kodu bir sonraki siparişinizde gösterin.",
  stampProgress: "damga toplandı",
  stampReady: "Kartınız doldu!",
  stampCodeLabel: "Kodunuz",
  stampCodeHint:
    "Bu kodu telefonda ya da tezgâhta söyleyin; ekibimiz sizin için kullanır.",
  stampExpires: "Son kullanma",
  stampNone: "Henüz dolmuş bir damga kartı yok.",

  claimTitle: "Eski siparişi hesabına ekle",
  claimLead:
    "Misafir olarak mı sipariş verdiniz? Sipariş numarası ve o siparişteki telefon numarasıyla siparişi hesabınıza alın.",
  claimOrderNo: "Sipariş numarası",
  claimPhone: "Siparişteki telefon numarası",
  claimSubmit: "SİPARİŞİ EKLE",
  claimDone: "Sipariş artık hesabınıza ait.",
};
