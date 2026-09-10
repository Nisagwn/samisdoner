"use client";

import { useEffect } from "react";
import { EdgeScreen } from "@/components/EdgeScreen";
import { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * Rota hatası sınırı.
 *
 * Bu dosya olmadan bir sunucu bileşeninin fırlattığı hata Next'in çıplak
 * varsayılan ekranını gösteriyordu: beyaz zemin, İngilizce metin, çıkış yolu
 * yok. Sipariş vermeye gelen müşteri için bu, sitenin tamamen çöktüğü anlamına
 * geliyordu.
 *
 * `reset()` yalnızca bu rota parçasını yeniden dener; sepet kök düzende
 * yaşadığı için tazelemeden kurtulur ve müşteri hiçbir şey kaybetmez.
 *
 * `error.digest` üretimde sunucu günlüğündeki kaydın kimliğidir; ekranda
 * gösterilmez (müşteriye bir şey anlatmaz) ama konsola yazılır ki destek
 * çağrısında kaydı bulmak mümkün olsun.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLanguage();

  useEffect(() => {
    console.error("[route error]", error.digest ?? "", error);
  }, [error]);

  return (
    <EdgeScreen
      tag={t.errors.errorTag}
      title={t.errors.errorTitle}
      text={t.errors.errorText}
      action={{ label: t.errors.retryBtn, onClick: reset }}
    />
  );
}
