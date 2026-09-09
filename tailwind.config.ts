import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        void: "#070604",
        char: "#11100C",
        panel: "#191610",
        line: "#34291F",
        flame: {
          DEFAULT: "#FF3D12",
          soft: "#FF7A1A",
        },
        amber: "#FFC247",
        bone: "#FFF6E8",
        smoke: "#B4A99A",
        herb: "#7BD66F",
        sumac: "#E5548A",
        steel: "#62D5FF",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
        body: ["var(--font-body)"],
      },
      backgroundImage: {
        "grain": "url('/assets/noise.png')",
        "flame-gradient": "linear-gradient(135deg, #FF4D00 0%, #FF7A00 55%, #FFB347 100%)",
      },
      boxShadow: {
        "ember-card": "0 18px 70px -42px rgba(255,61,18,0.9)",
      },
      letterSpacing: {
        widest2: "0.35em",
      },
    },
  },
  plugins: [],
};
export default config;
