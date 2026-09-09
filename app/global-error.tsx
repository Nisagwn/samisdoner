"use client";

/**
 * Son çare hata ekranı.
 *
 * Kök düzenin **kendisi** patladığında devreye girer ve `<html>`/`<body>`
 * etiketlerini kendisi yazmak zorundadır — düzen çizilmediği için ne
 * `LanguageProvider` ne de `globals.css`'in yüklendiği ağaç vardır. Bu yüzden
 * burada ne çeviri bağlamı ne Tailwind sınıfı kullanılabilir: renkler
 * doğrudan sitenin token değerleriyle satır içinde yazılır ve metin, sitenin
 * birincil dili olan Almanca ile sabittir.
 *
 * Pratikte neredeyse hiç görülmez; görüldüğünde tek işi müşteriyi çıkmaz
 * sokakta bırakmamaktır: bir yeniden deneme düğmesi ve telefon numarası.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="de">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#070604",
          color: "#FFF6E8",
          fontFamily: "system-ui, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 460 }}>
          <p
            style={{
              margin: "0 0 12px",
              color: "#FF3D12",
              letterSpacing: "0.15em",
              fontSize: 12,
            }}
          >
            FEHLER
          </p>
          <h1 style={{ margin: "0 0 16px", fontSize: 28, lineHeight: 1.1 }}>
            Die Seite konnte nicht geladen werden
          </h1>
          <p style={{ margin: "0 0 28px", color: "#B4A99A", lineHeight: 1.6, fontSize: 14 }}>
            Bitte versuchen Sie es erneut. Wenn es eilig ist, nehmen wir Ihre Bestellung
            auch telefonisch auf.
          </p>
          <button
            onClick={reset}
            style={{
              minHeight: 44,
              padding: "0 20px",
              border: "1px solid #FFC247",
              background: "rgba(255,194,71,0.1)",
              color: "#FFC247",
              fontSize: 12,
              letterSpacing: "0.15em",
              cursor: "pointer",
            }}
          >
            ERNEUT VERSUCHEN
          </button>
          <p style={{ marginTop: 28, fontSize: 13, color: "#B4A99A" }}>
            <a href="tel:+4994243909330" style={{ color: "#FFC247" }}>
              +49 (0) 9424 3909330
            </a>
          </p>
        </div>
      </body>
    </html>
  );
}
