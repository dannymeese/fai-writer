"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SignOutButton } from "../shared/SignOutButton";
import OutputPanel from "./OutputPanel";
import ComposeBar from "../forms/ComposeBar";
import SettingsSheet from "../modals/SettingsSheet";
import { ComposerSettingsInput } from "@/lib/validators";
import { WriterOutput } from "@/types/writer";
import { cn, smartTitleFromPrompt } from "@/lib/utils";

type WriterWorkspaceProps = {
  user: {
    name: string;
    marketTier: string;
  };
  initialOutputs?: WriterOutput[];
  isGuest?: boolean;
};

const defaultSettings: ComposerSettingsInput = {
  marketTier: "MASS",
  characterLength: null,
  wordLength: null,
  gradeLevel: null,
  benchmark: null,
  avoidWords: null
};

export default function WriterWorkspace({ user, initialOutputs, isGuest = false }: WriterWorkspaceProps) {
  const [composeValue, setComposeValue] = useState("");
  const [settings, setSettings] = useState<ComposerSettingsInput>({
    ...defaultSettings,
    marketTier: (user.marketTier as ComposerSettingsInput["marketTier"]) || "MASS"
  });
  const [outputs, setOutputs] = useState<WriterOutput[]>(initialOutputs ?? []);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [guestLimitReached, setGuestLimitReached] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  const headline = useMemo(() => {
    switch (settings.marketTier) {
      case "UHNW":
        return "Ultra high touch language engaged.";
      case "LUXURY":
        return "Luxury tone locked in.";
      case "PREMIUM":
        return "Premium hospitality cadence ready.";
      default:
        return "Mass market polish activated.";
    }
  }, [settings.marketTier]);

  async function handleSubmit() {
    if (!composeValue.trim()) return;
    if (isGuest && guestLimitReached) {
      setToast("Create a free account to keep writing.");
      return;
    }
    setLoading(true);
    const snapshotSettings = { ...settings };
    try {
      const response = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: composeValue,
          settings: snapshotSettings
        })
      });
      if (!response.ok) {
        if (response.status === 403) {
          const errorData = await response.json().catch(() => null);
          if (errorData?.requireAuth) {
            setGuestLimitReached(true);
            setToast("You’ve unlocked 5 samples. Register to continue.");
            return;
          }
        }
        throw new Error("Failed to compose");
      }
      const data = await response.json();
      const nextCount = outputs.length + 1;
      const newOutput: WriterOutput = {
        id: data.documentId ?? crypto.randomUUID(),
        title: data.title ?? smartTitleFromPrompt(composeValue),
        content: data.content,
        createdAt: data.createdAt ?? new Date().toISOString(),
        settings: snapshotSettings
      };
      setOutputs((prev) => [newOutput, ...prev]);
      setComposeValue("");
      setToast("Draft ready with guardrails applied.");
      if (isGuest && nextCount >= 5) {
        setGuestLimitReached(true);
      }
    } catch (error) {
      console.error(error);
      setToast("Could not complete that request.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy(output: WriterOutput) {
    try {
      await navigator.clipboard.writeText(output.content);
      setToast("Copied without any AI tells.");
    } catch {
      setToast("Clipboard blocked.");
    }
  }

  async function handleDownload(output: WriterOutput) {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: output.title,
        content: output.content
      })
    });
    if (!response.ok) {
      setToast("Download failed.");
      return;
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const stamp = new Date().toISOString().split("T")[0];
    link.download = `${output.title.replace(/\s+/g, "_")}_${stamp}.docx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    setToast("Docx download started.");
  }

  async function handleSaveStyle(output: WriterOutput) {
    if (isGuest) {
      setToast("Create an account to save writing styles.");
      return;
    }
    const response = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `${output.title} • Style`,
        content: output.content,
        tone: output.settings.marketTier
      })
    });
    if (!response.ok) {
      setToast("Could not save style.");
      return;
    }
    setToast("Style saved for future prompts.");
  }

  return (
    <div className="min-h-screen bg-sand pb-32">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Forgetaboutit Writer</p>
            <h1 className="font-display text-3xl text-charcoal">Hello {user.name}</h1>
            <p className="text-sm text-slate-500">{headline}</p>
            {isGuest && (
              <p className="mt-2 text-sm text-slate-500">
                First five outputs are on us. We’ll ask you to register after that.
              </p>
            )}
          </div>
          {isGuest ? (
            <div className="flex gap-2">
              <Link
                href="/register"
                className="rounded-full bg-brandblue px-4 py-2 text-sm font-semibold text-white hover:bg-brandblue/90"
              >
                Register free
              </Link>
              <Link
                href="/sign-in"
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-brandblue hover:text-brandblue"
              >
                Sign in
              </Link>
            </div>
          ) : (
            <SignOutButton />
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">
        {isGuest && guestLimitReached && <RegisterGate />}
        <div className="mb-6 rounded-3xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-500">Conversation outputs</p>
              <h2 className="font-display text-2xl text-charcoal">
                Every draft honors the system prompt, no excuses.
              </h2>
            </div>
            <button
              onClick={() => setSheetOpen(true)}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-brandblue hover:text-brandblue"
            >
              Adjust brief
            </button>
          </div>
        </div>
        <OutputPanel
          outputs={outputs}
          onCopy={handleCopy}
          onDownload={handleDownload}
          onSaveStyle={handleSaveStyle}
          canSaveStyle={!isGuest}
        />
      </main>
      <ComposeBar
        value={composeValue}
        onChange={setComposeValue}
        onSubmit={handleSubmit}
        disabled={loading || (isGuest && guestLimitReached)}
        onOpenSettings={() => setSheetOpen(true)}
      />
      <SettingsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} settings={settings} onChange={setSettings} />
      <Toast message={toast} />
    </div>
  );
}

function Toast({ message }: { message: string | null }) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-24 left-1/2 w-full max-w-md -translate-x-1/2 transform rounded-2xl bg-charcoal px-4 py-3 text-center text-sm text-white shadow-2xl transition-all duration-300",
        {
          "opacity-100 translate-y-0": Boolean(message),
          "opacity-0 translate-y-4": !message
        }
      )}
    >
      {message}
    </div>
  );
}

function RegisterGate() {
  return (
    <div className="mb-6 rounded-3xl border border-dashed border-brandblue/40 bg-white/70 p-6 text-center shadow-sm">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Limit reached</p>
      <h3 className="mt-2 font-display text-2xl text-charcoal">Ready for the full studio?</h3>
      <p className="mt-2 text-sm text-slate-600">
        You’ve enjoyed five complimentary outputs. Register or sign in to keep generating high-touch copy and save styles.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-3">
        <Link
          href="/register"
          className="rounded-full bg-brandblue px-5 py-2 text-sm font-semibold text-white hover:bg-brandblue/90"
        >
          Create account
        </Link>
        <Link
          href="/sign-in"
          className="rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-700 hover:border-brandblue hover:text-brandblue"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}

