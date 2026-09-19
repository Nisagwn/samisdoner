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

# Boru hattında SOLDAKİ komutun hatası da sayılsın.
#
# Bu satır olmadan `pg_dump | gzip` yalnızca gzip'in çıkış kodunu döndürürdü;
# pg_dump yarıda ölse bile gzip eline geçeni sorunsuz sıkıştırıp 0 ile çıkar.
# Sonuç sessiz bir felaketti: yarım döküm "başarılı" sayılır, `gzip -t`
# sınavını da geçer (gzip akışı gerçekten sağlamdır), kalıcı adını alır, makine
# dışına kopyalanır ve "son başarılı yedek" damgası tazelenir — yani bayatlık
# alarmı da susar. Arıza günü geri yüklenen şey yarım bir veritabanı olurdu.
#
# `postgres:16-alpine` içindeki BusyBox ash bunu destekler (denendi).
set -o pipefail

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
	if ! rclone copy /backups "$BACKUP_REMOTE" \
		--include 'doner-*.sql.gz' \
		--retries 3 --low-level-retries 5 --timeout 5m \
		--stats-one-line --stats 0; then
		log "HATA: uzak kopya başarısız → $BACKUP_REMOTE"
		return 1
	fi
	log "uzak kopya tamam → $BACKUP_REMOTE"

	# Panelden yüklenen ürün görselleri. Veritabanı dökümüne girmezler; her gün
	# tamamını yeniden arşivlemek sekiz yıllık uzak arşivi boşuna şişirirdi.
	# Adları içerik özeti olduğu için bir dosya asla değişmez: rclone yalnızca
	# yeni yüklenenleri gönderir, bu adım çoğu gün hiçbir şey aktarmaz.
	if [ -d /uploads ]; then
		if ! rclone copy /uploads "$BACKUP_REMOTE/gorseller" \
			--include '*.webp' \
			--retries 3 --low-level-retries 5 --timeout 5m \
			--stats-one-line --stats 0; then
			log "HATA: görsellerin uzak kopyası başarısız → $BACKUP_REMOTE/gorseller"
			return 1
		fi
		log "görseller tamam → $BACKUP_REMOTE/gorseller"
	fi
	return 0
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

		# Bütünlük sınavı iki aşamalı ve ikisi FARKLI şeyi sınar:
		#   1. `gzip -t` — sıkıştırma akışı sonuna kadar okunabiliyor mu.
		#   2. Dökümün son satırları — pg_dump işini bitirebilmiş mi.
		# Birincisi tek başına yetmez: yarıda kesilmiş bir döküm de kusursuz
		# bir gzip dosyasıdır, çünkü bozulan gzip değil kaynaktır. pg_dump
		# ancak başarıyla bitirdiğinde "dump complete" satırını yazar.
		#
		# `grep -q` bilinçli olarak kullanılmıyor: ilk eşleşmede çıkıp
		# `tail`'e SIGPIPE gönderir ve pipefail açıkken bu, sağlam bir yedeği
		# başarısız saydırırdı.
		dump_tail="$(gunzip -c "${TARGET}.partial" | tail -20)"
		case "$dump_tail" in
		*"PostgreSQL database dump complete"*) dump_complete=1 ;;
		*) dump_complete=0 ;;
		esac

		if [ "$dump_complete" = 1 ] && gzip -t "${TARGET}.partial" 2>/dev/null; then
			mv "${TARGET}.partial" "${TARGET}"
			log "tamam: ${TARGET} ($(du -h "${TARGET}" | cut -f1))"

			if push_offsite; then
				date +%s >"$STAMP_FILE"
			fi
		else
			rm -f "${TARGET}.partial"
			log "HATA: yedek eksik ya da bozuk çıktı (bütünlük sınavı geçmedi), atıldı"
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
