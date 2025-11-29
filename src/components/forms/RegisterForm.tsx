"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export default function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const formData = new FormData(event.currentTarget);
    const payload = {
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password")
    };
    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.message ?? "Please double check the details.");
      } else {
        router.push("/sign-in?registered=1");
      }
    } catch (err) {
      console.error(err);
      setError("Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm text-brand-muted">Full name</label>
        <input
          name="name"
          required
          className="mt-1 w-full rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 focus:border-brand-blue focus:outline-none"
        />
      </div>
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
        <p className="text-xs text-brand-muted">Use at least 8 characters.</p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className={cn("w-full rounded-full bg-brand-blue px-4 py-2 font-semibold text-white transition hover:bg-brand-blueHover", {
          "opacity-70": pending
        })}
      >
        {pending ? "Creating..." : "Create account"}
      </button>
      <p className="text-center text-sm text-brand-muted">
        Already onboard?{" "}
        <button
          type="button"
          onClick={() => router.push("/sign-in")}
          className="text-brand-blue underline"
        >
          Sign in
        </button>
      </p>
    </form>
  );
}

