import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { stripe } from "@/lib/stripe";

export async function POST(request: Request) {
  if (!stripe) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  try {
    const session = await auth();
    const body = await request.json();
    const { plan, customerEmail } = body;

    if (!plan || (plan !== "monthly" && plan !== "annual")) {
      return NextResponse.json({ error: "Invalid plan." }, { status: 400 });
    }

    const priceId = plan === "monthly" ? process.env.STRIPE_PRICE_MONTHLY : process.env.STRIPE_PRICE_ANNUAL;
    if (!priceId) {
      return NextResponse.json({ error: "Stripe price IDs are missing." }, { status: 500 });
    }

    const email = session?.user?.email ?? customerEmail;
    if (!email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    // Create or retrieve customer
    let customer;
    const existingCustomers = await stripe.customers.list({
      email: email,
      limit: 1
    });

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
    } else {
      customer = await stripe.customers.create({
        email: email,
        metadata: {
          userId: session?.user?.id ?? "guest"
        }
      });
    }

    const annualTrialDays = Number(process.env.STRIPE_ANNUAL_TRIAL_DAYS ?? "5");
    const trialDays = plan === "annual" ? Math.max(0, annualTrialDays) : 0;

    // Create subscription with incomplete payment
    // Payment method will be collected and confirmed via Stripe Elements
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [
        {
          price: priceId
        }
      ],
      payment_behavior: "default_incomplete",
      payment_settings: {
        payment_method_types: ["card"],
        save_default_payment_method: "on_subscription"
      },
      expand: ["latest_invoice.payment_intent"],
      trial_period_days: trialDays > 0 ? trialDays : undefined,
      metadata: {
        plan,
        userId: session?.user?.id ?? "guest"
      }
    });

    const invoice = subscription.latest_invoice;
    if (invoice && typeof invoice === "object" && "payment_intent" in invoice) {
      const paymentIntent = invoice.payment_intent;
      if (paymentIntent && typeof paymentIntent === "object" && "client_secret" in paymentIntent) {
        return NextResponse.json({
          clientSecret: paymentIntent.client_secret,
          subscriptionId: subscription.id
        });
      }
    }

    return NextResponse.json({ error: "Failed to create payment intent." }, { status: 500 });
  } catch (error) {
    console.error("Stripe subscription creation error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create subscription." },
      { status: 500 }
    );
  }
}

