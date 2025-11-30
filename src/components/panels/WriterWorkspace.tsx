"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SignOutButton } from "../shared/SignOutButton";
import OutputPanel from "./OutputPanel";
import ComposeBar from "../forms/ComposeBar";
import SettingsSheet from "../modals/SettingsSheet";
import { ComposerSettingsInput } from "@/lib/validators";
import { OutputPlaceholder, WriterOutput } from "@/types/writer";
import { cn, formatTimestamp, smartTitleFromPrompt } from "@/lib/utils";

type WriterWorkspaceProps = {
  user: {
    name: string;
  };
  initialOutputs?: WriterOutput[];
  isGuest?: boolean;
};

type SavedDraft = {
  id: string;
  title: string;
  createdAt: string;
  prompt: string;
  content: string;
  settings: ComposerSettingsInput;
  writingStyle?: string | null;
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
  const [brandSummary, setBrandSummary] = useState<string | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<SavedDraft[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const composeInputRef = useRef<HTMLTextAreaElement>(null);
  const isAuthenticated = !isGuest;

  const fetchSavedDrafts = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const response = await fetch("/api/documents");
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        console.warn("load drafts failed", response.status, payload);
        return;
      }
      const docs = await response.json();
      const mapped: SavedDraft[] = (docs as any[]).map((doc) => ({
        id: doc.id,
        title: doc.title ?? "Untitled draft",
        createdAt: doc.createdAt ?? new Date().toISOString(),
        prompt: doc.prompt ?? "",
        content: doc.content ?? "",
        settings: normalizeSettings({
          marketTier: doc.tone ?? null,
          characterLength: doc.characterLength ?? null,
          wordLength: doc.wordLength ?? null,
          gradeLevel: doc.gradeLevel ?? null,
          benchmark: doc.benchmark ?? null,
          avoidWords: doc.avoidWords ?? null
        }),
        writingStyle: doc.writingStyle ?? null
      }));
      mapped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setSavedDrafts(mapped);
    } catch (error) {
      console.error("fetch conversations error", error);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (composeInputRef.current) {
      composeInputRef.current.focus();
    }
  }, []);
  function handleBrandSummaryUpdate(summary: string | null) {
    setBrandSummary(summary);
    setHasBrand(!!summary);
  }

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
          const summary = data.brandInfo ?? null;
          setHasBrand(!!summary);
          setBrandSummary(summary);
        }
      } catch (error) {
        console.error("Failed to check brand info", error);
    }
    }
    checkBrand();
  }, []);

  useEffect(() => {
    fetchSavedDrafts();
  }, [fetchSavedDrafts]);

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
          settings: snapshotSettings,
          brandSummary: brandSummary ?? undefined
        })
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        if (response.status === 403 && guestLimitEnabled && errorPayload?.requireAuth) {
          setGuestLimitReached(true);
          setToast("You’ve reached the guest limit. Please register to continue.");
        } else {
          setToast(errorPayload?.error ?? "Unable to complete that request.");
        }
        setOutputs((prev) => prev.filter((entry) => entry.id !== tempId));
        setLoading(false);
        return;
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
      setToast(error instanceof Error ? error.message : "Could not complete that request.");
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
    let response: Response;
    try {
      response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${output.title} • Style`,
          content: resolvedContent,
          tone: output.settings.marketTier ?? undefined,
          prompt: output.prompt,
          // Only save non-length related settings
          gradeLevel: output.settings.gradeLevel ?? undefined,
          benchmark: output.settings.benchmark ?? undefined,
          avoidWords: output.settings.avoidWords ?? undefined,
          writingStyle: output.writingStyle ?? undefined
        })
      });
    } catch (error) {
      console.error("save style network failure", error);
      setToast("Unable to reach the server. Please try again.");
      return;
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      console.warn("save style failed", response.status, payload);
      setToast(
        typeof payload?.error === "string"
          ? payload.error
          : "Could not save style."
      );
      return;
    }
    fetchSavedDrafts();
    setToast("Style saved for future prompts.");
  }

  const hasOutputs = outputs.length > 0;

  function handleLoadConversation(draft: SavedDraft) {
    const restored = ensurePlaceholderState({
      id: draft.id,
      title: draft.title,
      content: draft.content,
      createdAt: draft.createdAt,
      settings: draft.settings,
      prompt: draft.prompt,
      writingStyle: draft.writingStyle ?? null,
      placeholderValues: {}
    });
    setOutputs([restored]);
    setComposeValue(draft.prompt ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!hasOutputs) {
    return (
      <div className="fixed inset-0 flex flex-col overflow-hidden bg-brand-background text-brand-text">
        {!isGuest && (
          <div className="absolute right-6 top-6 z-10">
            <SignOutButton />
          </div>
        )}
        <div className="flex flex-1 overflow-hidden">
          {isAuthenticated && (
            <ConversationSidebar
              open={sidebarOpen}
              drafts={savedDrafts}
              onToggle={() => setSidebarOpen((prev) => !prev)}
              onSelect={handleLoadConversation}
            />
          )}
          <div className="flex flex-1 items-center justify-center px-4">
            <div className="flex w-full max-w-4xl flex-col items-center gap-5 text-white">
              <p className="pb-10 text-[2rem] font-normal leading-none">What should I write?</p>
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
                hasCustomOptions={hasCustomOptions(settings) || hasBrand}
              />
            </div>
          </div>
        </div>
        <SettingsSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          settings={settings}
          onChange={setSettings}
          anchorRect={sheetAnchor}
          onBrandUpdate={handleBrandSummaryUpdate}
          initialBrandDefined={hasBrand}
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
      <main className="mx-auto flex max-w-6xl gap-6 px-6 py-10">
        {isAuthenticated && (
          <ConversationSidebar
            open={sidebarOpen}
            drafts={savedDrafts}
            onToggle={() => setSidebarOpen((prev) => !prev)}
            onSelect={handleLoadConversation}
          />
        )}
        <div className="flex-1">
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
        </div>
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
        hasCustomOptions={hasCustomOptions(settings) || hasBrand}
      />
      <SettingsSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        settings={settings}
        onChange={setSettings}
        anchorRect={sheetAnchor}
        onBrandUpdate={handleBrandSummaryUpdate}
        initialBrandDefined={hasBrand}
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

type ConversationSidebarProps = {
  open: boolean;
  drafts: SavedDraft[];
  onToggle: () => void;
  onSelect: (draft: SavedDraft) => void;
};

function ConversationSidebar({ open, drafts, onToggle, onSelect }: ConversationSidebarProps) {
  return (
    <aside
      className={cn(
        "relative hidden h-[calc(100vh-180px)] flex-shrink-0 rounded-3xl border border-brand-stroke/60 bg-brand-panel/60 p-4 transition-all duration-300 lg:block",
        open ? "w-72" : "w-12"
      )}
    >
      <button
        type="button"
        aria-label={open ? "Collapse conversation history" : "Expand conversation history"}
        onClick={onToggle}
        className="absolute -right-3 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-brand-stroke/60 bg-brand-background text-sm font-semibold text-brand-text shadow"
      >
        {open ? "⟨" : "⟩"}
      </button>
      {open ? (
        <div className="mt-6 flex h-full flex-col overflow-hidden">
          <p className="text-sm font-semibold uppercase text-brand-muted tracking-[0.2em]">History</p>
          <div className="mt-4 flex-1 overflow-y-auto pr-2">
            {drafts.length === 0 ? (
              <p className="text-sm text-brand-muted">No saved conversations yet.</p>
            ) : (
              <ul className="space-y-3">
                {drafts.map((draft) => (
                  <li key={draft.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(draft)}
                      className="w-full rounded-2xl border border-brand-stroke/40 bg-brand-background/60 px-3 py-3 text-left transition hover:border-brand-blue"
                    >
                      <p className="text-sm font-semibold text-white">{draft.title || "Untitled draft"}</p>
                      <p className="text-xs text-brand-muted">{formatTimestamp(draft.createdAt)}</p>
                      {draft.prompt && (
                        <p className="mt-1 line-clamp-2 text-xs text-brand-muted/80">{draft.prompt}</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center">
          <span className="rotate-90 text-xs font-semibold uppercase tracking-[0.3em] text-brand-muted">History</span>
        </div>
      )}
    </aside>
  );
}

