"use client";

import Link from "next/link";

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-brand-stroke/60 bg-brand-background/95 px-4 py-4 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4">
        <div className="font-display text-[36px] leading-tight">
          <span style={{ color: "#ffffff" }}>Forgetaboutit</span>
          <span style={{ color: "#0000ff" }}>.ai </span>
          <span style={{ color: "#ffffff" }}>Writer Pro</span>
        </div>
        <div className="flex gap-3">
          <Link href="/register" className="rounded-full border border-brand-stroke/80 px-5 py-2 text-sm font-semibold text-brand-text transition hover:border-brand-blue hover:text-brand-blue">
            Register
          </Link>
          <Link href="/sign-in" className="rounded-full border border-brand-stroke/80 px-5 py-2 text-sm font-semibold text-brand-text transition hover:border-brand-blue hover:text-brand-blue">
            Sign In
          </Link>
        </div>
      </div>
    </header>
  );
}

