import type { Metadata } from "next";
import { Manrope, Fira_Code } from "next/font/google";
import "./globals.css";
import Providers from "@/components/shared/Providers";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope"
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-fira-code"
});

export const metadata: Metadata = {
  title: "Forgetaboutit Writer",
  description: "AI copy studio crafted for premium brands"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${firaCode.variable}`}>
      <body className="min-h-screen bg-brand-background font-sans text-brand-text antialiased">
        <Providers>
          <div className="relative min-h-screen bg-brand-background text-brand-text">{children}</div>
        </Providers>
      </body>
    </html>
  );
}

