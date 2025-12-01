"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ArrowSmallRightIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";

type PlanId = "annual" | "monthly";

const plans: Array<{
  id: PlanId;
  title: string;
  headline: string;
  priceDetail: string;
  description: string;
  benefits: string[];
  highlight?: string;
}> = [
  {
    id: "annual",
    title: "Studio Annual",
    headline: "Save 50% when you prepay for the year",
    priceDetail: "$9 / mo • billed annually ($108/yr)",
    description: "Best for dedicated teams that want unlimited guardrail prompts, advanced brand/style storage, and white-glove support.",
    benefits: [
      "5-day free trial",
      "Unlimited brand + style slots",
      "Priority support & roadmap input",
      "Token tracking + enterprise guardrails"
    ],
    highlight: "Most popular"
  },
  {
    id: "monthly",
    title: "Monthly Flex",
    headline: "Cancel anytime",
    priceDetail: "$20 / mo • billed monthly",
    description: "Perfect for testing the studio or spinning up limited engagements without the annual commitment.",
    benefits: [
      "No free trial — start instantly",
      "All core writing tools",
      "Token tracking dashboard",
      "Upgrade to annual anytime (and unlock the trial)"
    ]
  }
];

export default function MembershipPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);
  const [email, setEmail] = useState(session?.user?.email ?? "");
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(planId: PlanId) {
    try {
      setLoadingPlan(planId);
      setError(null);
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId, email: email || undefined })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(typeof payload?.error === "string" ? payload.error : "Unable to start checkout right now.");
        setLoadingPlan(null);
        return;
      }
      const payload = await response.json();
      if (payload?.url) {
        router.push(payload.url);
      } else {
        setError("Stripe returned an unexpected response.");
        setLoadingPlan(null);
      }
    } catch (err) {
      console.error(err);
      setError("Checkout failed. Please try again.");
      setLoadingPlan(null);
    }
  }

  return (
    <main className="min-h-screen bg-brand-background px-4 py-16 text-brand-text">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-brand-muted">Membership</p>
          <h1 className="mt-3 text-4xl font-semibold text-white">Choose your studio plan</h1>
          <p className="mt-4 text-base text-brand-muted">
            Every tier includes a free trial. Annual members save 50% compared to paying month-to-month.
          </p>
          {!session?.user && (
            <p className="mt-2 text-sm text-brand-muted">
              Already joined?{" "}
              <Link href="/sign-in" className="text-brand-blue hover:underline">
                Sign in here
              </Link>
            </p>
          )}
        </div>
        {!session?.user && (
          <div className="mx-auto w-full max-w-md rounded-3xl border border-brand-stroke/60 bg-brand-panel/60 p-4">
            <label className="text-xs font-semibold uppercase text-brand-muted" htmlFor="checkout-email">
              Email for checkout
            </label>
            <input
              id="checkout-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="mt-2 w-full rounded-2xl border border-brand-stroke/60 bg-transparent px-3 py-2 text-sm text-white focus:border-brand-blue focus:outline-none"
            />
            <p className="mt-1 text-xs text-brand-muted">We’ll pass this to Stripe so you can finish signup.</p>
          </div>
        )}
        {error && (
          <div className="rounded-3xl border border-red-500/60 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>
        )}
        <div className="grid gap-6 md:grid-cols-2">
          {plans.map((plan) => (
            <article
              key={plan.id}
              className={cn(
                "flex h-full flex-col rounded-3xl border border-brand-stroke/60 bg-brand-panel/80 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.45)]",
                plan.highlight && "border-brand-blue/60"
              )}
            >
              <header className="mb-4">
                {plan.highlight && (
                  <span className="inline-flex items-center rounded-full border border-brand-blue/50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-blue">
                    {plan.highlight}
                  </span>
                )}
                <h2 className="mt-3 text-2xl font-semibold text-white">{plan.title}</h2>
                <p className="mt-1 text-sm text-brand-muted">{plan.headline}</p>
                <p className="mt-2 text-lg font-semibold text-white">{plan.priceDetail}</p>
              </header>
              <p className="text-sm text-brand-muted">{plan.description}</p>
              <ul className="mt-4 space-y-2 text-sm text-brand-text/80">
                {plan.benefits.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-2">
                    <span className="text-brand-blue">•</span>
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-brand-blue/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => startCheckout(plan.id)}
                disabled={loadingPlan === plan.id}
              >
                {loadingPlan === plan.id ? "Opening Stripe…" : "Start free trial"}
                <ArrowSmallRightIcon className="h-4 w-4" />
              </button>
            </article>
          ))}
        </div>
        <div className="text-center text-sm text-brand-muted">
          Need a custom enterprise tier?{" "}
          <Link href="mailto:hello@forgetaboutit.ai" className="text-brand-blue hover:underline">
            Contact us
          </Link>
          .
        </div>
      </div>
    </main>
  );
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

