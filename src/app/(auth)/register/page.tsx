import RegisterForm from "@/components/forms/RegisterForm";

const registrationEnabled = Boolean(process.env.DATABASE_URL);

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Forgetaboutit Writer</p>
        <h1 className="font-display text-3xl text-charcoal">Create access</h1>
        <p className="text-sm text-slate-600">
          Unlock the studio and you can dial in tone from the brief controls anytime.
        </p>
      </div>
      {registrationEnabled ? (
        <RegisterForm />
      ) : (
        <p className="rounded-2xl bg-slate-100 p-4 text-center text-sm text-slate-600">
          Registration is temporarily disabled until the database connection is configured. You can still compose freely in guest
          mode from the main workspace.
        </p>
      )}
    </div>
  );
}

