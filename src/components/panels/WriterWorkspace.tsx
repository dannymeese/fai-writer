"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SignOutButton } from "../shared/SignOutButton";
import OutputPanel from "./OutputPanel";
import DocumentEditor from "../editors/DocumentEditor";
import ComposeBar from "../forms/ComposeBar";
import SettingsSheet from "../modals/SettingsSheet";
import { ComposerSettingsInput } from "@/lib/validators";
import { OutputPlaceholder, WriterOutput } from "@/types/writer";
import { cn, formatTimestamp, smartTitleFromPrompt, deriveTitleFromContent } from "@/lib/utils";

type WriterWorkspaceProps = {
  user: {
    name: string;
  };
  initialOutputs?: WriterOutput[];
  isGuest?: boolean;
};

type SavedDoc = {
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

type SidebarTab = "docs" | "starred" | "styles" | "brands";

type ActiveStyle = {
  id: string;
  name: string;
  description: string;
};

const LOCAL_DOCS_KEY = "forgetaboutit_writer_docs_v1";
const EDITOR_CONTEXT_WINDOW = 600;

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readLocalDocs(): SavedDoc[] {
  if (!canUseLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_DOCS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const docs: SavedDoc[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const safeEntry = entry as Partial<SavedDoc>;
      docs.push({
        id: typeof safeEntry.id === "string" ? safeEntry.id : `local-${Date.now()}`,
        title: typeof safeEntry.title === "string" ? safeEntry.title : "Untitled doc",
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
    return docs.slice(0, 25);
  } catch (error) {
    console.error("read local docs failed", error);
    return [];
  }
}

function persistLocalDocEntry(doc: SavedDoc) {
  if (!canUseLocalStorage()) return;
  try {
    const existing = readLocalDocs();
    const next = [doc, ...existing.filter((entry) => entry.id !== doc.id)].slice(0, 25);
    window.localStorage.setItem(LOCAL_DOCS_KEY, JSON.stringify(next));
  } catch (error) {
    console.error("persist local docs failed", error);
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
  const [savedDocs, setSavedDocs] = useState<SavedDoc[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("docs");
  const [activeStyle, setActiveStyle] = useState<ActiveStyle | null>(null);
  const [isDesktop, setIsDesktop] = useState(true);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [autosaveTimeout, setAutosaveTimeout] = useState<NodeJS.Timeout | null>(null);
  const editorRef = useRef<any>(null); // Reference to the TipTap editor instance
  const outputsRef = useRef<WriterOutput[]>(outputs);
  const composeInputRef = useRef<HTMLTextAreaElement>(null);
  const isAuthenticated = !isGuest;

  useEffect(() => {
    outputsRef.current = outputs;
  }, [outputs]);

  const fetchSavedDocs = useCallback(async () => {
    if (!isAuthenticated) {
      console.log("[fetchSavedDocs] Skipping - not authenticated");
      return;
    }
    try {
      console.log("[fetchSavedDocs] Fetching docs...");
      const response = await fetch("/api/documents", { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        console.warn("[fetchSavedDocs] load docs failed", response.status, payload);
        const local = readLocalDocs();
        if (local.length) {
          setSavedDocs(local);
        }
        return;
      }
      const docs = await response.json();
      console.log("[fetchSavedDocs] fetched", docs.length, "documents from API");
      const mapped: SavedDoc[] = (docs as any[]).map((doc) => ({
        id: doc.id,
        title: doc.title ?? "Untitled doc",
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
      console.log("[fetchSavedDocs] mapped documents:", mapped.length);
      const regularDocs = mapped.filter((doc) => !isStyleDocument(doc));
      const styles = mapped.filter((doc) => isStyleDocument(doc));
      console.log("[fetchSavedDocs] classified - docs:", regularDocs.length, "styles:", styles.length);
      console.log("[fetchSavedDocs] sample doc titles:", regularDocs.slice(0, 3).map(d => d.title));
      if (mapped.length) {
        setSavedDocs(mapped);
        console.log("[fetchSavedDocs] Updated savedDocs state with", mapped.length, "documents");
      } else {
        const local = readLocalDocs();
        if (local.length) {
          setSavedDocs(local);
        } else {
          setSavedDocs([]);
        }
      }
    } catch (error) {
      console.error("[fetchSavedDocs] fetch docs error", error);
      const local = readLocalDocs();
      if (local.length) {
        setSavedDocs(local);
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
    const local = readLocalDocs();
    if (local.length) {
      setSavedDocs(local);
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
    fetchSavedDocs();
  }, [fetchSavedDocs]);

  async function handleSubmit() {
    if (!composeValue.trim()) return;
    if (guestLimitEnabled && isGuest && guestLimitReached) {
      setToast("Create a free account to keep writing.");
      return;
    }
    const currentPrompt = composeValue;
    setLoading(true);
    const editorContext = collectEditorContext();

    // If there's a selection, rewrite it instead of creating new content
    if (selectedText && editorRef.current && activeDocument) {
      // Store the selection range before making the API call
      const selectionRange = editorRef.current.getSelectionRange ? editorRef.current.getSelectionRange() : null;
      
      try {
        const response = await fetch("/api/rewrite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selectedText,
            instruction: currentPrompt,
            brandSummary: brandSummary ?? undefined,
            styleGuide: activeStyle
              ? {
                  name: activeStyle.name,
                  description: activeStyle.description
                }
              : undefined
          })
        });

        if (!response.ok) {
          const errorPayload = await response.json().catch(() => null);
          setToast(formatErrorMessage(errorPayload?.error, "Unable to rewrite selection."));
          setLoading(false);
          return;
        }

        const data = await response.json();
        const rewrittenText = data.rewrittenText;

        if (!rewrittenText) {
          setToast("Rewrite returned empty result.");
          setLoading(false);
          return;
        }

        // Replace the exact selection in the editor using the stored range
        if (editorRef.current.replaceSelection) {
          editorRef.current.replaceSelection(rewrittenText, selectionRange || undefined);
        }

        setComposeValue("");
        setSelectedText(null);
        setToast("Selection rewritten successfully.");
        setLoading(false);
        return;
      } catch (error) {
        console.error("Rewrite failed:", error);
        setToast("Failed to rewrite selection. Please try again.");
        setLoading(false);
        return;
      }
    }

    // If there's an active document and editor, insert at cursor position
    if (activeDocument && editorRef.current) {
      try {
        const response = await fetch("/api/compose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: currentPrompt,
            settings: settings,
            brandSummary: brandSummary ?? undefined,
            styleGuide: activeStyle
              ? {
                  name: activeStyle.name,
                  description: activeStyle.description
                }
              : undefined,
            editorContext: editorContext ?? undefined
          })
        });

        if (!response.ok) {
          const errorPayload = await response.json().catch(() => null);
          if (response.status === 403 && guestLimitEnabled && errorPayload?.requireAuth) {
            setGuestLimitReached(true);
            setToast("You've reached the guest limit. Please register to continue.");
          } else {
            setToast(formatErrorMessage(errorPayload?.error));
          }
          setLoading(false);
          return;
        }

        const data = await response.json();
        const newContent = data.content;

        // Insert at cursor position
        if (editorRef.current.insertText) {
          editorRef.current.insertText(newContent);
        } else {
          // Fallback: append to document
          handleDocumentChange(activeDocument.content + "\n\n" + newContent);
        }

        setComposeValue("");
        setToast("Content added at cursor position.");
        setLoading(false);
        return;
      } catch (error) {
        console.error("Insert failed:", error);
        setToast("Failed to insert content. Please try again.");
        setLoading(false);
        return;
      }
    }

    // Original behavior: create new document
    setComposeValue("");
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
          styleGuide: styleGuidePayload,
          editorContext: editorContext ?? undefined
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
      // Set as active document immediately
      setActiveDocumentId(finalId);
      
      // Immediately fetch docs - the document is already saved in the database
      if (data.documentId) {
        // Document was saved to database, fetch docs immediately
        fetchSavedDocs();
        // Also add a retry after a short delay in case of any race condition
        setTimeout(() => {
          fetchSavedDocs();
        }, 1000);
      } else {
        // No documentId means it wasn't saved (guest or error), save locally
        applyLocalDoc({
          id: finalId,
          title: newOutput.title,
          createdAt: newOutput.createdAt,
          prompt: currentPrompt,
          content: data.content,
          settings: newOutput.settings,
          writingStyle: newOutput.writingStyle ?? null
        });
        fetchSavedDocs();
      }
      setToast("Doc ready with guardrails applied.");
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

    const localStyleDoc: SavedDoc = {
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
      applyLocalDoc(localStyleDoc);
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
      applyLocalDoc(localStyleDoc);
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
      applyLocalDoc(localStyleDoc);
      setToast("Saved locally. We'll sync this style once you're connected.");
      return;
    }
    const remoteDoc = payload ?? null;
    const hydratedStyleDoc: SavedDoc = {
      ...localStyleDoc,
      id: remoteDoc?.id ?? localStyleDoc.id,
      createdAt: remoteDoc?.createdAt ?? localStyleDoc.createdAt
    };
    applyLocalDoc(hydratedStyleDoc);
    fetchSavedDocs();
    setToast(`Saved "${styleName}".`);
  }

  const hasOutputs = outputs.length > 0;

  const applyLocalDoc = useCallback((doc: SavedDoc) => {
    persistLocalDocEntry(doc);
    setSavedDocs((prev) => {
      const next = [doc, ...prev.filter((entry) => entry.id !== doc.id)];
      return next.slice(0, 25);
    });
  }, []);

  const { docDocuments, starredDocuments, styleDocuments } = useMemo(() => {
    const docs: SavedDoc[] = [];
    const starred: SavedDoc[] = [];
    const styles: SavedDoc[] = [];
    savedDocs.forEach((doc) => {
      if (doc.starred) {
        starred.push(doc);
      }
      if (isStyleDocument(doc)) {
        styles.push(doc);
      } else {
        docs.push(doc);
      }
    });
    return { docDocuments: docs, starredDocuments: starred, styleDocuments: styles };
  }, [savedDocs]);

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

      // Refresh docs to get updated starred status
      fetchSavedDocs();
    } catch (error) {
      console.error("star network failure", error);
      setToast("Unable to update star status. Please try again.");
    }
  }

  function handleApplyStyle(styleDoc: SavedDoc) {
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

  const resolveDocumentTitle = useCallback((doc: WriterOutput, contentValue: string) => {
    const isStyleEntry =
      Boolean(doc.styleTitle) &&
      typeof doc.title === "string" &&
      doc.title.trim().length > 0 &&
      doc.title === doc.styleTitle;
    if (isStyleEntry) {
      return doc.title || doc.styleTitle || "Custom Style";
    }
    const normalizedContent = contentValue || doc.content || "";
    const fallback = doc.title?.trim() || doc.prompt || "Untitled doc";
    return deriveTitleFromContent(normalizedContent, fallback);
  }, []);

  const collectEditorContext = useCallback(() => {
    const editor = editorRef.current;
    if (!editor?.state) {
      return null;
    }
    try {
      const { state } = editor;
      const { from, to } = state.selection;
      const docSize = state.doc.content.size;
      const beforeStart = Math.max(0, from - EDITOR_CONTEXT_WINDOW);
      const afterEnd = Math.min(docSize, to + EDITOR_CONTEXT_WINDOW);
      const before = state.doc.textBetween(beforeStart, from, "\n").trim();
      const after = state.doc.textBetween(to, afterEnd, "\n").trim();
      const selectionText = from !== to ? state.doc.textBetween(from, to, "\n").trim() : "";

      const payload = {
        before: before || undefined,
        after: after || undefined,
        selection: selectionText || undefined
      };

      if (!payload.before && !payload.after && !payload.selection) {
        return null;
      }
      return payload;
    } catch (error) {
      console.error("collectEditorContext failed", error);
      return null;
    }
  }, []);

  const buildDocumentPayload = useCallback((doc: WriterOutput, contentValue: string) => {
    const settingsPayload = doc.settings ?? defaultSettings;
    const resolvedTitle = resolveDocumentTitle(doc, contentValue);
    return {
      title: resolvedTitle,
      content: contentValue,
      tone: settingsPayload.marketTier ?? null,
      prompt: doc.prompt || "",
      characterLength: settingsPayload.characterLength ?? null,
      wordLength: settingsPayload.wordLength ?? null,
      gradeLevel: settingsPayload.gradeLevel ?? null,
      benchmark: settingsPayload.benchmark ?? null,
      avoidWords: settingsPayload.avoidWords ?? null,
      writingStyle: doc.writingStyle ?? null,
      styleTitle: doc.styleTitle ?? null,
      starred: doc.starred ?? false
    };
  }, [resolveDocumentTitle]);

  const persistDocumentToServer = useCallback(
    async (doc: WriterOutput, contentValue: string) => {
      const resolvedTitle = resolveDocumentTitle(doc, contentValue);
      if (!isAuthenticated) {
        // Guests: save locally
        persistLocalDocEntry({
          id: doc.id,
          title: resolvedTitle,
          createdAt: doc.createdAt,
          prompt: doc.prompt,
          content: contentValue,
          settings: doc.settings,
          writingStyle: doc.writingStyle ?? null,
          styleTitle: doc.styleTitle ?? null,
          starred: doc.starred ?? false
        });
        return doc.id;
      }

      // First try to patch existing document
      if (doc.id) {
        try {
          const patchResponse = await fetch(`/api/documents/${doc.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: contentValue })
          });

          if (patchResponse.ok) {
            return doc.id;
          }

          if (patchResponse.status !== 404) {
            const errorPayload = await patchResponse.json().catch(() => null);
            console.error("Autosave patch failed:", patchResponse.status, errorPayload);
            return null;
          }
        } catch (error) {
          console.error("Autosave patch error:", error);
        }
      }

      // If patch failed (likely 404) or doc has no id, create it
      try {
        const payload = buildDocumentPayload(doc, contentValue);
        const createResponse = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!createResponse.ok) {
          const errorPayload = await createResponse.json().catch(() => null);
          console.error("Document creation failed:", createResponse.status, errorPayload);
          return null;
        }

        const created = await createResponse.json();
        fetchSavedDocs();
        return created.id as string;
      } catch (error) {
        console.error("Document creation error:", error);
        return null;
      }
    },
    [buildDocumentPayload, fetchSavedDocs, isAuthenticated, resolveDocumentTitle]
  );

  // Save current document immediately (without debounce)
  const saveCurrentDocument = useCallback(
    async (documentId: string | null, documentContent: string) => {
      if (!documentId) return;
      const currentDoc = outputsRef.current.find((o) => o.id === documentId);
      if (!currentDoc) return;
      const savedId = await persistDocumentToServer(currentDoc, documentContent);
      if (savedId && savedId !== documentId) {
        setOutputs((prev) =>
          prev.map((entry) => (entry.id === documentId ? { ...entry, id: savedId } : entry))
        );
        setActiveDocumentId(savedId);
      }
    },
    [persistDocumentToServer]
  );

  const handleLoadDoc = useCallback(
    async (doc: SavedDoc) => {
      if (activeDocumentId && activeDocumentId !== doc.id) {
        const currentDoc = outputsRef.current.find((o) => o.id === activeDocumentId);
        if (currentDoc && currentDoc.content.trim()) {
          await saveCurrentDocument(activeDocumentId, currentDoc.content);
        }
      }

      const restored = ensurePlaceholderState({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        createdAt: doc.createdAt,
        settings: doc.settings,
        prompt: doc.prompt,
        writingStyle: doc.writingStyle ?? null,
        placeholderValues: {}
      });

      setOutputs([restored]);
      setActiveDocumentId(doc.id);
      setSelectedText(null);
      setComposeValue("");
      if (!isDesktop) {
        setSidebarOpen(false);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [activeDocumentId, isDesktop, saveCurrentDocument]
  );

  const handleStartNewDoc = useCallback(async () => {
    // Save and close current document if there is one
    if (activeDocumentId) {
      const currentDoc = outputsRef.current.find((o) => o.id === activeDocumentId);
      if (currentDoc && currentDoc.content.trim()) {
        await saveCurrentDocument(activeDocumentId, currentDoc.content);
      }
    }
    
    // Clear existing autosave timeout since we're creating a new doc
    if (autosaveTimeout) {
      clearTimeout(autosaveTimeout);
      setAutosaveTimeout(null);
    }

    // Create a fresh document entry
    let baseDoc: WriterOutput = ensurePlaceholderState({
      id: crypto.randomUUID(),
      title: "Untitled doc",
      content: "",
      createdAt: new Date().toISOString(),
      settings: normalizeSettings(defaultSettings),
      prompt: "",
      writingStyle: null,
      styleTitle: null,
      starred: false
    });

    if (isAuthenticated) {
      const createdId = await persistDocumentToServer(baseDoc, "");
      if (createdId) {
        baseDoc = { ...baseDoc, id: createdId };
      }
    } else {
      persistLocalDocEntry({
        id: baseDoc.id,
        title: baseDoc.title,
        createdAt: baseDoc.createdAt,
        prompt: baseDoc.prompt,
        content: "",
        settings: baseDoc.settings,
        writingStyle: baseDoc.writingStyle
      });
    }
    
    // Close any open docs and open the new one
    setOutputs([baseDoc]);
    setActiveDocumentId(baseDoc.id);
    setSelectedText(null);
    setSidebarTab("docs");
    setSidebarOpen(true);
    setComposeValue("");
    setActiveStyle(null);
    requestAnimationFrame(() => {
      composeInputRef.current?.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, [activeDocumentId, autosaveTimeout, isAuthenticated, persistDocumentToServer, saveCurrentDocument]);

  useEffect(() => {
    const listener = () => handleStartNewDoc();
    window.addEventListener("new-doc", listener);
    return () => window.removeEventListener("new-doc", listener);
  }, [handleStartNewDoc]);

  // Set active document when outputs change
  useEffect(() => {
    if (outputs.length > 0 && !activeDocumentId) {
      setActiveDocumentId(outputs[0].id);
    }
  }, [outputs, activeDocumentId]);

  // Handle document content changes with autosave
  const handleDocumentChange = useCallback(
    (content: string) => {
      if (!activeDocumentId) return;
      
      // Update local state immediately
      setOutputs((prev) =>
        prev.map((output) =>
          output.id === activeDocumentId ? { ...output, content } : output
        )
      );

      // Clear existing autosave timeout
      if (autosaveTimeout) {
        clearTimeout(autosaveTimeout);
      }

      // Set new autosave timeout (debounce for 2 seconds)
      const timeout = setTimeout(async () => {
        const currentDoc = outputsRef.current.find((o) => o.id === activeDocumentId);
        if (!currentDoc) return;

        const savedId = await persistDocumentToServer(currentDoc, content);
        if (savedId && savedId !== activeDocumentId) {
          setOutputs((prev) =>
            prev.map((entry) =>
              entry.id === activeDocumentId ? { ...entry, id: savedId } : entry
            )
          );
          setActiveDocumentId(savedId);
        }
      }, 2000); // 2 second debounce

      setAutosaveTimeout(timeout);
    },
    [activeDocumentId, autosaveTimeout, persistDocumentToServer]
  );

  // Cleanup autosave timeout on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimeout) {
        clearTimeout(autosaveTimeout);
      }
    };
  }, [autosaveTimeout]);

  // Handle selection changes from editor
  const handleSelectionChange = useCallback((text: string | null) => {
    setSelectedText(text);
  }, []);

  // Store editor reference when ready
  const handleEditorReady = useCallback((editor: any) => {
    editorRef.current = editor;
  }, []);

  // Handle selection-based rewriting
  const handleRewriteSelection = useCallback(async (selectedText: string, instruction: string) => {
    if (!activeDocumentId) return;

    try {
      const response = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedText,
          instruction,
          brandSummary: brandSummary ?? undefined,
          styleGuide: activeStyle
            ? {
                name: activeStyle.name,
                description: activeStyle.description
              }
            : undefined
        })
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        setToast(formatErrorMessage(errorPayload?.error, "Unable to rewrite selection."));
        return;
      }

      const data = await response.json();
      const rewrittenText = data.rewrittenText;

      if (!rewrittenText) {
        setToast("Rewrite returned empty result.");
        return;
      }

      // Update the document content by replacing the selected text
      // Note: This is a simple string replace. For more complex scenarios,
      // we could pass the editor instance and use its selection API
      const currentOutput = outputs.find((o) => o.id === activeDocumentId);
      if (currentOutput) {
        // Find and replace the first occurrence of the selected text
        const index = currentOutput.content.indexOf(selectedText);
        if (index !== -1) {
          const updatedContent =
            currentOutput.content.slice(0, index) +
            rewrittenText +
            currentOutput.content.slice(index + selectedText.length);
          handleDocumentChange(updatedContent);
          setToast("Selection rewritten successfully.");
        } else {
          setToast("Could not find selected text in document.");
        }
      }
    } catch (error) {
      console.error("Rewrite failed:", error);
      setToast("Failed to rewrite selection. Please try again.");
    }
  }, [activeDocumentId, brandSummary, activeStyle, outputs, handleDocumentChange]);

  // Get the active document
  const activeDocument = useMemo(() => {
    return activeDocumentId ? outputs.find((o) => o.id === activeDocumentId) ?? null : null;
  }, [activeDocumentId, outputs]);

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
          docs={docDocuments}
          starred={starredDocuments}
          styles={styleDocuments}
          brandSummary={brandSummary}
          hasBrand={hasBrand}
          userName={user.name}
          topOffset={88}
          bottomOffset={hasOutputs ? 140 : 32}
          isDesktop={isDesktop}
          activeStyleId={activeStyle?.id}
          onSelect={handleLoadDoc}
              onToggle={() => setSidebarOpen((prev) => !prev)}
          onOpen={() => setSidebarOpen(true)}
          onApplyStyle={handleApplyStyle}
          onTabChange={(tab) => setSidebarTab(tab)}
        />
      )}
      <div className="flex min-h-screen flex-1 flex-col pb-32">
        <div className="flex-1 px-4 py-8 sm:px-6">
          <div className="mx-auto w-full max-w-5xl">
            {guestLimitEnabled && isGuest && guestLimitReached && <RegisterGate />}
            <DocumentEditor
              document={activeDocument}
              onDocumentChange={handleDocumentChange}
              onSelectionChange={handleSelectionChange}
              onEditorReady={handleEditorReady}
              loading={loading && activeDocument?.isPending}
              brandSummary={brandSummary}
              styleGuide={activeStyle ? { name: activeStyle.name, description: activeStyle.description } : null}
            />
          </div>
        </div>
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
              hasSelection={!!selectedText}
              selectedText={selectedText}
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
  docs: SavedDoc[];
  starred: SavedDoc[];
  styles: SavedDoc[];
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
  onSelect: (doc: SavedDoc) => void;
  onApplyStyle: (style: SavedDoc) => void;
};

function WorkspaceSidebar({
  open,
  activeTab,
  docs,
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
    { id: "docs", label: "Docs", icon: "draft" },
    { id: "starred", label: "Starred", icon: "star" },
    { id: "styles", label: "Styles", icon: "brand_family" },
    { id: "brands", label: "Brands", icon: "storefront" }
  ];

  function renderDocList(items: SavedDoc[], emptyLabel: string) {
    if (!items.length) {
      return <p className="text-sm text-brand-muted">{emptyLabel}</p>;
    }
  return (
      <ul className="space-y-3 pr-2">
        {items.map((doc) => (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(doc)}
              className="w-full rounded-2xl border border-brand-stroke/40 bg-brand-background/60 px-3 py-3 text-left transition hover:border-white"
                    >
                      <p className="text-sm font-semibold text-white">{doc.title || "Untitled doc"}</p>
                      <p className="text-xs text-brand-muted">{formatTimestamp(doc.createdAt)}</p>
                    </button>
                  </li>
                ))}
              </ul>
    );
  }

  function renderStyleList(items: SavedDoc[]) {
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
    if (activeTab === "docs") {
      return renderDocList(docs, "No docs yet. Generate something to see it here.");
    }
    if (activeTab === "starred") {
      return renderDocList(starred, "No starred items yet. Star docs to see them here.");
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

function isStyleDocument(doc: SavedDoc): boolean {
  // A document is a style ONLY if:
  // 1. The title ends with " Style" (capital S)
  // 2. AND the styleTitle matches the title (meaning it was explicitly saved as a style)
  // Regular docs have styleTitle (AI-generated) but their title is from the prompt, so they won't match
  const title = doc.title ?? "";
  const styleTitle = doc.styleTitle ?? "";
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

