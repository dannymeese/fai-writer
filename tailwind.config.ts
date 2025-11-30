import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          background: "#000000",
          ink: "#111111",
          panel: "#141414",
          stroke: "#2a2a2a",
          text: "#ffffff",
          muted: "#b3b3b3",
          blue: "#0000ff",
          blueHover: "#0000ff",
          lavender: "#d9d9d9",
          bone: "#f5f5f5"
        }
      },
      fontFamily: {
        sans: ["var(--font-manrope)", "Manrope", "ui-sans-serif", "system-ui"],
        display: ["var(--font-manrope)", "Manrope", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-fira-code)", "Fira Code", "monospace"]
      }
    }
  },
  plugins: []
};

export default config;

