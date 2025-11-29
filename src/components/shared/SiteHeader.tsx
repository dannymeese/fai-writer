"use client";

import Image from "next/image";
import Link from "next/link";

const LOGO_SRC = "https://forgetaboutit.ai/wp-content/uploads/2025/06/FAIwordmark-1.png";

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-brand-stroke/60 bg-brand-background/95 px-4 py-4 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
        <Link href="https://forgetaboutit.ai" className="flex items-center gap-2 text-brand-text" target="_blank" rel="noreferrer">
          <Image
            src={LOGO_SRC}
            alt="Forgetaboutit"
            width={180}
            height={40}
            className="h-8 w-auto"
            priority
          />
        </Link>
        <Link
          href="https://forgetaboutit.ai/#contact"
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-brand-stroke/80 px-5 py-2 text-sm font-semibold text-brand-text transition hover:border-brand-blue hover:text-brand-blue"
        >
          Book Call
        </Link>
      </div>
    </header>
  );
}

