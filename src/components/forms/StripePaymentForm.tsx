"use client";

import { useState, FormEvent } from "react";
import {
  PaymentElement,
  useStripe,
  useElements
} from "@stripe/react-stripe-js";

interface StripePaymentFormProps {
  planId: "annual" | "monthly";
  onSuccess: () => void;
  onError: (error: string) => void;
}

export default function StripePaymentForm({
  planId,
  onSuccess,
  onError
}: StripePaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);
    setMessage(null);

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/?checkout=success`
        },
        redirect: "if_required"
      });

      if (error) {
        setMessage(error.message ?? "An error occurred");
        onError(error.message ?? "Payment failed");
        setIsProcessing(false);
      } else if (paymentIntent && paymentIntent.status === "succeeded") {
        setMessage("Payment succeeded!");
        onSuccess();
      } else {
        setMessage("Unexpected payment status");
        setIsProcessing(false);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unexpected error occurred";
      setMessage(errorMessage);
      onError(errorMessage);
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement
        options={{
          layout: "tabs"
        }}
      />
      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            message.includes("succeeded")
              ? "bg-green-500/10 text-green-100 border border-green-500/50"
              : "bg-red-500/10 text-red-100 border border-red-500/50"
          }`}
        >
          {message}
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || isProcessing}
        className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-brand-blue/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isProcessing ? "Processing..." : `Subscribe to ${planId === "annual" ? "Annual" : "Monthly"} Plan`}
      </button>
    </form>
  );
}

