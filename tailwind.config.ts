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
        vibe: {
          blue: "#1D4ED8",
          charcoal: "#0B1324",
          sand: "#F4F1EA",
          slate: "#5F6B7A"
        },
        sand: "#F4F1EA",
        charcoal: "#0B1324",
        slate: "#5F6B7A",
        brandblue: "#1D4ED8"
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "ui-sans-serif", "system-ui"],
        display: ["var(--font-dm-sans)", "DM Sans", "ui-sans-serif", "system-ui"]
      }
    }
  },
  plugins: []
};

export default config;

