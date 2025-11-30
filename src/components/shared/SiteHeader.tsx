"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { SignOutButton } from "./SignOutButton";

export default function SiteHeader() {
  const { data: session, status } = useSession();
  const isAuthenticated = status === "authenticated" && Boolean(session?.user);

  return (
    <header className="sticky top-0 z-40 border-b border-brand-stroke/60 bg-brand-background/95 px-4 py-4 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4">
        <div className="font-display text-3xl leading-tight sm:text-[36px]">
          <span style={{ color: "#0000ff" }}>Forgetaboutit </span>
          <span style={{ color: "#ffffff" }}>Writer</span>
        </div>
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <>
              <span className="text-sm font-semibold text-white">
                {session?.user?.name ? `Hi, ${session.user.name}` : "Account"}
              </span>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/sign-in" className="text-sm font-semibold text-white transition hover:text-brand-blue">
                Sign In
              </Link>
              <Link
                href="/register"
                className="rounded-full bg-brand-blue px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue/80"
              >
                Register
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

