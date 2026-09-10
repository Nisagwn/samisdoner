# THE // DÖNER

Next.js (App Router) + TypeScript + Tailwind CSS + GSAP (ScrollTrigger) + Lenis
ile hazırlanmış, karanlık modda "cyberpunk × gurme gastronomi" temalı döner
restoran sitesi. Tüm görseller sizin verdiğiniz 3 fotoğraftan (şiş, patlamış
sandviç, malzeme flatlay'i) türetildi — kod içinde üretilmiş/placeholder görsel
yok.

## Kurulum

Veritabanı ve önbellek Docker'da çalışır; uygulama makinede.

```bash
bun install
cp .env.example .env.local      # gizli anahtarları doldur

docker compose up -d            # Postgres + Redis
bun run db:deploy               # göçleri uygula (şemayı kur)
bun run db:seed                 # menüyü ve işletme bilgisini yaz

bun dev
```

Tarayıcıda `http://localhost:3000` adresini aç.
Durum kontrolü: `http://localhost:3000/api/health`

> Veritabanı neden yerel: uzak Supabase'e (Frankfurt) her sorgu ~87–450 ms
> sürüyordu ve bir sayfa birkaç sorgu atıyor. Aynı makinedeki Postgres'te bu
> ~1 ms. Supabase'e dönmek isterseniz `.env.example` içindeki yorumlu adresleri
> kullanın.

Production build:

```bash
bun run build
bun run start
```

> `bun run start` şu uyarıyı yazar: *"next start" does not work with "output:
> standalone"*. Yerelde zararsızdır, sunucu düzgün çalışır — uyarı, standalone
> çıktısının kendi sunucusunun (`.next/standalone/server.js`) kullanılmadığını
> söyler. Canlıda Docker imajı zaten o sunucuyu çalıştırır.

Geliştirme `.next-dev`, derleme `.next` dizinine yazar; bu yüzden dev sunucusu
açıkken derleme yapabilirsiniz (aynı dizini paylaştıklarında turbopack artıkları
webpack derlemesini bozuyordu).

## Canlıya alma

Tüm yığın Docker'da: Caddy (otomatik HTTPS) + uygulama + Postgres + Redis +
günlük yedek + zamanlanmış görev. Mimarinin gerekçeleri, sunucu kurulumu, yedek
ve geri yükleme adımları: **[deploy/README.md](deploy/README.md)**

```bash
cp .env.prod.example .env.prod && nano .env.prod
bun run docker:prod
```

> Not: `bun run build` sırasında Google Fonts'a (Unbounded, JetBrains Mono,
> Inter) internet üzerinden erişilir. İnternetsiz bir CI ortamında build
> alıyorsanız `app/layout.tsx` içindeki `next/font/google` importlarını
> self-hosted font dosyalarıyla değiştirin.

## Klasör yapısı

```
app/
  layout.tsx        Font yükleme, Lenis sarmalayıcı
  page.tsx           Tüm bölümleri sıralar
  globals.css         Tasarım token'ları, scanline/grain efektleri
components/
  Navbar.tsx           Sabit üst menü
  Hero.tsx             Şiş görseli + GSAP giriş animasyonu + HUD etiketleri
  AssemblyLog.tsx      Pinlenmiş scrollytelling: 8 malzeme sırayla "inşa" oluyor
  FinalStack.tsx       Patlamış sandviç görseli, clip-path reveal + istatistikler
  MenuGrid.tsx         Karta: kategori kategori ürün listesi, sepete ekleme
  Footer.tsx           İletişim/konum
data/
  speisekarte.ts       Kartanın veri şekli (menünün kendisi panelden gelir)
public/assets/
  hero-fire.webp        Hero tam kaplama arka planı: ateş karşısında dönen şiş
  final-stack.webp       Patlamış sandviç fotoğrafınız (tam)
  ing-*.png              Malzeme flatlay'inden tek tek kesilip arka planı
                           şeffaflaştırılmış 8 malzeme sprite'ı
  menu-*.webp             3 sabit menünün kart fotoğrafları
  noise.png               İnce grain dokusu
```

## Neden bu görseller böyle kullanıldı

- **Malzeme flatlay fotoğrafı** (Gemini) 8 parçaya ayrıldı, beyaz arka planı
  piksel bazlı alfa geçişiyle şeffaflaştırıldı → `AssemblyLog` bölümünde her
  malzeme scroll'a bağlı olarak sahneye "uçarak" giriyor.
- **Patlamış sandviç fotoğrafı** (ChatGPT) bütün halde `FinalStack`
  bölümünde clip-path ile scroll'a bağlı bir "kadraj açılıyor" efektiyle
  kullanılıyor.
- **Şiş fotoğrafı** (ChatGPT) zaten siyah zeminde olduğu için doğrudan
  `Hero` bölümünün merkez görseli oldu; glow ve scroll-linked scale/parallax
  eklendi.
- **Menü fotoğrafları** (Gemini) `MenuGrid` bölümünde her sabit menünün kart
  görseli olarak kullanılıyor; hover'da hafif zoom + doygunluk artışı var.

## Değiştirmek isteyebilecekleriniz

- Ürünler, kategoriler ve fiyatlar **kodda değil**, yönetim panelinde:
  `/admin/menu`. Servis ve teslimat ücretleri `/admin/zones`, çalışma saatleri
  `/admin/betrieb`.
- `tailwind.config.ts` — renk paleti (`flame`, `amber`, `void`, `char`)
- `components/Footer.tsx` — adres/telefon/saatler
- Fontlar `app/layout.tsx` içinde `next/font/google` ile tanımlı; marka
  fontunuz varsa aynı yerden değiştirilir.
