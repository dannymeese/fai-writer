import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";
import Stripe from "stripe";
import { hash } from "bcryptjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!stripe) {
    console.error("Stripe not configured");
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const body = await request.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    console.error("No Stripe signature header");
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json(
      { error: "Invalid signature", details: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdate(subscription);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentSucceeded(invoice);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook handler error:", error);
    // Return 200 to prevent Stripe from retrying immediately
    // Log error for manual investigation
    return NextResponse.json(
      { error: "Webhook processing failed", details: error instanceof Error ? error.message : String(error) },
      { status: 200 }
    );
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const email = session.customer_email || session.customer_details?.email;
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

  if (!email) {
    console.error("Missing email in checkout session", { sessionId: session.id });
    return;
  }

  if (!customerId) {
    console.error("Missing customer ID in checkout session", { sessionId: session.id });
    return;
  }

  // Check if user already exists
  let user = await prisma.user.findUnique({
    where: { email }
  });

  const plan = session.metadata?.plan || (subscriptionId ? "annual" : null);

  if (!user) {
    // Create new user account
    // Generate a secure random password - user will need to reset it
    const tempPassword = crypto.randomUUID() + crypto.randomUUID();
    const hashedPassword = await hash(tempPassword, 12);

    try {
      user = await prisma.user.create({
        data: {
          email,
          name: session.customer_details?.name || email.split("@")[0],
          password: hashedPassword,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId || null,
          // Will be updated by subscription webhook if subscription exists
          subscriptionStatus: subscriptionId ? "TRIALING" : "ACTIVE",
          subscriptionPlan: plan,
          subscriptionStartAt: new Date()
        }
      });

      // Create default Archive folder
      await prisma.folder.create({
        data: {
          name: "Archive",
          ownerId: user.id
        }
      }).catch(err => {
        console.error("Failed to create Archive folder for new user:", err);
        // Don't fail registration if folder creation fails
      });

      console.log(`Created new user account for ${email}`, { userId: user.id });

      // TODO: Send welcome email with password reset link
      // await sendWelcomeEmail(email, passwordResetLink);
    } catch (error) {
      console.error("Failed to create user account:", error);
      throw error;
    }
  } else {
    // Update existing user with subscription info
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId || null,
          subscriptionStatus: subscriptionId ? "TRIALING" : "ACTIVE",
          subscriptionPlan: plan,
          subscriptionStartAt: new Date()
        }
      });

      console.log(`Updated existing user account for ${email}`, { userId: user.id });
    } catch (error) {
      console.error("Failed to update user account:", error);
      throw error;
    }
  }

  // If subscription exists, fetch full details to sync status
  if (subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await syncSubscriptionStatus(subscription);
    } catch (error) {
      console.error("Failed to sync subscription status:", error);
      // Don't throw - account is created, subscription sync can happen later
    }
  }
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  await syncSubscriptionStatus(subscription);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const user = await prisma.user.findUnique({
    where: { stripeSubscriptionId: subscription.id }
  });

  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        subscriptionStatus: "CANCELED",
        subscriptionEndAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : new Date()
      }
    });

    console.log(`Canceled subscription for user ${user.id}`);
  }
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;

  if (subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await syncSubscriptionStatus(subscription);
    } catch (error) {
      console.error("Failed to sync subscription after payment:", error);
    }
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;

  if (subscriptionId) {
    const user = await prisma.user.findUnique({
      where: { stripeSubscriptionId: subscriptionId }
    });

    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          subscriptionStatus: "PAST_DUE"
        }
      });

      console.log(`Payment failed for user ${user.id}`);

      // TODO: Send payment failed notification email
      // await sendPaymentFailedEmail(user.email);
    }
  }
}

async function syncSubscriptionStatus(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;

  if (!customerId) {
    console.error("Missing customer ID in subscription");
    return;
  }

  const user = await prisma.user.findUnique({
    where: { stripeCustomerId: customerId }
  });

  if (!user) {
    console.error(`No user found for Stripe customer ${customerId}`);
    return;
  }

  type SubscriptionStatus = "INACTIVE" | "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED" | "UNPAID";
  
  const statusMap: Record<string, SubscriptionStatus> = {
    active: "ACTIVE",
    trialing: "TRIALING",
    past_due: "PAST_DUE",
    canceled: "CANCELED",
    unpaid: "UNPAID"
  };

  const priceId = subscription.items.data[0]?.price.id;
  const isAnnual = priceId === process.env.STRIPE_PRICE_ANNUAL;
  const isMonthly = priceId === process.env.STRIPE_PRICE_MONTHLY;
  const plan = isAnnual ? "annual" : isMonthly ? "monthly" : null;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: statusMap[subscription.status] || "INACTIVE",
      subscriptionPlan: plan,
      subscriptionStartAt: new Date(subscription.current_period_start * 1000),
      subscriptionEndAt: new Date(subscription.current_period_end * 1000)
    }
  });

  console.log(`Synced subscription status for user ${user.id}`, {
    status: subscription.status,
    plan
  });
}

