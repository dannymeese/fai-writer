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
    const { plan } = body;

    if (!plan || (plan !== "monthly" && plan !== "annual")) {
      return NextResponse.json({ error: "Invalid plan." }, { status: 400 });
    }

    const priceId = plan === "monthly" ? process.env.STRIPE_PRICE_MONTHLY : process.env.STRIPE_PRICE_ANNUAL;
    if (!priceId) {
      return NextResponse.json({ error: "Stripe price IDs are missing." }, { status: 500 });
    }

    // Get price details to calculate amount
    const price = await stripe.prices.retrieve(priceId);
    const amount = price.unit_amount;
    const currency = price.currency;

    if (!amount) {
      return NextResponse.json({ error: "Price amount not found." }, { status: 500 });
    }

    const email = session?.user?.email ?? body?.email;
    
    // Create or retrieve customer
    let customerId: string | undefined;
    if (email) {
      const existingCustomers = await stripe.customers.list({
        email: email,
        limit: 1
      });

      if (existingCustomers.data.length > 0) {
        customerId = existingCustomers.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email: email,
          metadata: {
            userId: session?.user?.id ?? "guest"
          }
        });
        customerId = customer.id;
      }
    }

    // Create payment intent for subscription setup
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: currency,
      customer: customerId,
      setup_future_usage: "off_session",
      metadata: {
        plan,
        userId: session?.user?.id ?? "guest",
        priceId: priceId
      }
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret
    });
  } catch (error) {
    console.error("Stripe payment intent creation error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create payment intent." },
      { status: 500 }
    );
  }
}

