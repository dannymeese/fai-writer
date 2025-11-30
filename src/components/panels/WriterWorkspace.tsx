"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SignOutButton } from "../shared/SignOutButton";
import OutputPanel from "./OutputPanel";
import ComposeBar from "../forms/ComposeBar";
import SettingsSheet from "../modals/SettingsSheet";
import { ComposerSettingsInput } from "@/lib/validators";
import { OutputPlaceholder, WriterOutput } from "@/types/writer";
import { cn, smartTitleFromPrompt } from "@/lib/utils";

type WriterWorkspaceProps = {
  user: {
    name: string;
  };
  initialOutputs?: WriterOutput[];
  isGuest?: boolean;
};

const defaultSettings: ComposerSettingsInput = {
  marketTier: null,
  characterLength: null,
  wordLength: null,
  gradeLevel: null,
  benchmark: null,
  avoidWords: null
};

function normalizeSettings(next?: Partial<ComposerSettingsInput>): ComposerSettingsInput {
  return {
    marketTier: (next?.marketTier ?? null) as ComposerSettingsInput["marketTier"],
    characterLength: next?.characterLength ?? null,
    wordLength: next?.wordLength ?? null,
    gradeLevel: next?.gradeLevel ?? null,
    benchmark: next?.benchmark ?? null,
    avoidWords: next?.avoidWords ?? null
  };
}

function hasCustomOptions(settings: ComposerSettingsInput): boolean {
  return !!(
    settings.marketTier ||
    settings.gradeLevel ||
    settings.benchmark ||
    settings.avoidWords ||
    settings.characterLength ||
    settings.wordLength
  );
}

function derivePlaceholderMeta(content: string): OutputPlaceholder[] {
  const meta: OutputPlaceholder[] = [];
  const regex = /\[([^\]]+)]/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = regex.exec(content)) !== null) {
    const label = (match[1] ?? "").trim() || "missing info";
    meta.push({ id: `ph-${index++}`, label });
  }
  return meta;
}

function ensurePlaceholderState(output: WriterOutput): WriterOutput {
  const placeholderMeta = derivePlaceholderMeta(output.content);
  const existingValues = output.placeholderValues ?? {};
  const nextValues: Record<string, string> = {};
  placeholderMeta.forEach((placeholder) => {
    nextValues[placeholder.id] = existingValues[placeholder.id] ?? "";
  });
  return {
    ...output,
    placeholderMeta,
    placeholderValues: nextValues
  };
}

function resolveOutputContent(output: WriterOutput): string {
  const meta = output.placeholderMeta ?? [];
  const values = output.placeholderValues ?? {};
  if (!meta.length) {
    return output.content;
  }
  
  // Create a map of placeholder labels to their values for more reliable matching
  const labelToValue = new Map<string, string>();
  meta.forEach((placeholder) => {
    const value = values[placeholder.id];
    if (value && value.trim()) {
      labelToValue.set(placeholder.label, value.trim());
    }
  });
  
  // Replace placeholders by matching their label content
  return output.content.replace(/\[([^\]]+)]/g, (match, label) => {
    const trimmedLabel = label.trim();
    const value = labelToValue.get(trimmedLabel);
    return value || match;
  });
}

export default function WriterWorkspace({ user, initialOutputs, isGuest = false }: WriterWorkspaceProps) {
  const guestLimitEnabled = process.env.NEXT_PUBLIC_ENFORCE_GUEST_LIMIT === "true";
  const [composeValue, setComposeValue] = useState("");
  const [settings, setSettings] = useState<ComposerSettingsInput>(defaultSettings);
  const [outputs, setOutputs] = useState<WriterOutput[]>(() => (initialOutputs ?? []).map(ensurePlaceholderState));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetAnchor, setSheetAnchor] = useState<DOMRect | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [guestLimitReached, setGuestLimitReached] = useState(false);
  const [hasBrand, setHasBrand] = useState(false);
  const composeInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  // Check if brand is defined (works for both authenticated users and guests)
  useEffect(() => {
    async function checkBrand() {
      try {
        const response = await fetch("/api/brand");
        if (response.ok) {
          const data = await response.json();
          setHasBrand(!!data.brandInfo);
        }
      } catch (error) {
        console.error("Failed to check brand info", error);
      }
    }
    checkBrand();
  }, []);

  async function handleSubmit() {
    if (!composeValue.trim()) return;
    if (guestLimitEnabled && isGuest && guestLimitReached) {
      setToast("Create a free account to keep writing.");
      return;
    }
    const currentPrompt = composeValue;
    setComposeValue("");
    setLoading(true);
    const snapshotSettings = { ...settings };
    const tempId = crypto.randomUUID();
    const pendingOutput: WriterOutput = ensurePlaceholderState({
      id: tempId,
      title: smartTitleFromPrompt(currentPrompt),
      content: "",
      createdAt: new Date().toISOString(),
      settings: normalizeSettings({
        ...snapshotSettings,
        marketTier: snapshotSettings.marketTier ?? null
      }),
      prompt: currentPrompt,
      isPending: true
    });
    setOutputs((prev) => [pendingOutput, ...prev]);
    try {
      const response = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: currentPrompt,
          settings: snapshotSettings
        })
      });
      if (!response.ok) {
        if (response.status === 403) {
          const errorData = await response.json().catch(() => null);
          if (guestLimitEnabled && errorData?.requireAuth) {
            setGuestLimitReached(true);
            setToast("You’ve unlocked 5 samples. Register to continue.");
            return;
          }
        }
        throw new Error("Failed to compose");
      }
      const data = await response.json();
      const finalId = data.documentId ?? tempId;
      const nextCount = outputs.length + 1;
      const newOutput: WriterOutput = ensurePlaceholderState({
        id: finalId,
        title: data.title ?? smartTitleFromPrompt(currentPrompt),
        content: data.content,
        createdAt: data.createdAt ?? new Date().toISOString(),
        settings: normalizeSettings({
          ...snapshotSettings,
          marketTier: snapshotSettings.marketTier ?? null
        }),
        prompt: currentPrompt,
        writingStyle: data.writingStyle ?? null,
        isPending: false
      });
      setOutputs((prev) => prev.map((entry) => (entry.id === tempId ? newOutput : entry)));
      setToast("Draft ready with guardrails applied.");
      if (guestLimitEnabled && isGuest && nextCount >= 5) {
        setGuestLimitReached(true);
      }
    } catch (error) {
      console.error(error);
      setToast("Could not complete that request.");
      setOutputs((prev) => prev.filter((entry) => entry.id !== tempId));
    } finally {
      setLoading(false);
    }
  }

  function updatePlaceholder(outputId: string, placeholderId: string, value: string | null) {
    setOutputs((prev) =>
      prev.map((existing) => {
        if (existing.id !== outputId) return existing;
        const current = existing.placeholderValues ? { ...existing.placeholderValues } : {};
        const trimmed = value?.trim() ?? "";
        if (trimmed) {
          current[placeholderId] = trimmed;
        } else {
          delete current[placeholderId];
        }
        return {
          ...existing,
          placeholderValues: current
        };
      })
    );
  }

  async function handleCopy(output: WriterOutput) {
    try {
      await navigator.clipboard.writeText(resolveOutputContent(output));
      setToast("Copied without any AI tells.");
    } catch {
      setToast("Clipboard blocked.");
    }
  }

  async function handleDownload(output: WriterOutput) {
    const resolved = resolveOutputContent(output);
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: output.title,
        content: resolved
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
    if (guestLimitEnabled && isGuest) {
      setToast("Create an account to save writing styles.");
      return;
    }
    const resolvedContent = resolveOutputContent(output);
    const response = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `${output.title} • Style`,
        content: resolvedContent,
        tone: output.settings.marketTier ?? undefined,
        prompt: output.prompt,
        // Only save non-length related settings
        gradeLevel: output.settings.gradeLevel,
        benchmark: output.settings.benchmark,
        avoidWords: output.settings.avoidWords,
        writingStyle: output.writingStyle ?? undefined
      })
    });
    if (!response.ok) {
      setToast("Could not save style.");
      return;
    }
    setToast("Style saved for future prompts.");
  }

  const hasOutputs = outputs.length > 0;

  if (!hasOutputs) {
    return (
      <div className="fixed inset-0 flex flex-col overflow-hidden bg-brand-background text-brand-text">
        {!isGuest && (
          <div className="absolute right-6 top-6 z-10">
            <SignOutButton />
          </div>
        )}
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="flex w-full max-w-4xl flex-col items-center gap-5 text-white">
            <p className="text-2xl font-normal">What should I write?</p>
            <ComposeBar
              value={composeValue}
              onChange={setComposeValue}
              onSubmit={handleSubmit}
              disabled={loading || (guestLimitEnabled && isGuest && guestLimitReached)}
              onToggleSettings={(anchorRect) => {
                setSheetAnchor(anchorRect);
                setSheetOpen((prev) => !prev);
              }}
              compact
              inputRef={composeInputRef}
              hasCustomOptions={hasCustomOptions(settings)}
            />
          </div>
        </div>
        <SettingsSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          settings={settings}
          onChange={setSettings}
          anchorRect={sheetAnchor}
        />
        <Toast message={toast} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-background pb-32 text-brand-text">
      {!isGuest && (
        <div className="mx-auto flex max-w-6xl justify-end px-6 pt-6">
          <SignOutButton />
        </div>
      )}
      <main className="mx-auto max-w-5xl px-6 py-10">
        {guestLimitEnabled && isGuest && guestLimitReached && <RegisterGate />}
        <OutputPanel
          outputs={outputs}
          onCopy={handleCopy}
          onDownload={handleDownload}
          onSaveStyle={handleSaveStyle}
          onEdit={(output) => {
            if (!output.prompt) {
              return;
            }
            setComposeValue(output.prompt);
            setSettings(normalizeSettings(output.settings));
          requestAnimationFrame(() => {
            if (composeInputRef.current) {
              composeInputRef.current.focus();
              const length = composeInputRef.current.value.length;
              composeInputRef.current.setSelectionRange(length, length);
            }
          });
          }}
          canSaveStyle={!guestLimitEnabled || !isGuest}
          onPlaceholderUpdate={updatePlaceholder}
          showEmptyState={hasOutputs}
          hasBrand={hasBrand}
        />
      </main>
      <ComposeBar
        value={composeValue}
        onChange={setComposeValue}
        onSubmit={handleSubmit}
        disabled={loading || (guestLimitEnabled && isGuest && guestLimitReached)}
        onToggleSettings={(anchorRect) => {
          setSheetAnchor(anchorRect);
          setSheetOpen((prev) => !prev);
        }}
        inputRef={composeInputRef}
        hasCustomOptions={hasCustomOptions(settings)}
      />
      <SettingsSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        settings={settings}
        onChange={setSettings}
        anchorRect={sheetAnchor}
      />
      <Toast message={toast} />
    </div>
  );
}

function Toast({ message }: { message: string | null }) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-24 left-1/2 w-full max-w-md -translate-x-1/2 transform rounded-2xl bg-brand-panel px-4 py-3 text-center text-sm text-brand-text shadow-[0_20px_60px_rgba(0,0,0,0.45)] transition-all duration-300",
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
    <div className="mb-6 rounded-3xl border border-dashed border-brand-blue/50 bg-brand-panel/80 p-6 text-center shadow-[0_25px_80px_rgba(0,0,0,0.4)]">
      <p className="text-xs uppercase tracking-[0.3em] text-brand-muted">Limit reached</p>
      <h3 className="mt-2 font-display text-2xl text-brand-text">Ready for the full studio?</h3>
      <p className="mt-2 text-sm text-brand-muted">
        You’ve enjoyed five complimentary outputs. Register or sign in to keep generating high-touch copy and save styles.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-3">
        <Link
          href="/register"
          className="rounded-full bg-brand-blue px-5 py-2 text-sm font-semibold text-white hover:bg-brand-blueHover"
        >
          Create account
        </Link>
        <Link
          href="/sign-in"
          className="rounded-full border border-brand-stroke/70 px-5 py-2 text-sm font-semibold text-brand-text hover:border-brand-blue hover:text-brand-blue"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}

