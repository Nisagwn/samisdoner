# Sistem mimarisi ve canlıya alma

Bu dizin, siteyi Almanya'daki tek bir sunucuda çalıştırmak için gereken her şeyi
içerir. Altta önce **neden böyle** kurulduğu, sonra adım adım **nasıl** kurulacağı
anlatılıyor.

---

## Mimari

```
                         ┌───────────────────────────────────────────┐
   internet  ──── 443 ───▶│ caddy    otomatik TLS, sıkıştırma,        │
                          │          statik dosyalara önbellek başlığı│
                          └──────────────────┬────────────────────────┘
                                             │ :3000
                          ┌──────────────────▼────────────────────────┐
                          │ app      Next.js (standalone), Node 22     │
                          └──────┬──────────────────────┬─────────────┘
                                 │                      │
                    ┌────────────▼─────────┐  ┌─────────▼──────────┐
                    │ postgres  aynı makine│  │ redis   önbellek   │
                    │           ~0.5 ms    │  │         128 MB LRU │
                    └────────────┬─────────┘  └────────────────────┘
                                 │
                    ┌────────────▼─────────┐  ┌────────────────────┐
                    │ backup   günlük dump │  │ cron  15 dk'da bir │
                    └──────────────────────┘  └────────────────────┘
```

### Neden tek sunucu

Sitede yoğun trafik yok. Bir döner dükkânının akşam yoğunluğu dakikada birkaç
siparişle ölçülür; bu yük 2 vCPU'lu bir makineyi zorlamaz. Dolayısıyla kazanılması
gereken şey **ölçek değil, gecikme**.

Ölçülen fark:

| Kurulum | Sorgu gecikmesi | Sayfa (üretim) |
|---|---|---|
| Vercel + Supabase havuzlayıcı | ~450 ms | saniyeler |
| Vercel + Supabase doğrudan | ~87 ms | ~1 sn |
| Aynı makinede Postgres | ~0.5 ms | **23–35 ms** |

Uygulama ile veritabanının aynı makinede olması, mimarinin en büyük tek kazancıdır.

### Neden Redis

Menü, fiyat ayarları, çalışma saatleri ve teslimat bölgeleri neredeyse hiç
değişmez ama her istekte okunur. `lib/cache.ts` bunları önbellekte tutar; sepet
çekmecesi açıldığında atılan üç sorgu sıfıra iner (`/api/menu/status` → **6 ms**).

Redis **zorunlu değildir**. `REDIS_URL` tanımlı değilse ya da Redis kapanırsa
önbellek süreç içi belleğe düşer ve site çalışmaya devam eder — sadece yeniden
başlatmada önbellek boşalır. Bu bilinçli: bir döner dükkânının sitesi, önbellek
sunucusu düştü diye sipariş almayı bırakmamalı.

### Neden Caddy

Sertifikayı Let's Encrypt'ten kendisi alır ve yeniler. Nginx + certbot + cron
üçlüsünün yerine dört satırlık bir yapılandırma dosyası geçiyor.

---

## Yerel geliştirme

```bash
docker compose up -d      # Postgres + Redis
bun run db:deploy         # göçleri uygula (şemayı kur)
bun run db:seed           # menüyü ve işletme bilgisini yaz
bun dev                   # uygulama (makinede, kapta değil)
```

Uygulama bilinçli olarak kapta değil: Next'in sıcak yeniden yüklemesi Windows'ta
bir Docker birimi üzerinden dosya izlerken belirgin şekilde yavaşlar.

Durdurmak: `docker compose down` (veri kalır) · `docker compose down -v` (veri gider).

---

## Canlıya alma

### 1. Sunucu

Almanya'da bir sunucu kiralayın — Hetzner CX22 (2 vCPU / 4 GB / 40 GB, ~4 €/ay)
bu iş için fazlasıyla yeterli. Konum **Nürnberg ya da Falkenstein** olsun: sipariş
kayıtları ad, adres ve telefon içerir; veri Almanya'da kalırsa DSGVO tarafında
sınır ötesi aktarım sorusu hiç açılmaz.

Ubuntu 24.04 kurun, sonra:

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Güvenlik duvarı: yalnızca SSH ve web
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

> Postgres ve Redis portları dışarı **açılmaz**; yalnızca Docker ağı üzerinden
> erişilir. `ufw` bunu ayrıca güvenceye alır.

### 2. DNS

Alan adının `A` kaydını sunucunun IP adresine yöneltin. Caddy sertifikayı bu ada
göre alır; kayıt yayılmadan önce başlatırsanız sertifika isteği başarısız olur ve
Let's Encrypt bir süre yeniden denemenizi engeller.

### 3. Kod ve ayarlar

```bash
git clone <repo> /opt/doner && cd /opt/doner

cp .env.prod.example .env.prod
nano .env.prod          # tüm alanları doldurun
chmod 600 .env.prod     # içinde Stripe anahtarı var
```

İlk kurulumda `SEED_ON_START=true` yapın — boş veritabanına menü yazılır.
**İlk açılıştan sonra mutlaka `false` yapın**, yoksa her dağıtımda menü dosyadaki
hâline döner ve panelden yapılan değişiklikler silinir.

### 4. Başlat

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f
```

Sıra kendiliğinden kurulur: `postgres` sağlıklı olur → `migrate` şemayı kurup
biter → `app` başlar ve sağlık kontrolünü geçer → `caddy` trafiği açar.

### 5. Stripe

Stripe panelinde webhook ucunu ekleyin:

```
https://<alan-adınız>/api/webhooks/stripe
```

Verilen imza anahtarını `.env.prod` içindeki `STRIPE_WEBHOOK_SECRET` alanına
yazıp `app` servisini yeniden başlatın. Webhook olmadan ödeme alınır ama sipariş
"ödeme bekleniyor"da kalır (mutabakat onu kurtarır, yine de asıl yol webhook'tur).

### 6. Kontrol listesi

- [ ] `https://<alan-adı>/api/health` → `{"status":"ok"}`
- [ ] `/impressum` kırmızı uyarı göstermiyor (yasal alanlar dolu)
- [ ] Panelden giriş yapılabiliyor, menü görünüyor
- [ ] Test siparişi uçtan uca geçiyor (ödeme → webhook → panelde görünüyor)
- [ ] `.env.prod` içinde `ORDERS_IGNORE_OPENING_HOURS` **yok**
- [ ] `SEED_ON_START=false`
- [ ] `BACKUP_REMOTE` dolu ve `dc logs backup` "uzak kopya tamam" diyor
- [ ] Ertesi gün `ls backups/` bir dosya gösteriyor
- [ ] `sh deploy/restore.sh --dry-run` geçiyor (yedek gerçekten yüklenebiliyor)
- [ ] Panel işletmeciye teslim edildi (aşağıdaki bölüm)

---

## 7. Paneli işletmeciye teslim etme

Panele giriş **kişiye** bağlıdır: her personelin kendi e-postası ve parolası
olur, panelde yapılan her iş (siparişi kim reddetti, parayı kim iade etti) o
kişinin adına yazılır. Ortak bir parola dolaşımda kalmaz.

`.env.prod` içindeki `ADMIN_PASSWORD` bir giriş parolası değil, **kurulum
anahtarıdır**: yalnızca panelde hiç sahip hesabı yokken çalışır. İşletmeci
kendi hesabını açtığı anda o yol kendiliğinden kapanır — kapatmayı kimsenin
hatırlaması gerekmez, giriş ekranında ikinci bir yol görünmez.

### Teslim adımları

1. Dağıtımdan önce `.env.prod` içine rastgele bir kurulum anahtarı koyun:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
2. Bu değeri işletmeciye **tek seferlik** verin (telefonla söylemek, kalıcı bir
   mesajda bırakmaktan iyidir) ve `https://<alan-adı>/admin/login` adresini
   gösterin. Ekran "İlk Kurulum" der ve tek bir parola alanı gösterir.
3. İşletmeci anahtarı girer, doğrudan **Personel** ekranına düşer ve kendi
   hesabını açar: e-posta, ad, parola, rol **OWNER**.
4. Hesap açıldığı an kurulum anahtarı çalışmayı bırakır. İşletmeci çıkış yapıp
   kendi e-postasıyla girerek bunu birlikte doğrulayın: giriş ekranında artık
   yalnızca e-posta + parola vardır.
5. İşletmeci personelini kendi ekler. Roller:

   | Rol | Ne yapabilir |
   |---|---|
   | `STAFF` | Siparişleri görür, kabul/ret eder, hazırlık süresi verir |
   | `MANAGER` | Ek olarak menü, fiyat, bölge ve çalışma saatleri |
   | `OWNER` | Ek olarak personel yönetimi, ciro ve para iadesi |

6. İşten ayrılan biri olursa hesabı **pasifleştirilir** (silinmez): açık
   oturumları anında düşer, geçmiş kayıtlarındaki adı yerinde kalır.

### Kilitlenme durumu

Tek sahip hesabının parolası unutulduysa sunucuya erişebilen kişi geçici
olarak kurulum anahtarını yeniden açar:

```bash
cd /opt/samis-doener
echo "ADMIN_RECOVERY=1" >> .env.prod
dc up -d app                      # yeniden başlat

# ...işletmeci girip kendine yeni parola belirledikten sonra:
sed -i '/^ADMIN_RECOVERY=/d' .env.prod
dc up -d app
```

Bu satır açık unutulursa ortak parola kalıcı bir arka kapıya döner; iş biter
bitmez kaldırın.

---

## Günlük işler

```bash
# kısaltma: her komutun başına bunu yazmamak için
alias dc='docker compose -f /opt/doner/docker-compose.prod.yml --env-file /opt/doner/.env.prod'

dc ps                    # servis durumu
dc logs -f app           # uygulama günlüğü
dc restart app           # yalnızca uygulamayı yeniden başlat
dc down                  # her şeyi durdur (veri kalır)
```

### Yeni sürüm yayınlama

```bash
cd /opt/doner && git pull
dc up -d --build
```

Eski kap, yenisi sağlık kontrolünü geçene kadar ayakta kalmaz — kısa (birkaç
saniyelik) bir kesinti olur. Bu sitede kesintisiz dağıtım kurmanın maliyeti,
gece 03:00'te üç saniyelik kesintinin bedelinden yüksek.

### Veritabanına bakmak

```bash
dc exec postgres psql -U doner -d doner
```

---

## Yedek

`backup` servisi her gün üç iş yapar:

1. `pg_dump` alıp sıkıştırır → `/opt/doner/backups/doner-<zaman>.sql.gz`
2. **Bütünlüğünü sınar** (`gzip -t`). Geçmezse dosya atılır ve günlüğe hata
   düşer — yarıda kesilmiş bir dump, dizin dolu görünürken geri yüklenmez.
3. `BACKUP_REMOTE` tanımlıysa **makine dışına** kopyalar (rclone).

Ayrıca son başarılı yedeğin zamanı `backups/.son-basarili` dosyasına yazılır;
48 saatten eskiyse her turda günlüğe hata düşer. Yerelde 14 günden eskiler
silinir, **uzaktakilere dokunulmaz** (`rclone copy`, `sync` değil).

### Uzak hedef kurulumu

Yedeğin sunucunun kendi diskinde durması yeterli değildir: disk giderse yedek de
gider. `deploy/backup-secrets/rclone.conf` dosyasını oluşturun (bu dizin
`.gitignore`'da, repoya girmez) ve `.env.prod` içinde `BACKUP_REMOTE` değerini
doldurun.

**Seçenek A — Hetzner Storage Box** (~3,5 €/ay, 1 TB, veri Almanya'da kalır;
sunucu zaten Hetzner'deyse en doğal seçim):

```bash
mkdir -p deploy/backup-secrets

# Parolasız erişim için anahtar üretip Storage Box'a tanıtın
ssh-keygen -t ed25519 -f deploy/backup-secrets/id_ed25519 -N ""
ssh-copy-id -s -p 23 -i deploy/backup-secrets/id_ed25519 <kullanici>@<kullanici>.your-storagebox.de

cat > deploy/backup-secrets/rclone.conf <<'EOF'
[storagebox]
type = sftp
host = <kullanici>.your-storagebox.de
user = <kullanici>
port = 23
key_file = /config/rclone/id_ed25519
EOF

chmod 600 deploy/backup-secrets/id_ed25519
```

`.env.prod` → `BACKUP_REMOTE=storagebox:doner-yedek`

**Seçenek B — Backblaze B2** (kullandığın kadar öde; birkaç yüz MB için ayda
birkaç sent). B2 panelinde bir bucket ve uygulama anahtarı oluşturun:

```bash
mkdir -p deploy/backup-secrets
cat > deploy/backup-secrets/rclone.conf <<'EOF'
[b2]
type = b2
account = <keyID>
key = <applicationKey>
EOF
chmod 600 deploy/backup-secrets/rclone.conf
```

`.env.prod` → `BACKUP_REMOTE=b2:<bucket-adi>/doner-yedek`

> B2 sunucuları ABD'de. Yedek kişisel veri içerdiği için DSGVO tarafında bu bir
> **üçüncü ülkeye aktarım**dır ve veri işleme sözleşmesi gerektirir. Veriyi
> Almanya'da tutmak istiyorsanız Seçenek A'yı seçin — bu yüzden önerilen odur.

Kurulumdan sonra sınayın:

```bash
dc up -d --build backup
dc logs -f backup        # "uzak kopya tamam → ..." satırını bekleyin
```

### Geri yükleme

`deploy/restore.sh` tek komuta indiriyor — geri yükleme, yılda bir kez ve panik
hâlindeyken yapılan bir iştir; o anda README'den boru hattı kopyalamak hata
üretir.

```bash
sh deploy/restore.sh --dry-run    # yedeği AYRI bir veritabanına yükler, sayar, siler
sh deploy/restore.sh              # en son yedeği canlıya geri yükler (onay ister)
sh deploy/restore.sh backups/doner-2026-09-10T03-00-00Z.sql.gz
```

Uzaktaki bir yedeği önce indirin:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm   --entrypoint rclone backup copy storagebox:doner-yedek /backups   --include 'doner-2026-09-10*'
```

> **Yılda birkaç kez `--dry-run` çalıştırın.** Hiç denenmemiş bir yedek, yedek
> değildir. Deneme canlıya dokunmaz: geçici bir veritabanı oluşturur, yedeği
> oraya yükler, satır sayılarını basar ve veritabanını siler.

Sipariş kayıtları **8 yıl** saklanmak zorunda (Buchungsbelege). Uzak hedefteki
dosyalar silinmediği için bu yükümlülük oradaki arşivle karşılanır; sunucudaki
14 günlük döngü "dün çalışıyordu" noktasına dönmek içindir.

---

## Şema göçleri

`prisma/migrations/0_init` şemanın tamamını kuran ilk göçtür. Boş bir
veritabanına `prisma migrate deploy` ile uygulandığı ve sonucun şemayla birebir
eşleştiği doğrulandı (`migrate diff` → *no difference detected*).

`deploy/migrate.sh`, dizin var olduğu için **`migrate deploy`** kullanır:
yalnızca uygulanmamış göçleri çalıştırır, veriyi korur. `db push`e (sütun
yeniden adlandırıldığında veriyi götüren yol) yalnızca göç dizini hiç yoksa
düşer.

### Şemayı değiştirirken

```bash
# 1. prisma/schema.prisma dosyasını düzenleyin
# 2. göç dosyasını üretin (yerel veritabanına da uygular)
bun run db:migrate --name aciklayici-ad
# 3. üretilen SQL'i okuyun — özellikle DROP ve ALTER TYPE satırlarını
cat prisma/migrations/*_aciklayici-ad/migration.sql
# 4. commit'leyin; dağıtımda kendiliğinden uygulanır
git add prisma/migrations && git commit -m "Göç: aciklayici-ad"
```

> Alan **yeniden adlandırma** Prisma tarafından "eskisini sil, yenisini ekle"
> olarak üretilir ve veriyi götürür. Bu durumda üretilen SQL'i elle
> `ALTER TABLE ... RENAME COLUMN` olarak düzeltin.

### Zaten `db push` ile kurulmuş bir veritabanı varsa

Tabloları duran ama göç kaydı olmayan bir veritabanına `migrate deploy`
çalıştırmak "veritabanı boş değil" hatası verir. O veritabanını temel alın:

```bash
dc run --rm --entrypoint sh migrate -c 'bunx prisma migrate resolve --applied 0_init'
```

Bu, hiçbir SQL çalıştırmadan `0_init`i "uygulanmış" olarak işaretler; sonraki
göçler normal şekilde ilerler.

---

## Vercel'e ne oldu

`vercel.json` dosyası duruyor ama bu kurulumda kullanılmıyor. Zamanlanmış görevi
artık `docker-compose.prod.yml` içindeki `cron` servisi yapıyor ve Vercel Hobby
planının günde bir çalıştırma sınırı olmadığı için tarama **15 dakikada bir**
dönüyor: ödemesi yarım kalmış siparişler panelde saatlerce beklemiyor.

Vercel'e geri dönmek isterseniz kodda değişiklik gerekmez — `REDIS_URL` olarak
Upstash (Frankfurt) adresi verilir, veritabanı Supabase'e döner. Önbellek katmanı
her iki düzende de aynı çalışır.
