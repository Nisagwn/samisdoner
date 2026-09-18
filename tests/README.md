# Test ve doğrulama

Üç katman var. Her biri farklı bir soruya cevap verir; hiçbiri diğerinin yerine geçmez.

| Katman | Komut | Neyi kanıtlar |
|---|---|---|
| Birim testler | `npm test` | Saf mantık doğru mu (para, KDV, durum makinesi, jeton, parola, girdi ayıklama) |
| Akış doğrulaması | `npm run verify:flow` | Parçalar birbirine bağlı mı (gerçek DB + gerçek Stripe test hesabı) |
| Elle senaryo | aşağıda | Müşterinin gördüğü şey doğru mu |

`verify:flow` yarattığı bütün kayıtları sonunda siler ve yalnızca `sk_test_` anahtarıyla
çalıştırılmalıdır.

---

## Elle doğrulama senaryosu

Ön koşul: `npm run dev` çalışıyor, `.env.local` dolu, `npm run db:seed` bir kez koşmuş.

### 1. Menü ve yasal bilgi (LMIV Art. 14, PAngV § 4)

1. `/speisekarte` aç.
2. Her ürünün altında alerjen satırı olmalı. Alerjen bilgisi girilmemiş üründe
   kırmızı **"Allergene bitte erfragen"** yazmalı — **boş kalmamalı**.
   *(Boş kalması, müşteriye "alerjen yok" demekle aynı izlenimi yaratır.)*
3. Sayfanın en altında A–N ve 1–14 açıklama listesi olmalı.
4. İçeceklerde fiyatın yanında litre fiyatı görünmeli: `0,33 → 2,50 € (7,58 €/l)`.
5. Pizzalarda **litre fiyatı görünmemeli** (28 CM bir çaptır, hacim değil).

### 2. Sipariş akışı (§ 312j BGB)

1. Sepete 15 €'yu aşacak kadar ürün ekle.
2. Sepeti aç → tutarların sunucudan geldiğini gör (ağ sekmesinde `/api/menu/quote`).
3. "ADRES BİLGİLERİ" → formu doldur, PLZ olarak **94342** gir.
   - Teslimat ücreti ve minimum sepet uyarısı **PLZ girilir girilmez** çıkmalı.
   - PLZ **10115** girildiğinde "teslimat yapmıyoruz" uyarısı çıkmalı.
4. Butonun **hemen üstünde** kalem listesi + ara toplam + ücretler + toplam olmalı.
   Araya başka içerik girmemeli.
5. Buton metni **"ZAHLUNGSPFLICHTIG BESTELLEN"** (DE) / **"ÖDEMELİ SİPARİŞİ VER"** (TR)
   olmalı. "Zur Kasse" yazıyorsa sözleşme § 312j Abs. 4 uyarınca kurulmamış sayılır.
6. Butonun altında AGB / Datenschutz / Allergene bağlantıları ve cayma hakkı uyarısı olmalı.
7. Butona bas → Stripe sayfası açılmalı. Test kartı: `4242 4242 4242 4242`, ileri bir tarih,
   herhangi bir CVC.

### 3. Ödeme sonrası

Stripe CLI çalışıyor olmalı:

```
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

1. Ödemeyi tamamla → `/bestellung/<token>` takip sayfasına dönmelisin.
2. Sepet **boşalmış** olmalı (ödeme onaylandığı için).
3. Durum çubuğu "Bezahlt" adımında olmalı.
4. Adres çubuğundaki jetonun son karakterini değiştir → **404** almalısın.

### 4. Mutfak paneli

1. `/admin/orders` aç, giriş yap.
2. Sipariş listede belirmeli (en geç 5 saniye içinde).
3. **"♪ Sesi etkinleştir"**e bas → uyarı çalmalı ve 4 saniyede bir tekrarlamalı.
4. **"Görüldü"**ye bas → ses susmalı, sipariş listede kalmalı.
5. Kabul et → Hazırlanıyor → Yola çıktı → Teslim edildi.
6. Müşteri takip sayfası (açık bırak) 20 saniye içinde kendiliğinden güncellenmeli.
7. `/admin/bewertungen` → her yorumun altında **"Puanlanan sipariş"** ve ürünleri
   görünmeli. Cevap yaz ya da yorumu gizle → satır tazelendikten sonra ürünler
   **hâlâ durmalı** (yazma uçları listeyle aynı şekli döndürmeli).

### 5. Üyelik

1. `/konto/registrieren` → hesap aç. Kayıttan sonra doğrudan `/konto` açılmalı.
2. Adres alanlarını doldur, kaydet.
3. Sepete ürün ekle → adres formu **kayıtlı bilgilerle dolu** gelmeli.
4. `/konto/adressen` → ikinci bir adres kaydet → `/checkout` (teslimat seçili) →
   "Teslimat adresi" başlığının altında **kayıtlı adresler şeridi** çıkmalı, bir
   adrese dokununca form dolmalı. Şerit ön doldurmayla aynı isteğe bağlıdır:
   geliştirme kipinde StrictMode efekti iki kez kurduğu için bir kez bu istek
   iptal edilip hiç yenilenmemişti, yani **bu adım tarayıcıda görülmeden
   doğrulanmış sayılmaz** (birim testler istemci efektlerine bakmıyor).
5. Alanlardan birini elle değiştir, çekmeceyi kapat/aç → **değişiklik korunmalı**
   (ön doldurma üzerine yazmamalı).
6. `/konto` → geçmiş siparişte "Tekrar sipariş ver" → sepet dolmalı.
7. `/konto/bewertungen` → değerlendirme satırındaki ürün etiketine bas → menüde
   **o ürünün penceresi açılmalı**, içinde değerlendirmeler görünmeli.
8. Parolayı değiştir → **başka bir tarayıcıdaki oturum düşmeli**, bu tarayıcı açık kalmalı.
9. "Verilerimi indir" → JSON inmeli, içinde `passwordHash` **olmamalı**.
10. Hesabı sil → çıkış yapmalı; `/admin/orders`'ta siparişin **hâlâ görünmeli** ama
   müşteri adı "Gelöschtes Konto" olmalı.

### 6. Yetki denemeleri (hepsi başarısız olmalı)

| Deneme | Beklenen |
|---|---|
| Oturumsuz `GET /api/account/profile` | 401 |
| Çerezdeki müşteri kimliğini değiştir | 401 |
| Oturumsuz `GET /api/admin/orders` | 401 |
| İmzasız `POST /api/webhooks/stripe` | 400 |
| `GET /api/cron/expire-orders` (başlıksız) | 401 / 503 |
| `/api/menu/quote` gövdesine `priceCents: 1` koy | Katalog fiyatı döner, 1 değil |

### 7. Canlıya çıkmadan önce

- [ ] `.env`'den `ORDERS_IGNORE_OPENING_HOURS` **kaldırılmış** olmalı
      (açık kalırsa gece 03:00'te sipariş alınır ve tahsil edilir).
- [ ] `LEGAL_*` değişkenleri dolu → `/impressum` sayfasında kırmızı uyarı **olmamalı**.
- [ ] Panelden **her ürünün** alerjen bilgisi girilmiş olmalı; menüde hiçbir üründe
      "bitte erfragen" kalmamalı.
- [ ] `CRON_SECRET` tanımlı ve zamanlanmış görev kurulu.
- [ ] Stripe canlı anahtarları ve canlı webhook imza anahtarı.
