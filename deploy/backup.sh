#!/bin/sh
# Günlük veritabanı yedeği — al, doğrula, makine dışına gönder.
#
# NEDEN BU KADAR ADIM VAR
#
# Yedek almak kolay kısmı. Gerçek arıza anında insanları yakan üç şey:
#
#   1. Dosya var ama bozuk. Dump yarıda kesilmişse dizin dolu görünür, geri
#      yükleme ise çalışmaz. Bu yüzden her yedek yazıldıktan sonra
#      `gunzip -t` ile sınanır ve ancak geçerse kalıcı adını alır.
#   2. Yedek, veritabanıyla aynı diskte. Disk giderse ikisi birden gider.
#      Bu yüzden `BACKUP_REMOTE` tanımlıysa dosya rclone ile dışarı kopyalanır.
#   3. Yedek aylardır alınmıyor ama kimse bakmıyor. Bu yüzden son başarılı
#      yedeğin zamanı diske yazılır ve bayatlarsa günlüğe **hata** düşer.
#
# Basit bir döngü kullanılıyor; ayrı bir zamanlayıcı (cron kabı, systemd timer)
# getirmeye değmeyecek kadar küçük bir iş. Kap yeniden başlarsa döngü baştan
# başlar ve hemen bir yedek alır — yeniden başlatma sonrası yedeksiz kalınan
# pencere yok.
set -eu

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
# Son başarılı yedekten sonra bu süre geçtiyse günlüğe hata düşer.
STALE_AFTER="${BACKUP_STALE_SECONDS:-172800}" # 48 saat
STAMP_FILE=/backups/.son-basarili

mkdir -p /backups
export RCLONE_CONFIG="${RCLONE_CONFIG:-/config/rclone/rclone.conf}"

# ------------------------------------------------------------------ yardımcı

log() { echo "[backup] $*"; }

# Yedeği makine dışına kopyalar. `BACKUP_REMOTE` yoksa sessizce atlanır —
# uzak hedef isteğe bağlıdır, tanımlanmadan da yerel yedek alınmaya devam eder.
push_offsite() {
	[ -n "${BACKUP_REMOTE:-}" ] || return 0

	# "remote:yol" biçimindeki hedefler yapılandırma ister; düz bir dizin yolu
	# (bağlanmış bir disk gibi) istemez. Yapılandırma eksikse rclone'un anlaşılmaz
	# hatasını beklemek yerine burada açıkça söylenir.
	case "$BACKUP_REMOTE" in
	*:*)
		if [ ! -f "$RCLONE_CONFIG" ] && [ -z "${RCLONE_CONFIG_REMOTE_TYPE:-}" ]; then
			log "UYARI: BACKUP_REMOTE tanımlı ama rclone yapılandırması yok ($RCLONE_CONFIG)"
			return 1
		fi
		;;
	esac

	# `copy` (sync değil): uzaktaki dosyalar asla silinmez. `sync` kullansaydık
	# sunucudaki yerel temizlik uzak arşivi de budardı — yani 14 günden eski
	# hiçbir yedek hiçbir yerde kalmazdı.
	if rclone copy /backups "$BACKUP_REMOTE" \
		--include 'doner-*.sql.gz' \
		--retries 3 --low-level-retries 5 --timeout 5m \
		--stats-one-line --stats 0; then
		log "uzak kopya tamam → $BACKUP_REMOTE"
		return 0
	fi

	log "HATA: uzak kopya başarısız → $BACKUP_REMOTE"
	return 1
}

# Son başarılı yedeğin üzerinden çok zaman geçtiyse gürültü çıkarır.
warn_if_stale() {
	[ -f "$STAMP_FILE" ] || return 0
	last="$(cat "$STAMP_FILE" 2>/dev/null || echo 0)"
	now="$(date +%s)"
	age=$((now - last))
	if [ "$age" -gt "$STALE_AFTER" ]; then
		log "HATA: son başarılı yedeğin üzerinden $((age / 3600)) saat geçti"
	fi
}

# --------------------------------------------------------------------- döngü

while true; do
	STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
	TARGET="/backups/doner-${STAMP}.sql.gz"

	log "${STAMP} başlıyor"

	# Önce geçici ada yazılır: yedek yarıda kalırsa tamamlanmış gibi görünen
	# bozuk bir dosya bırakmasın.
	if pg_dump -h postgres -U doner -d doner --no-owner --clean --if-exists \
		| gzip -9 >"${TARGET}.partial"; then

		# Bütünlük sınavı: gzip akışı sonuna kadar okunabiliyor mu.
		if gzip -t "${TARGET}.partial" 2>/dev/null; then
			mv "${TARGET}.partial" "${TARGET}"
			log "tamam: ${TARGET} ($(du -h "${TARGET}" | cut -f1))"

			if push_offsite; then
				date +%s >"$STAMP_FILE"
			fi
		else
			rm -f "${TARGET}.partial"
			log "HATA: yedek bozuk çıktı (gzip doğrulaması geçmedi), atıldı"
		fi
	else
		rm -f "${TARGET}.partial"
		log "HATA: veritabanına ulaşılamadı, yedek alınamadı"
	fi

	# Eski **yerel** yedekleri sil. Uzak kopyaya dokunulmaz: sipariş kayıtları
	# sekiz yıl saklanmak zorunda (Buchungsbelege) ve bu yükümlülük uzak
	# arşivle karşılanır; buradaki kopyalar "dün çalışıyordu" noktasına dönmek
	# içindir.
	find /backups -name 'doner-*.sql.gz' -mtime "+${KEEP_DAYS}" -delete 2>/dev/null || true

	warn_if_stale
	sleep "$INTERVAL"
done
