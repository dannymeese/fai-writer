import { Suspense } from "react";
import SignInForm from "@/components/forms/SignInForm";

export default function SignInPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="font-display text-3xl text-charcoal">Welcome back</h1>
        <p className="text-sm text-slate-600">Share your details or glide in with Google to keep writing.</p>
      </div>
      <Suspense fallback={<div className="text-sm text-slate-500">Loading sign-in...</div>}>
        <SignInForm />
      </Suspense>
    </div>
  );
}

