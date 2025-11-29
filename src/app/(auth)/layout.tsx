export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-background px-4 py-12">
      <div className="w-full max-w-md rounded-3xl border border-brand-stroke/60 bg-brand-panel/90 p-8 text-brand-text shadow-[0_35px_80px_rgba(0,0,0,0.55)]">
        {children}
      </div>
    </div>
  );
}

