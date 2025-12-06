"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function SignInForm() {
  const params = useSearchParams();
  const registered = params?.get("registered");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const formData = new FormData(event.currentTarget);
    const email = formData.get("email")?.toString() ?? "";
    const password = formData.get("password")?.toString() ?? "";
    const result = await signIn("credentials", {
      redirect: false,
      email,
      password,
      callbackUrl: "/"
    });
    if (result?.error) {
      setError("Unable to sign in with those credentials.");
    } else if (result?.ok !== false) {
      window.location.href = "/";
    }
    setPending(false);
  }

  return (
    <div className="space-y-6">
      {registered && <p className="rounded-lg border border-brand-stroke/60 bg-brand-panel/80 px-4 py-2 text-sm text-brand-text">Account created. Please sign in.</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm text-brand-muted">Email</label>
          <input
            type="email"
            name="email"
            required
            className="mt-1 w-full rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 focus:border-brand-blue focus:outline-none"
          />
        </div>
        <div>
          <label className="text-sm text-brand-muted">Password</label>
          <input
            type="password"
            name="password"
            required
            className="mt-1 w-full rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 focus:border-brand-blue focus:outline-none"
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className={cn("w-full rounded-full bg-brand-blue px-4 py-2 font-semibold text-white transition hover:bg-brand-blueHover", {
            "opacity-70": pending
          })}
        >
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <button
        className="flex w-full items-center justify-center rounded-full border border-brand-stroke/70 px-4 py-2 text-sm font-semibold text-brand-text transition hover:border-brand-blue hover:text-brand-blue"
        onClick={() => signIn("google", { callbackUrl: "/" })}
        type="button"
      >
        Continue with Google
      </button>
      <p className="text-center text-sm text-brand-muted">
        No account?{" "}
        <Link className="text-brand-blue underline" href="/membership">
          Register
        </Link>
      </p>
    </div>
  );
}

