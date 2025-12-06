# Stripe Payment + Registration Best Practices

## Overview
This document outlines best practices for registering users through or after Stripe payment completion.

## Recommended Approach: **Register AFTER Payment Success**

### Why This Approach?
1. **Prevents unpaid accounts** - Only create accounts for paying customers
2. **Reduces fraud** - Payment verification before account creation
3. **Better UX** - User pays first, then gets immediate access
4. **Simpler flow** - One less step in checkout process

## Implementation Strategy

### Option 1: Stripe Webhooks (RECOMMENDED - Most Reliable)

**Flow:**
1. User selects plan on `/membership` page
2. User enters email (if not authenticated)
3. Create Stripe Checkout Session or Subscription with email
4. User completes payment on Stripe
5. Stripe sends webhook to your server
6. Webhook handler creates user account + subscription record
7. User redirected to success page with auto-login link

**Pros:**
- ✅ Most reliable (works even if user closes browser)
- ✅ Handles edge cases (payment retries, failures)
- ✅ Can retry failed webhook processing
- ✅ Industry standard approach

**Cons:**
- ⚠️ Requires webhook endpoint setup
- ⚠️ Slight delay before account creation

### Option 2: Success Page Callback (Simpler but Less Reliable)

**Flow:**
1. User completes payment
2. Stripe redirects to success page with session ID
3. Success page calls API to verify payment
4. API creates account if payment verified
5. User auto-logged in

**Pros:**
- ✅ Simpler implementation
- ✅ Immediate account creation

**Cons:**
- ⚠️ Fails if user closes browser before redirect
- ⚠️ Requires payment verification on every page load
- ⚠️ Less secure (client-side verification)

## Recommended Implementation: Webhook-Based

### Step 1: Add Subscription Fields to Database Schema

```prisma
model User {
  // ... existing fields
  stripeCustomerId    String?  @unique
  stripeSubscriptionId String?  @unique
  subscriptionStatus  SubscriptionStatus @default(INACTIVE)
  subscriptionPlan    String?  // "monthly" | "annual"
  subscriptionStartAt DateTime?
  subscriptionEndAt   DateTime?
}

enum SubscriptionStatus {
  INACTIVE
  ACTIVE
  TRIALING
  PAST_DUE
  CANCELED
  UNPAID
}
```

### Step 2: Create Webhook Handler

**File: `src/app/api/stripe/webhook/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";
import Stripe from "stripe";

export async function POST(request: Request) {
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const body = await request.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
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
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook handler error:", error);
    // Return 200 to prevent Stripe from retrying immediately
    // Log error for manual investigation
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 200 });
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const customerId = typeof session.customer === "string" 
    ? session.customer 
    : session.customer?.id;
  
  const email = session.customer_email || session.customer_details?.email;
  const subscriptionId = typeof session.subscription === "string"
    ? session.subscription
    : session.subscription?.id;

  if (!email || !customerId) {
    console.error("Missing email or customer ID in checkout session");
    return;
  }

  // Check if user already exists
  let user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user) {
    // Create new user account
    // Generate temporary password or send password reset email
    const tempPassword = crypto.randomUUID(); // Or use a more secure method
    const hashedPassword = await hash(tempPassword, 12);
    
    user = await prisma.user.create({
      data: {
        email,
        name: session.customer_details?.name || email.split("@")[0],
        password: hashedPassword,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId || null,
        subscriptionStatus: subscriptionId ? "TRIALING" : "ACTIVE",
        subscriptionPlan: session.metadata?.plan || null,
        subscriptionStartAt: new Date(),
      }
    });

    // Create default Archive folder
    await prisma.folder.create({
      data: {
        name: "Archive",
        ownerId: user.id
      }
    }).catch(err => console.error("Failed to create Archive folder:", err));

    // Send welcome email with password reset link
    // await sendWelcomeEmail(email, passwordResetLink);
  } else {
    // Update existing user with subscription info
    await prisma.user.update({
      where: { id: user.id },
      data: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId || null,
        subscriptionStatus: subscriptionId ? "TRIALING" : "ACTIVE",
        subscriptionPlan: session.metadata?.plan || null,
        subscriptionStartAt: new Date(),
      }
    });
  }

  // If subscription exists, fetch full details
  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await syncSubscriptionStatus(subscription);
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
        subscriptionEndAt: new Date(subscription.canceled_at * 1000),
      }
    });
  }
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  const subscriptionId = typeof invoice.subscription === "string"
    ? invoice.subscription
    : invoice.subscription?.id;

  if (subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await syncSubscriptionStatus(subscription);
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId = typeof invoice.subscription === "string"
    ? invoice.subscription
    : invoice.subscription?.id;

  if (subscriptionId) {
    const user = await prisma.user.findUnique({
      where: { stripeSubscriptionId: subscriptionId }
    });

    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          subscriptionStatus: "PAST_DUE",
        }
      });

      // Send payment failed notification email
      // await sendPaymentFailedEmail(user.email);
    }
  }
}

async function syncSubscriptionStatus(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer?.id;

  if (!customerId) return;

  const user = await prisma.user.findUnique({
    where: { stripeCustomerId: customerId }
  });

  if (!user) return;

  const statusMap: Record<string, "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED" | "UNPAID"> = {
    active: "ACTIVE",
    trialing: "TRIALING",
    past_due: "PAST_DUE",
    canceled: "CANCELED",
    unpaid: "UNPAID",
  };

  const plan = subscription.items.data[0]?.price.id === process.env.STRIPE_PRICE_ANNUAL
    ? "annual"
    : subscription.items.data[0]?.price.id === process.env.STRIPE_PRICE_MONTHLY
    ? "monthly"
    : null;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: statusMap[subscription.status] || "INACTIVE",
      subscriptionPlan: plan,
      subscriptionStartAt: new Date(subscription.current_period_start * 1000),
      subscriptionEndAt: new Date(subscription.current_period_end * 1000),
    }
  });
}
```

### Step 3: Update Checkout Session Creation

**Update `src/app/api/stripe/checkout/route.ts`:**

```typescript
// Add metadata to help webhook identify user
const checkoutSession = await stripe.checkout.sessions.create({
  // ... existing config
  metadata: {
    plan,
    email: customerEmail, // Store email in metadata for webhook
    userId: session?.user?.id ?? "", // Empty if guest
  },
  // Add customer creation if email provided
  customer_email: customerEmail,
  // ... rest of config
});
```

### Step 4: Update Success Page to Handle Auto-Login

**Update `src/app/page.tsx` or create success handler:**

```typescript
// In page component or success handler
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("checkout") === "success") {
    // Option 1: Check if user was just created
    // Call API to check if account exists for email
    // If exists, show "Check your email for login link" message
    
    // Option 2: If you stored email in sessionStorage before checkout
    const email = sessionStorage.getItem("checkout_email");
    if (email) {
      // Attempt to find user and show login prompt
      sessionStorage.removeItem("checkout_email");
    }
  }
}, []);
```

### Step 5: Environment Variables

Add to `.env`:
```
STRIPE_WEBHOOK_SECRET=whsec_... # From Stripe Dashboard > Webhooks
```

## Alternative: Register DURING Payment (Less Recommended)

If you want to create account before payment:

1. **Collect email + password** on membership page
2. **Create account** immediately (with `subscriptionStatus: INACTIVE`)
3. **Create Stripe customer** linked to account
4. **Start checkout** with customer ID
5. **Update account** on payment success

**Downsides:**
- Users can create accounts without paying
- More complex flow
- Need to handle abandoned checkouts

## Security Best Practices

1. **Always verify webhook signatures** - Never trust webhook data without verification
2. **Idempotency** - Use Stripe event IDs to prevent duplicate processing
3. **Retry logic** - Handle webhook failures gracefully
4. **Email verification** - Send password reset link instead of plain password
5. **Rate limiting** - Protect webhook endpoint from abuse
6. **Logging** - Log all webhook events for debugging

## Testing

1. **Stripe CLI** - Use `stripe listen --forward-to localhost:3000/api/stripe/webhook`
2. **Test cards** - Use Stripe test cards for different scenarios
3. **Webhook testing** - Test all event types (success, failure, cancellation)

## Migration Path

1. Add database fields (migration)
2. Deploy webhook handler
3. Configure webhook in Stripe Dashboard
4. Test with test payments
5. Update checkout flow to use new metadata
6. Monitor webhook logs for issues

