import type { Metadata } from "next";
import { Manrope, Fira_Code } from "next/font/google";
import "./globals.css";
import Providers from "@/components/shared/Providers";
import SiteHeader from "@/components/shared/SiteHeader";
import { auth } from "@/auth";

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="en" className={`${manrope.variable} ${firaCode.variable}`}>
      <body className="min-h-screen bg-brand-background font-sans text-brand-text antialiased">
        <Providers session={session}>
          <div className="flex min-h-screen flex-col bg-brand-background text-brand-text">
            <SiteHeader />
            <main className="flex-1">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}

