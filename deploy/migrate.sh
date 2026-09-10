#!/bin/sh
# Şemayı veritabanına uygular. Uygulama kabı başlamadan önce bir kez çalışır.
#
# İki yol var çünkü proje şu an göç dosyası tutmuyor (`prisma db push` ile
# geliştirildi):
#
#   prisma/migrations VARSA  → `migrate deploy`: yalnızca uygulanmamış göçleri
#                              çalıştırır, veriyi korur. Canlıda doğru olan yol.
#   YOKSA                    → `db push`: şemayı olduğu gibi dayatır.
#
# `db push` canlıda **tehlikelidir**: bir alanı yeniden adlandırdığınızda eski
# sütunu siler ve içindeki veriyi de götürür. Bu yüzden ilk canlı kurulumdan
# önce göç dosyaları oluşturulmalı:
#
#   bun run db:migrate --name init
#
# O an gelene kadar aşağıdaki dal, boş bir veritabanını kurabilmek için var.
set -eu

if [ -d /app/prisma/migrations ] && [ -n "$(ls -A /app/prisma/migrations 2>/dev/null)" ]; then
  echo "[migrate] göç dosyaları bulundu → prisma migrate deploy"
  bunx prisma migrate deploy
else
  echo "[migrate] göç dosyası yok → prisma db push (kalıcı kurulumda göç dosyası oluşturun)"
  bunx prisma db push --skip-generate
fi

# Tohumlama isteğe bağlı ve **yalnızca boş veritabanında** anlamlıdır:
# SEED_ON_START=true yalnızca ilk kurulumda verilir, sonra ortamdan kaldırılır.
if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[migrate] tohum verisi yazılıyor"
  # `bun run db:seed` yerine doğrudan bun: o betik `tsx` kullanıyor, tsx ise
  # esbuild'in indirilen ikilisine dayanıyor. Kapta bu ikili yok (kurulum
  # sırasında yaşam döngüsü betikleri güvenlik gereği çalıştırılmıyor) ve
  # "Cannot find module './cjs/index.cjs'" ile düşüyor. bun TypeScript'i
  # kendisi çalıştırır; ara katmana gerek yok.
  bun prisma/seed.ts
fi

echo "[migrate] tamam"
