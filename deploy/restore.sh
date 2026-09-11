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
echo "Arşiv bütünlüğü: tamam"

if [ "$DRY_RUN" = true ]; then
	echo "--- deneme (geçici veritabanına yükleniyor, canlıya dokunulmuyor) ---"
	$COMPOSE exec -T postgres psql -U doner -d postgres -c 'DROP DATABASE IF EXISTS restore_test;'
	$COMPOSE exec -T postgres psql -U doner -d postgres -c 'CREATE DATABASE restore_test;'
	gunzip -c "$ARCHIVE" | $COMPOSE exec -T postgres psql -q -U doner -d restore_test >/dev/null
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
gunzip -c "$ARCHIVE" | $COMPOSE exec -T postgres psql -q -U doner -d doner

echo "Uygulama başlatılıyor…"
$COMPOSE start app

echo "Bitti. Kontrol: curl -s https://\$DOMAIN/api/health"
