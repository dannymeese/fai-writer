import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { stripe } from "@/lib/stripe";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function POST(request: Request) {
  if (!stripe) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const session = await auth();
  const body = await request.json().catch(() => null);
  const plan = body?.plan === "monthly" ? "monthly" : "annual";

  const priceId = plan === "monthly" ? process.env.STRIPE_PRICE_MONTHLY : process.env.STRIPE_PRICE_ANNUAL;
  if (!priceId) {
    return NextResponse.json({ error: "Stripe price IDs are missing." }, { status: 500 });
  }

  const emailFromRequest: string | undefined = body?.email;
  const customerEmail = session?.user?.email ?? emailFromRequest;

  const annualTrialDays = Number(process.env.STRIPE_ANNUAL_TRIAL_DAYS ?? "5");
  const trialDays = plan === "annual" ? Math.max(0, annualTrialDays) : 0;

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      allow_promotion_codes: true,
      billing_address_collection: "required",
      customer_email: customerEmail,
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      subscription_data: {
        trial_period_days: trialDays > 0 ? trialDays : undefined,
        metadata: {
          plan,
          userId: session?.user?.id ?? "guest"
        }
      },
      metadata: {
        plan,
        userId: session?.user?.id ?? ""
      },
      success_url: `${APP_URL}/?checkout=success`,
      cancel_url: `${APP_URL}/membership?checkout=cancelled`
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    console.error("Stripe checkout error", error);
    return NextResponse.json({ error: "Unable to start Stripe checkout." }, { status: 500 });
  }
}

