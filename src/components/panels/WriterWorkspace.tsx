"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  styleTitle?: string | null;
  starred?: boolean;
};

type SidebarTab = "drafts" | "starred" | "styles" | "brands";

type ActiveStyle = {
  id: string;
  name: string;
  description: string;
};

const LOCAL_DRAFTS_KEY = "forgetaboutit_writer_drafts_v1";

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readLocalDrafts(): SavedDraft[] {
  if (!canUseLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_DRAFTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const drafts: SavedDraft[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const safeEntry = entry as Partial<SavedDraft>;
      drafts.push({
        id: typeof safeEntry.id === "string" ? safeEntry.id : `local-${Date.now()}`,
        title: typeof safeEntry.title === "string" ? safeEntry.title : "Untitled draft",
        createdAt: typeof safeEntry.createdAt === "string" ? safeEntry.createdAt : new Date().toISOString(),
        prompt: typeof safeEntry.prompt === "string" ? safeEntry.prompt : "",
        content: typeof safeEntry.content === "string" ? safeEntry.content : "",
        settings: normalizeSettings(safeEntry.settings ?? {}),
        writingStyle:
          typeof safeEntry.writingStyle === "string"
            ? safeEntry.writingStyle
            : safeEntry.writingStyle ?? null
      });
    }
    return drafts.slice(0, 25);
  } catch (error) {
    console.error("read local drafts failed", error);
    return [];
  }
}

function persistLocalDraftEntry(draft: SavedDraft) {
  if (!canUseLocalStorage()) return;
  try {
    const existing = readLocalDrafts();
    const next = [draft, ...existing.filter((entry) => entry.id !== draft.id)].slice(0, 25);
    window.localStorage.setItem(LOCAL_DRAFTS_KEY, JSON.stringify(next));
  } catch (error) {
    console.error("persist local drafts failed", error);
  }
}

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

function formatErrorMessage(source: unknown, fallback = "Unable to complete that request."): string {
  if (typeof source === "string" && source.trim()) {
    return source;
  }
  if (source && typeof source === "object") {
    const error = source as { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> };
    const messages: string[] = [];
    if (Array.isArray(error.formErrors)) {
      messages.push(...error.formErrors.filter(Boolean));
    }
    if (error.fieldErrors) {
      Object.entries(error.fieldErrors).forEach(([field, fieldMsgs]) => {
        if (Array.isArray(fieldMsgs)) {
          fieldMsgs.forEach((msg) => {
            if (msg) {
              messages.push(`${field}: ${msg}`);
            }
          });
        }
      });
    }
    if (messages.length) {
      return messages.join(" ");
    }
    try {
      return JSON.stringify(source);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function generateStyleName(description: string | null, fallbackTitle: string): string {
  if (description) {
    const words = description
      .replace(/[^a-zA-Z\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
    if (words.length) {
      return `${words.join(" ")} Style`;
    }
  }
  if (fallbackTitle) {
    return `${fallbackTitle} Style`;
  }
  return "Custom Style";
}

function fallbackStyleDescription(description: string | null, content: string): string {
  if (description?.trim()) {
    return description.trim();
  }
  const snippet = content.replace(/\s+/g, " ").trim().slice(0, 280);
  return snippet ? `${snippet}...` : "Use the tone, pacing, and rhythm captured in this saved style.";
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("drafts");
  const [activeStyle, setActiveStyle] = useState<ActiveStyle | null>(null);
  const [isDesktop, setIsDesktop] = useState(true);
  const composeInputRef = useRef<HTMLTextAreaElement>(null);
  const isAuthenticated = !isGuest;

  const fetchSavedDrafts = useCallback(async () => {
    if (!isAuthenticated) {
      console.log("[fetchSavedDrafts] Skipping - not authenticated");
      return;
    }
    try {
      console.log("[fetchSavedDrafts] Fetching drafts...");
      const response = await fetch("/api/documents", { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        console.warn("[fetchSavedDrafts] load drafts failed", response.status, payload);
        const local = readLocalDrafts();
        if (local.length) {
          setSavedDrafts(local);
        }
        return;
      }
      const docs = await response.json();
      console.log("[fetchSavedDrafts] fetched", docs.length, "documents from API");
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
        writingStyle: doc.writingStyle ?? null,
        styleTitle: doc.styleTitle ?? null,
        starred: doc.starred ?? false
      }));
      mapped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      console.log("[fetchSavedDrafts] mapped documents:", mapped.length);
      const drafts = mapped.filter((doc) => !isStyleDocument(doc));
      const styles = mapped.filter((doc) => isStyleDocument(doc));
      console.log("[fetchSavedDrafts] classified - drafts:", drafts.length, "styles:", styles.length);
      console.log("[fetchSavedDrafts] sample draft titles:", drafts.slice(0, 3).map(d => d.title));
      if (mapped.length) {
        setSavedDrafts(mapped);
        console.log("[fetchSavedDrafts] Updated savedDrafts state with", mapped.length, "documents");
      } else {
        const local = readLocalDrafts();
        if (local.length) {
          setSavedDrafts(local);
        } else {
          setSavedDrafts([]);
        }
      }
    } catch (error) {
      console.error("[fetchSavedDrafts] fetch conversations error", error);
      const local = readLocalDrafts();
      if (local.length) {
        setSavedDrafts(local);
      }
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (composeInputRef.current) {
      composeInputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) return;
    const local = readLocalDrafts();
    if (local.length) {
      setSavedDrafts(local);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
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
    const styleGuidePayload = activeStyle
      ? {
          name: activeStyle.name,
          description: activeStyle.description
        }
      : undefined;
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
          brandSummary: brandSummary ?? undefined,
          styleGuide: styleGuidePayload
        })
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        if (response.status === 403 && guestLimitEnabled && errorPayload?.requireAuth) {
          setGuestLimitReached(true);
          setToast("You’ve reached the guest limit. Please register to continue.");
        } else {
          setToast(formatErrorMessage(errorPayload?.error));
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
        styleTitle: data.styleTitle ?? null,
        isPending: false
      });
      setOutputs((prev) => prev.map((entry) => (entry.id === tempId ? newOutput : entry)));
      // Immediately fetch drafts - the document is already saved in the database
      if (data.documentId) {
        // Document was saved to database, fetch drafts immediately
        fetchSavedDrafts();
        // Also add a retry after a short delay in case of any race condition
        setTimeout(() => {
          fetchSavedDrafts();
        }, 1000);
      } else {
        // No documentId means it wasn't saved (guest or error), save locally
        applyLocalDraft({
          id: finalId,
          title: newOutput.title,
          createdAt: newOutput.createdAt,
          prompt: currentPrompt,
          content: data.content,
          settings: newOutput.settings,
          writingStyle: newOutput.writingStyle ?? null
        });
        fetchSavedDrafts();
      }
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
    const resolvedContent = resolveOutputContent(output);
    // Use the AI-generated styleTitle if available, otherwise generate one from the writingStyle
    let styleName = output.styleTitle ?? generateStyleName(output.writingStyle ?? null, output.title);
    // Ensure the style name ends with " Style" for proper classification
    if (!styleName.toLowerCase().endsWith(" style")) {
      styleName = styleName.endsWith("Style") ? styleName : `${styleName} Style`;
    }
    // Use the full AI-generated writingStyle description (the analyzed style), not a fallback
    const description = output.writingStyle?.trim() ?? fallbackStyleDescription(null, resolvedContent);
    
    if (!description || !description.trim()) {
      setToast("Unable to save style: no writing style description available.");
      return;
    }
    
    console.log("[handleSaveStyle] Saving style:", {
      styleName,
      descriptionLength: description.length,
      hasStyleTitle: !!output.styleTitle,
      hasWritingStyle: !!output.writingStyle
    });

    const localStyleDraft: SavedDraft = {
      id: `${output.id}-style-${Date.now()}`,
      title: styleName,
      createdAt: new Date().toISOString(),
      prompt: output.prompt ?? "",
      content: resolvedContent,
      settings: normalizeSettings(output.settings),
      writingStyle: description,
      styleTitle: styleName
    };
    if (guestLimitEnabled && isGuest) {
      applyLocalDraft(localStyleDraft);
      setToast("Saved locally. Create an account to sync styles everywhere.");
      return;
    }
    let response: Response;
    try {
      response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: styleName,
          content: resolvedContent,
          tone: output.settings.marketTier ?? undefined,
          prompt: output.prompt,
          // Only save non-length related settings
          gradeLevel: output.settings.gradeLevel ?? undefined,
          benchmark: output.settings.benchmark ?? undefined,
          avoidWords: output.settings.avoidWords ?? undefined,
          writingStyle: description,
          styleTitle: styleName
        })
      });
    } catch (error) {
      console.error("save style network failure", error);
      applyLocalDraft(localStyleDraft);
      setToast("Saved locally. We'll sync this style once you're back online.");
      return;
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.warn("save style failed", response.status, payload);
      const errorMsg = formatErrorMessage(payload?.error, "Unable to save writing style.");
      // Don't save locally if there's a validation error - show the error instead
      if (response.status === 400 || response.status === 409) {
        setToast(errorMsg);
        return;
      }
      // Only save locally for network/server errors
      applyLocalDraft(localStyleDraft);
      setToast("Saved locally. We'll sync this style once you're connected.");
      return;
    }
    const remoteDoc = payload ?? null;
    const hydratedStyleDraft: SavedDraft = {
      ...localStyleDraft,
      id: remoteDoc?.id ?? localStyleDraft.id,
      createdAt: remoteDoc?.createdAt ?? localStyleDraft.createdAt
    };
    applyLocalDraft(hydratedStyleDraft);
    fetchSavedDrafts();
    setToast(`Saved "${styleName}".`);
  }

  const hasOutputs = outputs.length > 0;

  const applyLocalDraft = useCallback((draft: SavedDraft) => {
    persistLocalDraftEntry(draft);
    setSavedDrafts((prev) => {
      const next = [draft, ...prev.filter((entry) => entry.id !== draft.id)];
      return next.slice(0, 25);
    });
  }, []);

  const { draftDocuments, starredDocuments, styleDocuments } = useMemo(() => {
    const drafts: SavedDraft[] = [];
    const starred: SavedDraft[] = [];
    const styles: SavedDraft[] = [];
    savedDrafts.forEach((doc) => {
      if (doc.starred) {
        starred.push(doc);
      }
      if (isStyleDocument(doc)) {
        styles.push(doc);
      } else {
        drafts.push(doc);
      }
    });
    return { draftDocuments: drafts, starredDocuments: starred, styleDocuments: styles };
  }, [savedDrafts]);

  async function handleStar(output: WriterOutput, starred: boolean) {
    if (!isAuthenticated || !output.id || output.id.startsWith("temp-")) {
      // For local/guest, just update the output state
      setOutputs((prev) =>
        prev.map((entry) => (entry.id === output.id ? { ...entry, starred } : entry))
      );
      return;
    }

    try {
      const response = await fetch(`/api/documents/${output.id}/star`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        console.warn("star failed", response.status, payload);
        setToast(formatErrorMessage(payload?.error, "Unable to update star status."));
        return;
      }

      // Update the output state
      setOutputs((prev) =>
        prev.map((entry) => (entry.id === output.id ? { ...entry, starred } : entry))
      );

      // Refresh drafts to get updated starred status
      fetchSavedDrafts();
    } catch (error) {
      console.error("star network failure", error);
      setToast("Unable to update star status. Please try again.");
    }
  }

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

  function handleApplyStyle(styleDoc: SavedDraft) {
    const description = fallbackStyleDescription(styleDoc.writingStyle ?? null, styleDoc.content);
    setActiveStyle({
      id: styleDoc.id,
      name: styleDoc.title || "Saved Style",
      description
    });
    if (!isDesktop) {
      setSidebarOpen(false);
    }
    setToast(`Style "${styleDoc.title || "Custom Style"}" applied.`);
  }

  function handleClearStyle() {
    setActiveStyle(null);
  }

  const handleStartNewThread = useCallback(() => {
    setSidebarTab("drafts");
    setSidebarOpen(true);
    setComposeValue("");
    setOutputs([]);
    setActiveStyle(null);
    requestAnimationFrame(() => {
      composeInputRef.current?.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    const listener = () => handleStartNewThread();
    window.addEventListener("new-thread", listener);
    return () => window.removeEventListener("new-thread", listener);
  }, [handleStartNewThread]);

    return (
    <div className="flex min-h-screen bg-brand-background text-brand-text">
      {sidebarOpen && !isDesktop && (
        <button
          type="button"
          aria-label="Close sidebar overlay"
          className="fixed inset-0 z-30 bg-black/60"
          onClick={() => setSidebarOpen(false)}
        />
      )}
          {isAuthenticated && (
        <WorkspaceSidebar
              open={sidebarOpen}
          activeTab={sidebarTab}
          drafts={draftDocuments}
          starred={starredDocuments}
          styles={styleDocuments}
          brandSummary={brandSummary}
          hasBrand={hasBrand}
          userName={user.name}
          topOffset={88}
          bottomOffset={hasOutputs ? 140 : 32}
          isDesktop={isDesktop}
          activeStyleId={activeStyle?.id}
          onSelect={handleLoadConversation}
              onToggle={() => setSidebarOpen((prev) => !prev)}
          onOpen={() => setSidebarOpen(true)}
          onApplyStyle={handleApplyStyle}
          onTabChange={(tab) => setSidebarTab(tab)}
        />
      )}
      <div className="flex min-h-screen flex-1 flex-col pb-32">
        <div
          className={cn(
            "flex-1 px-4 sm:px-6",
            hasOutputs ? "py-8" : "flex items-center justify-center"
          )}
        >
          {hasOutputs ? (
            <div className="mx-auto w-full max-w-5xl">
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
            onStar={handleStar}
            onPlaceholderUpdate={updatePlaceholder}
            showEmptyState={hasOutputs}
            hasBrand={hasBrand}
          />
        </div>
          ) : (
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
                hasCustomOptions={hasCustomOptions(settings) || hasBrand || Boolean(activeStyle)}
                activeStyle={activeStyle}
                onClearStyle={handleClearStyle}
              />
            </div>
          )}
        </div>
        {hasOutputs && (
          <div className="px-4 pb-10 sm:px-6">
            <div className="mx-auto w-full max-w-5xl">
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
            hasCustomOptions={hasCustomOptions(settings) || hasBrand || Boolean(activeStyle)}
            activeStyle={activeStyle}
            onClearStyle={handleClearStyle}
      />
            </div>
          </div>
        )}
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

type WorkspaceSidebarProps = {
  open: boolean;
  activeTab: SidebarTab;
  drafts: SavedDraft[];
  starred: SavedDraft[];
  styles: SavedDraft[];
  brandSummary: string | null;
  hasBrand: boolean;
  userName: string;
  topOffset: number;
  bottomOffset: number;
  isDesktop: boolean;
  activeStyleId?: string;
  onToggle: () => void;
  onOpen: () => void;
  onTabChange: (tab: SidebarTab) => void;
  onSelect: (draft: SavedDraft) => void;
  onApplyStyle: (style: SavedDraft) => void;
};

function WorkspaceSidebar({
  open,
  activeTab,
  drafts,
  starred,
  styles,
  brandSummary,
  hasBrand,
  userName,
  topOffset,
  bottomOffset,
  isDesktop,
  activeStyleId,
  onToggle,
  onOpen,
  onTabChange,
  onSelect,
  onApplyStyle
}: WorkspaceSidebarProps) {
  const tabs: { id: SidebarTab; label: string; icon: string }[] = [
    { id: "drafts", label: "Drafts", icon: "draft" },
    { id: "starred", label: "Starred", icon: "star" },
    { id: "styles", label: "Styles", icon: "brand_family" },
    { id: "brands", label: "Brands", icon: "storefront" }
  ];

  function renderDraftList(items: SavedDraft[], emptyLabel: string) {
    if (!items.length) {
      return <p className="text-sm text-brand-muted">{emptyLabel}</p>;
    }
  return (
      <ul className="space-y-3 pr-2">
        {items.map((draft) => (
                  <li key={draft.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(draft)}
              className="w-full rounded-2xl border border-brand-stroke/40 bg-brand-background/60 px-3 py-3 text-left transition hover:border-white"
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
    );
  }

  function renderStyleList(items: SavedDraft[]) {
    if (!items.length) {
      return <p className="text-sm text-brand-muted">Save a style from any output and it’ll appear here.</p>;
    }
    return (
      <ul className="space-y-3 pr-2">
        {items.map((style) => (
          <li key={style.id}>
            <button
              type="button"
              onClick={() => onApplyStyle(style)}
              className={cn(
                "w-full rounded-2xl border border-brand-stroke/40 bg-brand-background/60 px-3 py-3 text-left transition hover:border-white",
                activeStyleId === style.id ? "border-white bg-white/10" : undefined
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-white">{style.title || "Saved Style"}</p>
                {activeStyleId === style.id && <span className="text-[10px] font-semibold uppercase text-brand-muted">Applied</span>}
          </div>
              {style.writingStyle && (
                <p className="mt-2 line-clamp-3 text-xs text-brand-muted/90">{style.writingStyle}</p>
              )}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  function renderContent() {
    if (activeTab === "drafts") {
      return renderDraftList(drafts, "No drafts yet. Generate something to see it here.");
    }
    if (activeTab === "starred") {
      return renderDraftList(starred, "No starred items yet. Star outputs or inputs to see them here.");
    }
    if (activeTab === "styles") {
      return renderStyleList(styles);
    }
    if (hasBrand && brandSummary) {
      return (
        <div className="rounded-2xl border border-brand-stroke/40 bg-brand-background/60 p-4 text-sm text-brand-muted/90">
          <p className="text-base font-semibold text-white">Defined brand</p>
          <p className="mt-2 whitespace-pre-line leading-relaxed">{brandSummary}</p>
          <p className="mt-4 text-xs text-brand-muted">Update the brand summary inside Settings.</p>
        </div>
      );
    }
    return <p className="text-sm text-brand-muted">No brand defined yet. Add one inside Settings.</p>;
  }

  const desktopStyle = isDesktop
    ? {
        paddingTop: `${topOffset}px`,
        paddingBottom: `${bottomOffset}px`,
        minHeight: "100vh"
      }
    : undefined;

  return (
    <aside
      className={cn(
        "flex flex-col bg-brand-panel/85 text-brand-text shadow-[0_30px_80px_rgba(0,0,0,0.5)] transition-all duration-300 lg:border-r lg:border-brand-stroke/40",
        open
          ? "fixed inset-0 z-40 w-full px-5 py-6 lg:static lg:w-80"
          : "fixed left-4 top-[calc(88px+16px)] z-40 w-14 items-center rounded-3xl border border-brand-stroke/60 px-0 py-4 lg:static lg:w-20 lg:items-center lg:rounded-none lg:border-r lg:border-brand-stroke/40 lg:px-0 lg:py-6",
        "lg:sticky lg:top-0 lg:h-screen"
      )}
      style={desktopStyle}
    >
      <div className={cn("mb-6 flex w-full", open ? "justify-end" : "justify-center")}>
        <button
          type="button"
          aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
          onClick={onToggle}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-brand-stroke/60 bg-brand-background text-brand-text shadow"
        >
          <span className="material-symbols-outlined text-[1.4rem] text-white">
            {open ? "left_panel_close" : "left_panel_open"}
          </span>
        </button>
      </div>
      {open ? (
        <>
          <p className="text-xs font-semibold uppercase text-brand-muted">Workspace</p>
          <div className="mt-4 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))" }}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-full border border-brand-stroke/60 px-3 py-2 text-xs font-semibold uppercase transition",
                  activeTab === tab.id
                    ? "bg-white/15 text-white"
                    : "bg-transparent text-brand-muted hover:text-white"
                )}
              >
                <span className="material-symbols-outlined text-base">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
          <div className="mt-6 flex-1 overflow-y-auto pr-1">{renderContent()}</div>
        </>
      ) : (
        <div className="hidden flex-1 flex-col items-center gap-6 lg:flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                onTabChange(tab.id);
                onOpen();
              }}
              className="flex h-32 w-16 flex-col items-center justify-center gap-2 rounded-3xl border border-brand-stroke/60 px-1 text-[10px] font-semibold uppercase text-brand-muted transition hover:text-white"
              aria-label={`Open ${tab.label}`}
            >
              <span className="material-symbols-outlined text-lg text-white">{tab.icon}</span>
              <span className="text-[9px] tracking-wide text-center text-white">{tab.label}</span>
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="mt-auto w-full border-t border-brand-stroke/40 pt-4">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-brand-muted">Hi, {userName}</p>
            <div className="flex justify-start">
              <SignOutButton />
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function isStyleDocument(draft: SavedDraft): boolean {
  // A document is a style ONLY if:
  // 1. The title ends with " Style" (capital S)
  // 2. AND the styleTitle matches the title (meaning it was explicitly saved as a style)
  // Regular conversations have styleTitle (AI-generated) but their title is from the prompt, so they won't match
  const title = draft.title ?? "";
  const styleTitle = draft.styleTitle ?? "";
  const titleLower = title.toLowerCase();
  
  // Check if title ends with " Style" and matches the styleTitle
  if (titleLower.endsWith(" style") && styleTitle && title === styleTitle) {
    return true;
  }
  
  // Also check for the bullet point style format
  if (titleLower.includes("• style")) {
    return true;
  }
  
  return false;
}

