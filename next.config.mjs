/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Docker imajı için tek başına çalışabilen çıktı.
   *
   * `standalone`, `.next/standalone` altına yalnızca gerçekten kullanılan
   * modülleri kopyalayan küçük bir sunucu üretir. Kazanç somut: imaja 600 MB'lık
   * `node_modules` yerine ~150 MB'lık bir çıktı girer, kap saniyeler içinde
   * ayağa kalkar. Vercel'de bu ayar görmezden gelinir, zararı yok.
   */
  output: "standalone",

  /**
   * Geliştirme ve derleme ayrı dizinlere yazar.
   *
   * `next dev --turbo` ile `next build` (webpack) varsayılanda aynı `.next`
   * dizinini paylaşır. Dev sunucusu açıkken derleme yapıldığında turbopack'in
   * bıraktığı parçalar webpack çıktısına karışır ve derleme şu hatayla düşer:
   *
   *   Cannot find module '../chunks/ssr/[turbopack]_runtime.js'
   *
   * Hata paket yöneticisinden (bun/npm) bağımsızdır; iki derleyicinin aynı
   * dizine yazmasından kaynaklanır. Ayırmak hem çakışmayı bitirir hem de her
   * ikisinin artımlı derleme önbelleğini korur — dizini silmek gerekmez.
   */
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",

  images: {
    formats: ['image/webp'],
  },

  /**
   * Bu paketler sunucu tarafında **paketlenmez**, `require` ile yüklenir.
   *
   * İkisinin de derlemeye sığmayan yerel parçaları var: Prisma'nın sorgu motoru
   * ikili bir dosya, ioredis ise Node'un net/tls modüllerine dayanır. Paketleme
   * denemesi derlemede "module not found" ya da çalışma anında bozuk motor yolu
   * olarak geri döner.
   */
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "prisma", "ioredis"],
  },
};

export default nextConfig;
