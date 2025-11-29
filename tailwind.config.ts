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
          background: "#050505",
          ink: "#080810",
          panel: "#11111C",
          stroke: "#1E1E2A",
          text: "#F8F7F2",
          muted: "#B6B9C9",
          blue: "#5C64FF",
          blueHover: "#4A51E6",
          lavender: "#C7C5FF",
          bone: "#EDE9DE"
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

