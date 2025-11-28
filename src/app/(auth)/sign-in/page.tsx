import { Suspense } from "react";
import SignInForm from "@/components/forms/SignInForm";

export default function SignInPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Forgetaboutit Writer</p>
        <h1 className="font-display text-3xl text-charcoal">Welcome back</h1>
        <p className="text-sm text-slate-600">
          Enter your details or glide in with Google to keep writing.
        </p>
      </div>
      <Suspense fallback={<div className="text-sm text-slate-500">Loading sign-in...</div>}>
        <SignInForm />
      </Suspense>
    </div>
  );
}

