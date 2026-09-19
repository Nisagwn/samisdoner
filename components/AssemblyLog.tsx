"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { playLayerThud, playDrip, unlockAudio } from "@/lib/kitchenAudio";
import { useLanguage } from "@/lib/i18n/LanguageContext";

type BaseStepConfig = {
  image: string;
  from: "left" | "right" | "top";
  top: string;
  width: number;
  rotate: number;
  glow: string;
  snap: number;
  liquid?: boolean;
};

const BASE_CONFIGS: BaseStepConfig[] = [
  { image: "/assets/ing-bun-base.webp", from: "left", top: "43%", width: 310, rotate: -6, snap: 0, glow: "rgba(255,168,74,0.46)" },
  { image: "/assets/ing-ketchup.webp", from: "right", top: "61%", width: 140, rotate: 6, snap: 0, glow: "rgba(255,54,28,0.52)", liquid: true },
  { image: "/assets/ing-meat.webp", from: "left", top: "33%", width: 310, rotate: -2, snap: 25, glow: "rgba(255,122,0,0.54)" },
  { image: "/assets/ing-sauce.webp", from: "right", top: "39%", width: 150, rotate: 4, snap: 55, glow: "rgba(198,232,180,0.34)", liquid: true },
  { image: "/assets/ing-lettuce.webp", from: "left", top: "31%", width: 160, rotate: -6, snap: 85, glow: "rgba(46,204,113,0.42)" },
  { image: "/assets/ing-onion.webp", from: "right", top: "22%", width: 150, rotate: 5, snap: 115, glow: "rgba(190,88,196,0.44)" },
  { image: "/assets/ing-tomato.webp", from: "left", top: "11%", width: 170, rotate: -3, snap: 145, glow: "rgba(255,64,44,0.48)" },
  { image: "/assets/ing-bun-lid.webp", from: "right", top: "-16%", width: 290, rotate: 3, snap: 175, glow: "rgba(255,186,96,0.46)" },
];

function seeded(n: number) {
  let t = n + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const EMBERS = Array.from({ length: 18 }, (_, i) => {
  const r = (k: number) => seeded(i * 7 + k);
  return {
    left: 4 + r(1) * 92,
    bottom: -10 - r(2) * 25,
    size: 1.5 + r(3) * 2.6,
    duration: 9 + r(4) * 11,
    delay: -r(5) * 18,
    drift: (r(6) - 0.5) * 160,
    rise: 55 + r(7) * 45,
    peak: 0.45 + r(8) * 0.5,
  };
});

export default function AssemblyLog() {
  const { t } = useLanguage();
  const section = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const stackGroup = useRef<HTMLDivElement>(null);
  const tiltGroup = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const glowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const bigTextRefs = useRef<(HTMLDivElement | null)[]>([]);

  const smokeBg = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const finalImg = useRef<HTMLDivElement>(null);
  const finalCaption = useRef<HTMLDivElement>(null);
  const headerBlock = useRef<HTMLDivElement>(null);

  const [openTip, setOpenTip] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const soundOnRef = useRef(false);
  const lastSounded = useRef(-1);

  const steps = t.assembly.steps.map((st, i) => ({
    ...BASE_CONFIGS[i],
    ...st,
  }));

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const ctx = gsap.context(() => {
      /*
       * Başlangıç konumları bilerek yumuşak: malzemeler eskiden 260 piksel
       * uzaktan, dörtte bir ölçekten ve dört kat eğik geliyordu — her adım
       * ekrana çarpma gibi duruyordu. Daha kısa yol, daha küçük eğim ve
       * ölçekte daha az fark, aynı katmanlı sahneyi sert değil akıcı yapar.
       */
      itemRefs.current.forEach((el, i) => {
        if (!el) return;
        const step = BASE_CONFIGS[i];
        const xStart = step.from === "left" ? -180 : step.from === "right" ? 180 : 0;
        gsap.set(el, {
          opacity: 0,
          x: xStart,
          y: step.from === "top" ? -120 : 0,
          rotate: step.rotate * 2.2,
          scale: 0.88,
          z: (i - (BASE_CONFIGS.length - 1) / 2) * 16,
        });
        const label = labelRefs.current[i];
        if (label) gsap.set(label, { opacity: 0, x: step.from === "left" ? -12 : 12 });
      });

      gsap.set(glowRefs.current.filter(Boolean), { opacity: 0 });
      gsap.set(bigTextRefs.current.filter(Boolean), { opacity: 0, x: 40 });
      gsap.set(smokeBg.current, { opacity: 0 });
      gsap.set(flash.current, { opacity: 0 });
      gsap.set(finalImg.current, { opacity: 0, scale: 0.84, filter: "blur(24px)" });
      gsap.set(finalCaption.current, { opacity: 0, y: 16 });

      // Adım başına daha çok kaydırma yolu: aynı hareket daha uzun mesafeye
      // yayılınca tekerleğin her tıkı sahneyi zıplatmıyor.
      const STEP_UNIT = 440;
      const FINALE_UNIT = 1040;
      const TOTAL = BASE_CONFIGS.length * STEP_UNIT + FINALE_UNIT;

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section.current,
          start: "top top",
          end: `+=${TOTAL}`,
          // Daha yüksek scrub: kaydırma durduğunda animasyon anında değil
          // süzülerek yerine oturur.
          scrub: 1.1,
          pin: true,
          anticipatePin: 1,
          onUpdate: (self) => {
            if (!soundOnRef.current) return;
            const idx = Math.floor(self.progress * (self.animation?.duration() ?? 0));
            if (idx > lastSounded.current && idx < BASE_CONFIGS.length) {
              lastSounded.current = idx;
              if (BASE_CONFIGS[idx].liquid) playDrip();
              else playLayerThud(idx / (BASE_CONFIGS.length - 1));
            } else if (idx < lastSounded.current) {
              lastSounded.current = idx;
            }
          },
        },
      });

      /*
       * Adımlar birim başına 1 saniyeydi, yani her katman bir öncekinin tam
       * bittiği yerde başlıyordu; aradaki duraklar sahneyi kesik kesik
       * gösteriyordu. Süreler artık birimden uzun (1.35) ve konumlar hâlâ tam
       * birimde, böylece katmanlar birbirinin üstüne binerek geçiyor.
       */
      BASE_CONFIGS.forEach((step, i) => {
        tl.to(itemRefs.current[i], { opacity: 1, x: 0, y: 0, rotate: step.rotate, scale: 1, duration: 1.35, ease: "power2.out" }, i)
          .to(labelRefs.current[i], { opacity: 1, x: 0, duration: 0.85, ease: "sine.out" }, i + 0.25)
          .to(glowRefs.current[i], { opacity: 1, duration: 1.1, ease: "sine.inOut" }, i)
          .to(bigTextRefs.current[i], { opacity: 1, x: 0, duration: 1.1, ease: "sine.out" }, i);
        if (i > 0) {
          tl.to(glowRefs.current[i - 1], { opacity: 0, duration: 1.1, ease: "sine.inOut" }, i)
            .to(bigTextRefs.current[i - 1], { opacity: 0, x: -40, duration: 1.1, ease: "sine.in" }, i);
        }
      });

      tl.to({}, { duration: 0.5 });
      tl.addLabel("assemble");

      /*
       * Final: katmanlar oturur, sahne dumana karışır, kesitli döner belirir.
       *
       * Bu bölüm eskiden bir kesme (cut) gibiydi — yığın 0.34 saniyede yok
       * olup tam beyaz bir flaş patlıyordu. Şimdi her hareket bir öncekinin
       * üstüne biner ve hiçbiri `in` ile hızlanıp durmaz: `sine` eğrileri
       * başta ve sonda yumuşak.
       */
      BASE_CONFIGS.forEach((step, i) => {
        tl.to(
          itemRefs.current[i],
          {
            y: step.snap,
            rotate: step.rotate * 0.2,
            duration: 1.05,
            ease: reduced ? "sine.out" : "power1.inOut",
          },
          "assemble"
        );
      });
      tl.to(labelRefs.current.filter(Boolean), { opacity: 0, duration: 0.5, ease: "sine.in" }, "assemble");
      tl.to(bigTextRefs.current[BASE_CONFIGS.length - 1], { opacity: 0, duration: 0.7, ease: "sine.in" }, "assemble");

      tl.to(smokeBg.current, { opacity: 0.65, duration: 0.9, ease: "sine.inOut" }, "assemble+=0.3");
      tl.to(
        stackGroup.current,
        { opacity: 0, scale: 1.04, filter: "blur(18px)", duration: 0.9, ease: "sine.inOut" },
        "assemble+=0.45"
      );
      tl.to(glowRefs.current.filter(Boolean), { opacity: 0, duration: 0.9, ease: "sine.inOut" }, "assemble+=0.45");

      // Flaş artık patlamıyor, ısınıp sönüyor: tepe değeri tamdan 0.45'e indi
      // ve iniş çıkış süreleri üç katına çıktı.
      tl.to(flash.current, { opacity: 0.45, duration: 0.45, ease: "sine.in" }, "assemble+=0.72")
        .to(flash.current, { opacity: 0, duration: 1.2, ease: "sine.out" }, "assemble+=1.05");

      tl.to(
        finalImg.current,
        { opacity: 1, scale: 1, filter: "blur(0px)", duration: 1.4, ease: "power2.out" },
        "assemble+=0.8"
      );
      tl.to(smokeBg.current, { opacity: 0.28, duration: 1.3, ease: "sine.inOut" }, "assemble+=0.8");
      tl.to(finalCaption.current, { opacity: 1, y: 0, duration: 0.9, ease: "sine.out" }, "assemble+=1.7");
      tl.to(headerBlock.current, { opacity: 0.15, duration: 1.1, ease: "sine.inOut" }, "assemble+=1.6");
    }, section);

    let tiltX: ((v: number) => void) | null = null;
    let tiltY: ((v: number) => void) | null = null;
    if (!reduced && tiltGroup.current) {
      tiltX = gsap.quickTo(tiltGroup.current, "rotationX", { duration: 1, ease: "power2.out" });
      tiltY = gsap.quickTo(tiltGroup.current, "rotationY", { duration: 1, ease: "power2.out" });
    }
    const el = section.current;
    const onMove = (e: PointerEvent) => {
      if (!el || !tiltX || !tiltY) return;
      const r = el.getBoundingClientRect();
      // Eğim genliği düşürüldü (14/10 → 9/6): amaç derinlik hissi, sahneyi
      // imleçle savurmak değil.
      tiltY(((e.clientX - r.left) / r.width - 0.5) * 9);
      tiltX(-((e.clientY - r.top) / r.height - 0.5) * 6);
    };
    const onLeave = () => {
      tiltX?.(0);
      tiltY?.(0);
    };
    el?.addEventListener("pointermove", onMove);
    el?.addEventListener("pointerleave", onLeave);

    return () => {
      el?.removeEventListener("pointermove", onMove);
      el?.removeEventListener("pointerleave", onLeave);
      ctx.revert();
    };
  }, []);

  return (
    <section ref={section} id="assembly" className="relative min-h-[100svh] bg-char overflow-hidden">
      {/* Üstteki 1 piksellik gökkuşağı çizgisi kaldırıldı: bölümün başında
          jiletle çekilmiş gibi duruyordu. Yerine aynı renklerin dağılmış
          hâli — ısı halesi — geldi, kenar yok. */}
      <div
        className="absolute inset-x-0 top-0 z-[3] h-24 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,61,18,0.14) 0%, rgba(255,194,71,0.07) 42%, transparent 100%)",
        }}
      />
      {steps.map((step, i) => (
        <div
          key={`glow-${step.code}`}
          ref={(el) => {
            glowRefs.current[i] = el;
          }}
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            background: [
              `radial-gradient(circle at 50% 52%, ${step.glow} 0%, transparent 70%)`,
              `radial-gradient(ellipse 130% 65% at 50% 110%, ${step.glow} 0%, transparent 65%)`,
            ].join(", "),
          }}
        />
      ))}

      <div
        className="smoke-drift absolute inset-0 z-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 50% 80%, rgba(255,140,60,0.14) 0%, transparent 65%)" }}
      />

      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden>
        {EMBERS.map((e, i) => (
          <span
            key={i}
            className="ember absolute rounded-full bg-amber"
            style={
              {
                left: `${e.left}%`,
                bottom: `${e.bottom}%`,
                width: e.size,
                height: e.size,
                animationDuration: `${e.duration}s`,
                animationDelay: `${e.delay}s`,
                boxShadow: "0 0 6px rgba(255,140,40,0.9)",
                "--drift": `${e.drift}px`,
                "--rise": `${e.rise}vh`,
                "--peak": e.peak,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none overflow-hidden" aria-hidden>
        {steps.map((step, i) => (
          <div
            key={`big-${step.code}`}
            ref={(el) => {
              bigTextRefs.current[i] = el;
            }}
            className="absolute whitespace-nowrap font-display font-extrabold text-bone/[0.07] text-[7vw] leading-none tracking-tight"
          >
            {step.bigText}
          </div>
        ))}
      </div>

      {/* Teknik ızgara: tuvalin dört kenarına kadar keskin uzanıyordu.
          Opaklığı düşürüldü ve merkeze doğru eriyen bir maskeye alındı. */}
      <div className="absolute inset-0 z-[1] opacity-[0.035] pointer-events-none [background-image:linear-gradient(#FFF6E8_1px,transparent_1px),linear-gradient(90deg,#FFF6E8_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_72%_62%_at_50%_50%,#000_20%,transparent_100%)] [-webkit-mask-image:radial-gradient(ellipse_72%_62%_at_50%_50%,#000_20%,transparent_100%)]" />

      <div ref={smokeBg} className="absolute inset-0 z-[2]">
        <Image src="/assets/kitchen-atmosphere.webp" alt="" fill className="object-cover" sizes="100vw" />
        <div className="absolute inset-0 bg-void/55" />
      </div>

      {/* Bölüm sınırları.
          Sahnenin zemini (`bg-char`) komşu bölümlerin zemininden (`bg-void`)
          bir ton açık; arada dümdüz bir kesik kalıyordu. Bu iki katman üstte
          ve altta zemini komşunun rengine eritir, çizgi görünmez olur. */}
      <div
        className="absolute inset-x-0 top-0 z-[4] h-40 pointer-events-none"
        style={{ background: "linear-gradient(180deg, #070604 0%, rgba(7,6,4,0.55) 45%, transparent 100%)" }}
      />
      <div
        className="absolute inset-x-0 bottom-0 z-[4] h-48 pointer-events-none"
        style={{ background: "linear-gradient(0deg, #070604 0%, rgba(7,6,4,0.6) 42%, transparent 100%)" }}
      />

      {/* Flaş katmanı: renk geçişleri daha geniş yayıldı, göbek beyaz değil
          sıcak turuncu — patlama değil köz parlaması. */}
      <div
        ref={flash}
        className="absolute inset-0 z-30 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 50% 55%, rgba(255,186,110,0.72) 0%, rgba(255,120,30,0.34) 38%, rgba(255,77,0,0.12) 62%, transparent 82%)",
        }}
      />

      <div className="relative z-10 max-w-[1400px] mx-auto h-[100svh] px-6 md:px-10 flex flex-col">
        <div ref={headerBlock} className="pt-28 md:pt-32 flex items-start justify-between gap-6">
          <div>
            <p className="tag text-flame mb-3">{t.assembly.tag}</p>
            <h2 className="section-title font-display font-extrabold text-bone">
              {t.assembly.title.split(" ")[0]}
              <br />
              {t.assembly.title.split(" ")[1] || t.assembly.title}
            </h2>
          </div>
          <div className="flex flex-col items-end gap-3">
            <p className="tag text-smoke max-w-[220px] text-right hidden md:block">
              {t.assembly.subText}
            </p>
            <button
              onClick={() => {
                void unlockAudio();
                setSoundOn((v) => !v);
              }}
              aria-pressed={soundOn}
              className={`focus-ring tag inline-flex min-h-[44px] items-center border px-3 transition-colors ${
                soundOn ? "border-amber text-amber bg-amber/10" : "border-line text-smoke hover:border-smoke"
              }`}
            >
              {soundOn ? t.assembly.soundOn : t.assembly.soundOff}
            </button>
          </div>
        </div>

        {/* yığılan malzemeler */}
        <div ref={stage} className="relative flex-1 mt-6 md:mt-4" style={{ perspective: 1200 }}>
          <div ref={stackGroup} className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
            <div ref={tiltGroup} className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
              {steps.map((step, i) => (
                <div
                  key={step.code}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  className="absolute left-1/2 -translate-x-1/2"
                  style={{ top: step.top, width: step.width, transformStyle: "preserve-3d" }}
                >
                  <div className="relative" style={{ aspectRatio: "1/1" }}>
                    {/* Malzemeler makasla kesilmiş gibi durmasın diye her
                        katmanın altına yumuşak bir gölge düşüyor; kenar
                        zemine oturuyor, üstüne yapıştırılmış gibi durmuyor. */}
                    <Image
                      src={step.image}
                      alt={step.name}
                      fill
                      sizes="340px"
                      className="object-contain drop-shadow-[0_16px_34px_rgba(0,0,0,0.5)]"
                    />
                  </div>

                  <div
                    ref={(el) => {
                      labelRefs.current[i] = el;
                    }}
                    className={`absolute z-20 inset-x-0 bottom-full mb-1 flex justify-center md:inset-x-auto md:bottom-auto md:mb-0 md:top-1/2 md:-translate-y-1/2 md:block ${
                      step.from === "left" ? "md:left-full md:ml-4" : "md:right-full md:mr-4"
                    }`}
                  >
                    <button
                      onClick={() => setOpenTip((v) => (v === step.code ? null : step.code))}
                      aria-expanded={openTip === step.code}
                      className={`focus-ring tag whitespace-nowrap flex min-h-[44px] items-center gap-2 group bg-void/75 px-2 backdrop-blur-sm md:bg-transparent md:px-0 md:backdrop-blur-none ${
                        step.from === "left" ? "" : "md:flex-row-reverse"
                      }`}
                    >
                      <span className="hidden md:block w-6 h-px bg-amber transition-all duration-300 group-hover:w-10" />
                      <span className="text-amber">{step.code}</span>
                      <span className="text-smoke group-hover:text-bone transition-colors">{step.name}</span>
                      <span className="text-smoke/50 group-hover:text-amber transition-colors">
                        {openTip === step.code ? "−" : "+"}
                      </span>
                    </button>

                    {openTip === step.code && (
                      <div
                        className={`absolute top-full mt-2 w-[210px] md:w-[240px] left-1/2 -translate-x-1/2 md:translate-x-0 rounded-md border border-amber/30 bg-void/95 backdrop-blur-sm p-3 text-xs leading-relaxed text-smoke shadow-[0_24px_60px_rgba(0,0,0,0.55)] ${
                          step.from === "left" ? "md:left-0" : "md:left-auto md:right-0"
                        }`}
                      >
                        <p className="tag text-amber mb-1.5">
                          {step.code} — {t.assembly.detailsLabel}
                        </p>
                        {step.origin}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div ref={finalImg} className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-[85%] max-w-[640px] aspect-[948/624]">
              <div className="absolute -inset-16 bg-flame/25 blur-[90px] rounded-full" />
              <Image
                src="/assets/final-reveal-cross.webp"
                alt={t.assembly.revealTag}
                fill
                sizes="640px"
                className="object-contain drop-shadow-[0_30px_70px_rgba(0,0,0,0.6)]"
              />
            </div>
          </div>

          <div ref={finalCaption} className="absolute bottom-[8%] inset-x-0 text-center pointer-events-none">
            <p className="tag text-amber mb-2">{t.assembly.revealTag}</p>
            <p className="font-display font-extrabold text-[8vw] md:text-[2.6vw] text-bone">{t.assembly.revealTitle}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
