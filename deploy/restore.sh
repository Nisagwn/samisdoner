#!/bin/sh
# Yedekten geri yükleme.
#
#   sh deploy/restore.sh                                → en son yedeği yükler
#   sh deploy/restore.sh backups/doner-2026-09-10T....gz  → belirli bir yedeği
#   sh deploy/restore.sh --dry-run                        → yalnızca sınar, yazmaz
#
# Neden ayrı bir betik: geri yükleme, yılda bir kez ve **panik hâlindeyken**
# yapılan bir iştir. O anda README'den boru hattı kopyalamak, yanlış veritabanına
# yazmak ya da uygulamayı durdurmayı unutmak için ideal koşullardır. Adımlar
# burada sabit.
#
# `--dry-run` denemesini yılda birkaç kez yapın: yedeği ayrı bir veritabanına
# yükler, tabloları sayar ve siler. Hiç denenmemiş bir yedek, yedek değildir.
set -eu

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"
DRY_RUN=false
ARCHIVE=""

for arg in "$@"; do
	case "$arg" in
	--dry-run) DRY_RUN=true ;;
	*) ARCHIVE="$arg" ;;
	esac
done

if [ -z "$ARCHIVE" ]; then
	ARCHIVE="$(ls -1t backups/doner-*.sql.gz 2>/dev/null | head -1 || true)"
	[ -n "$ARCHIVE" ] || {
		echo "backups/ içinde yedek yok. Uzaktan indirin:" >&2
		echo "  rclone copy <uzak-hedef> ./backups --include 'doner-*.sql.gz'" >&2
		exit 1
	}
fi

[ -f "$ARCHIVE" ] || { echo "Dosya yok: $ARCHIVE" >&2; exit 1; }

echo "Yedek: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# Bozuk bir arşivi canlı veritabanına dökmeye başlamak, elde kalan son sağlam
# durumu da bozar. Önce sınanır.
gzip -t "$ARCHIVE" || { echo "Arşiv bozuk, geri yükleme yapılmadı." >&2; exit 1; }

# gzip sınavı yalnızca sıkıştırmanın sağlamlığını söyler, dökümün TAM olduğunu
# söylemez: yarıda kesilmiş bir pg_dump da kusursuz bir gzip dosyasıdır.
# pg_dump bu satırı ancak işini bitirdiğinde yazar.
if ! gunzip -c "$ARCHIVE" | tail -20 | grep -q "PostgreSQL database dump complete"; then
	echo "Arşiv EKSİK (pg_dump tamamlanmamış), geri yükleme yapılmadı." >&2
	exit 1
fi
echo "Arşiv bütünlüğü: tamam (gzip + döküm sonu)"

if [ "$DRY_RUN" = true ]; then
	echo "--- deneme (geçici veritabanına yükleniyor, canlıya dokunulmuyor) ---"
	$COMPOSE exec -T postgres psql -U doner -d postgres -c 'DROP DATABASE IF EXISTS restore_test;'
	$COMPOSE exec -T postgres psql -U doner -d postgres -c 'CREATE DATABASE restore_test;'
	# ON_ERROR_STOP=1 şart: psql varsayılanda hatalı bir ifadeden sonra DEVAM
	# eder ve yine de 0 ile çıkar. Onsuz "deneme tamam" yazısı, aslında yarım
	# yüklenmiş bir veritabanının üzerine basılırdı.
	gunzip -c "$ARCHIVE" | $COMPOSE exec -T postgres psql -q -v ON_ERROR_STOP=1 -U doner -d restore_test >/dev/null
	echo "--- yüklenen satır sayıları ---"
	$COMPOSE exec -T postgres psql -U doner -d restore_test -c \
		'SELECT (SELECT count(*) FROM "Product") AS urun, (SELECT count(*) FROM "Order") AS siparis, (SELECT count(*) FROM "Category") AS kategori;'
	$COMPOSE exec -T postgres psql -U doner -d postgres -c 'DROP DATABASE restore_test;'
	echo "Deneme tamam — yedek geri yüklenebilir durumda."
	exit 0
fi

echo
echo "UYARI: canlı veritabanının içeriği bu yedekle DEĞİŞTİRİLECEK."
echo "Yedekten sonra alınmış tüm siparişler kaybolur."
printf "Devam etmek için 'evet' yazın: "
read -r answer
[ "$answer" = "evet" ] || { echo "Vazgeçildi."; exit 1; }

echo "Uygulama durduruluyor (yükleme sırasında yazma olmasın)…"
$COMPOSE stop app

echo "Geri yükleniyor…"
# ON_ERROR_STOP=1: hata anında dur. Panik gününde en kötü sonuç, sessizce yarım
# yüklenmiş bir veritabanının üzerine "Bitti" yazılmasıdır.
gunzip -c "$ARCHIVE" | $COMPOSE exec -T postgres psql -q -v ON_ERROR_STOP=1 -U doner -d doner

echo "Uygulama başlatılıyor…"
$COMPOSE start app

echo "Bitti. Kontrol: curl -s https://\$DOMAIN/api/health"
