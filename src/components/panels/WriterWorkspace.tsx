"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { Tab } from "@headlessui/react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { ArrowRightOnRectangleIcon } from "@heroicons/react/24/outline";
import NextImage from "next/image";
import DocumentEditor from "../editors/DocumentEditor";
import ComposeBar from "../forms/ComposeBar";
import SettingsSheet from "../modals/SettingsSheet";
import { ComposerSettingsInput } from "@/lib/validators";
import { FolderSummary, OutputPlaceholder, WriterOutput } from "@/types/writer";
import { cn, formatTimestamp, smartTitleFromPrompt, deriveTitleFromContent, generateDownloadFilename, addPromptToHistory } from "@/lib/utils";

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
  lastEditedAt?: string;
  prompt: string;
  content: string;
  settings: ComposerSettingsInput;
  writingStyle?: string | null;
  styleTitle?: string | null;
  pinned?: boolean;
};

type SidebarTab = "docs" | "styles" | "brands";

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
        lastEditedAt:
          typeof safeEntry.lastEditedAt === "string"
            ? safeEntry.lastEditedAt
            : typeof safeEntry.createdAt === "string"
              ? safeEntry.createdAt
              : new Date().toISOString(),
        prompt: typeof safeEntry.prompt === "string" ? safeEntry.prompt : "",
        content: typeof safeEntry.content === "string" ? safeEntry.content : "",
        settings: normalizeSettings(safeEntry.settings ?? {}),
        writingStyle:
          typeof safeEntry.writingStyle === "string"
            ? safeEntry.writingStyle
            : safeEntry.writingStyle ?? null,
        styleTitle:
          typeof safeEntry.styleTitle === "string"
            ? safeEntry.styleTitle
            : safeEntry.styleTitle ?? null,
        pinned: typeof safeEntry.pinned === "boolean" ? safeEntry.pinned : false
      });
    }
    return sortSavedDocs(docs).slice(0, 25);
  } catch (error) {
    console.error("read local docs failed", error);
    return [];
  }
}

function persistLocalDocEntry(doc: SavedDoc) {
  if (!canUseLocalStorage()) return;
  try {
    const existing = readLocalDocs();
    const next = [
      { ...doc, lastEditedAt: doc.lastEditedAt ?? doc.createdAt, pinned: doc.pinned ?? false },
      ...existing.filter((entry) => entry.id !== doc.id)
    ]
      .slice(0, 25);
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

function sortSavedDocs(docs: SavedDoc[]): SavedDoc[] {
  return [...docs].sort((a, b) => {
    const aPinned = Boolean(a.pinned);
    const bPinned = Boolean(b.pinned);
    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }
    const aTime = new Date(a.lastEditedAt ?? a.createdAt).getTime();
    const bTime = new Date(b.lastEditedAt ?? b.createdAt).getTime();
    return bTime - aTime;
  });
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
  // Always start with a blank document - don't load previous documents on initial load
  const [outputs, setOutputs] = useState<WriterOutput[]>(() => {
    const blankDoc: WriterOutput = ensurePlaceholderState({
      id: crypto.randomUUID(),
      title: "Untitled doc",
      content: "",
      createdAt: new Date().toISOString(),
      settings: normalizeSettings(defaultSettings),
      prompt: "",
      writingStyle: null,
      styleTitle: null
    });
    return [blankDoc];
  });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetAnchor, setSheetAnchor] = useState<DOMRect | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [guestLimitReached, setGuestLimitReached] = useState(false);
  const [hasBrand, setHasBrand] = useState(false);
  const [brandSummary, setBrandSummary] = useState<string | null>(null);
  const [brandKeyMessaging, setBrandKeyMessaging] = useState<Array<{ id: string; text: string; createdAt: string }>>([]);
  const [savedDocs, setSavedDocs] = useState<SavedDoc[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("docs");
  const [activeStyle, setActiveStyle] = useState<ActiveStyle | null>(null);
  const [isDesktop, setIsDesktop] = useState(true);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [autosaveTimeout, setAutosaveTimeout] = useState<NodeJS.Timeout | null>(null);
  const [titleAutosaveTimeout, setTitleAutosaveTimeout] = useState<NodeJS.Timeout | null>(null);
  const editorRef = useRef<any>(null); // Reference to the TipTap editor instance
  const outputsRef = useRef<WriterOutput[]>(outputs);
  const savedDocsRef = useRef<SavedDoc[]>([]);
  const composeInputRef = useRef<HTMLTextAreaElement>(null);
  const isAuthenticated = !isGuest;

  useEffect(() => {
    outputsRef.current = outputs;
  }, [outputs]);

  useEffect(() => {
    savedDocsRef.current = savedDocs;
  }, [savedDocs]);

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
        console.error("[fetchSavedDocs] Failed to load docs from database:", {
          status: response.status,
          error: payload?.error || "Unknown error"
        });
        setSavedDocs([]);
        return;
      }
      const docs = await response.json();
      console.log("[fetchSavedDocs] fetched", docs.length, "documents from API");
      const mapped: SavedDoc[] = (docs as any[]).map((doc) => {
        const existing = savedDocsRef.current.find((entry) => entry.id === doc.id);
        return {
          id: doc.id,
          title: doc.title ?? "Untitled doc",
          createdAt: doc.createdAt ?? new Date().toISOString(),
          lastEditedAt: existing?.lastEditedAt ?? doc.updatedAt ?? doc.createdAt ?? new Date().toISOString(),
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
          pinned: typeof doc.pinned === "boolean" ? doc.pinned : existing?.pinned ?? false
        };
      });
      console.log("[fetchSavedDocs] mapped documents:", mapped.length);
      const regularDocs = mapped.filter((doc) => !isStyleDocument(doc));
      const styles = mapped.filter((doc) => isStyleDocument(doc));
      console.log("[fetchSavedDocs] classified - docs:", regularDocs.length, "styles:", styles.length);
      console.log("[fetchSavedDocs] sample doc titles:", regularDocs.slice(0, 3).map(d => d.title));
      setSavedDocs(sortSavedDocs(mapped));
      console.log("[fetchSavedDocs] Updated savedDocs state with", mapped.length, "documents");
    } catch (error) {
      console.error("[fetchSavedDocs] Failed to fetch docs:", error);
      setSavedDocs([]);
    }
  }, [isAuthenticated]);

  const fetchFolders = useCallback(async () => {
    if (!isAuthenticated) {
      setFolders([]);
      return;
    }
    try {
      const response = await fetch("/api/folders", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setFolders([]);
        } else {
          console.warn("[fetchFolders] failed", response.status);
        }
        return;
      }
      const data = await response.json().catch(() => []);
      if (Array.isArray(data)) {
        setFolders(
          data.map((folder) => ({
            id: folder.id,
            name: folder.name ?? "Untitled folder",
            createdAt: folder.createdAt ?? new Date().toISOString(),
            documentCount: typeof folder.documentCount === "number" ? folder.documentCount : 0
          }))
        );
      } else {
        setFolders([]);
      }
    } catch (error) {
      console.error("[fetchFolders] failed", error);
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
      setSavedDocs(sortSavedDocs(local));
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

  // Fetch brand key messaging items
  const fetchBrandKeyMessaging = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const response = await fetch("/api/brand/key-messaging");
      if (response.ok) {
        const data = await response.json();
        setBrandKeyMessaging(data.items || []);
      }
    } catch (error) {
      console.error("Failed to fetch brand key messaging items", error);
    }
  }, [isAuthenticated]);

  // Fetch key messaging items on mount and when brands tab is opened
  useEffect(() => {
    if (isAuthenticated && sidebarTab === "brands") {
      fetchBrandKeyMessaging();
    }
  }, [isAuthenticated, sidebarTab, fetchBrandKeyMessaging]);

  // Listen for new items being added
  useEffect(() => {
    const handleBrandKeyMessagingAdded = () => {
      fetchBrandKeyMessaging();
    };
    window.addEventListener("brand-key-messaging-added", handleBrandKeyMessagingAdded);
    return () => {
      window.removeEventListener("brand-key-messaging-added", handleBrandKeyMessagingAdded);
    };
  }, [fetchBrandKeyMessaging]);

  // Handle removing a key messaging item
  const handleRemoveKeyMessaging = useCallback(async (id: string) => {
    if (!isAuthenticated) return;
    try {
      const response = await fetch(`/api/brand/key-messaging?id=${id}`, {
        method: "DELETE"
      });
      if (response.ok) {
        await fetchBrandKeyMessaging();
      } else {
        console.error("Failed to remove key messaging item");
      }
    } catch (error) {
      console.error("Error removing key messaging item", error);
    }
  }, [isAuthenticated, fetchBrandKeyMessaging]);

  useEffect(() => {
    fetchSavedDocs();
  }, [fetchSavedDocs]);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  async function handleSubmit() {
    if (!composeValue.trim()) return;
    if (guestLimitEnabled && isGuest && guestLimitReached) {
      setToast("Create a free account to keep writing.");
      return;
    }
    const currentPrompt = composeValue;
    
    // Add prompt to history
    addPromptToHistory(currentPrompt);
    
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
      // Check if the document is untitled and needs to be saved first
      const isUntitled = !activeDocument.title || activeDocument.title.trim() === "" || activeDocument.title.toLowerCase() === "untitled doc";
      const isSaved = isAuthenticated && savedDocsRef.current.find(d => d.id === activeDocument.id);
      const needsSaving = isUntitled && isAuthenticated && !isSaved;
      
      let documentIdToUse = activeDocument.id;
      
      // If untitled and not saved, save it first
      if (needsSaving) {
        const currentContent = activeDocument.content || "";
        const savedId = await persistDocumentToServer(activeDocument, currentContent);
        if (savedId && savedId !== activeDocument.id) {
          // Update the active document ID
          setOutputs((prev) =>
            prev.map((entry) =>
              entry.id === activeDocument.id ? { ...entry, id: savedId } : entry
            )
          );
          setActiveDocumentId(savedId);
          documentIdToUse = savedId;
          // Refresh saved docs to include the newly saved document
          await fetchSavedDocs();
        } else if (savedId) {
          documentIdToUse = savedId;
        }
      }
      
      // Include documentId in editorContext so compose API can update instead of create
      const editorContextWithDocId = {
        ...editorContext,
        documentId: documentIdToUse
      };
      
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
            editorContext: editorContextWithDocId ?? undefined
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
    const filename = generateDownloadFilename(output.title, resolved, "docx");
    link.download = filename;
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
      lastEditedAt: new Date().toISOString(),
      prompt: output.prompt ?? "",
      content: resolvedContent,
      settings: normalizeSettings(output.settings),
      writingStyle: description,
      styleTitle: styleName,
      pinned: false
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
      createdAt: remoteDoc?.createdAt ?? localStyleDoc.createdAt,
      lastEditedAt: remoteDoc?.updatedAt ?? remoteDoc?.createdAt ?? localStyleDoc.lastEditedAt,
      pinned: localStyleDoc.pinned ?? false
    };
    applyLocalDoc(hydratedStyleDoc);
    fetchSavedDocs();
    setToast(`Saved "${styleName}".`);
  }

  const hasOutputs = outputs.length > 0;

  const applyLocalDoc = useCallback((doc: SavedDoc) => {
    persistLocalDocEntry(doc);
    setSavedDocs((prev) => {
      const normalizedDoc = { ...doc, lastEditedAt: doc.lastEditedAt ?? doc.createdAt };
      const next = [normalizedDoc, ...prev.filter((entry) => entry.id !== doc.id)];
      return sortSavedDocs(next).slice(0, 25);
    });
  }, []);

  const bumpSavedDoc = useCallback(
    (docId: string, transform?: (doc: SavedDoc) => SavedDoc) => {
      setSavedDocs((prev) => {
        const index = prev.findIndex((doc) => doc.id === docId);
        if (index === -1) {
          return prev;
        }
        const target = prev[index];
        const transformed = transform ? transform(target) : target;
        const updatedDoc: SavedDoc = {
          ...transformed,
          lastEditedAt: new Date().toISOString()
        };
        const next = [updatedDoc, ...prev.slice(0, index), ...prev.slice(index + 1)];
        return sortSavedDocs(next);
      });
    },
    []
  );

  const { docDocuments, styleDocuments } = useMemo(() => {
    const docs: SavedDoc[] = [];
    const styles: SavedDoc[] = [];
    savedDocs.forEach((doc) => {
      if (isStyleDocument(doc)) {
        styles.push(doc);
      } else {
        docs.push(doc);
      }
    });
    return { docDocuments: docs, styleDocuments: styles };
  }, [savedDocs]);

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
      const { state, view } = editor;
      const { from, to } = state.selection;
      const docSize = state.doc.content.size;
      const beforeStart = Math.max(0, from - EDITOR_CONTEXT_WINDOW);
      const afterEnd = Math.min(docSize, to + EDITOR_CONTEXT_WINDOW);
      
      // Helper function to convert HTML to markdown
      const htmlToMarkdown = (html: string): string => {
        if (!html) return '';
        const tempDiv = window.document.createElement('div');
        tempDiv.innerHTML = html;
        
        function convertNode(node: Node): string {
          if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent || '';
          }
          
          if (node.nodeType !== Node.ELEMENT_NODE) {
            return '';
          }
          
          const el = node as HTMLElement;
          const tagName = el.tagName.toLowerCase();
          const children = Array.from(el.childNodes).map(convertNode).join('');
          
          switch (tagName) {
            case 'h1': return `# ${children}\n\n`;
            case 'h2': return `## ${children}\n\n`;
            case 'h3': return `### ${children}\n\n`;
            case 'h4': return `#### ${children}\n\n`;
            case 'h5': return `##### ${children}\n\n`;
            case 'h6': return `###### ${children}\n\n`;
            case 'p': return `${children}\n\n`;
            case 'strong':
            case 'b': return `**${children}**`;
            case 'em':
            case 'i': return `*${children}*`;
            case 'code': return `\`${children}\``;
            case 'pre': return `\`\`\`\n${children}\n\`\`\`\n\n`;
            case 'ul': return `${children}\n`;
            case 'ol': return `${children}\n`;
            case 'li': return `- ${children}\n`;
            case 'br': return '\n';
            case 'blockquote': return `> ${children}\n\n`;
            default: return children;
          }
        }
        
        return Array.from(tempDiv.childNodes)
          .map(convertNode)
          .join('')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      };
      
      // Get slices for each range
      const beforeSlice = state.doc.slice(beforeStart, from);
      const afterSlice = state.doc.slice(to, afterEnd);
      const selectionSlice = from !== to ? state.doc.slice(from, to) : null;
      
      // Use ProseMirror's DOMSerializer to serialize slices to HTML
      let beforeHtml = '';
      let afterHtml = '';
      let selectionHtml = '';
      
      try {
        // Access DOMSerializer from ProseMirror (available via TipTap)
        // @ts-ignore - DOMSerializer is available on the schema
        const serializer = view.state.schema.cached.domSerializer || (() => {
          // Create serializer if not cached
          const { DOMSerializer } = require('@tiptap/pm/model');
          return DOMSerializer.fromSchema(state.schema);
        })();
        
        if (beforeSlice && beforeSlice.content.size > 0) {
          const fragment = serializer.serializeFragment(beforeSlice.content, { document: window.document });
          beforeHtml = Array.from(fragment.childNodes)
            .map((node: any) => node.outerHTML || node.textContent || '')
            .join('');
        }
        
        if (afterSlice && afterSlice.content.size > 0) {
          const fragment = serializer.serializeFragment(afterSlice.content, { document: window.document });
          afterHtml = Array.from(fragment.childNodes)
            .map((node: any) => node.outerHTML || node.textContent || '')
            .join('');
        }
        
        if (selectionSlice && selectionSlice.content.size > 0) {
          const fragment = serializer.serializeFragment(selectionSlice.content, { document: window.document });
          selectionHtml = Array.from(fragment.childNodes)
            .map((node: any) => node.outerHTML || node.textContent || '')
            .join('');
        }
      } catch (serializeError) {
        // Fallback to plain text if serialization fails
        console.warn("Failed to serialize to HTML, using plain text", serializeError);
        const before = state.doc.textBetween(beforeStart, from, "\n").trim();
        const after = state.doc.textBetween(to, afterEnd, "\n").trim();
        const selectionText = from !== to ? state.doc.textBetween(from, to, "\n").trim() : "";
        return {
          before: before || undefined,
          after: after || undefined,
          selection: selectionText || undefined
        };
      }
      
      // Convert HTML to markdown
      const before = beforeHtml ? htmlToMarkdown(beforeHtml).trim() : '';
      const after = afterHtml ? htmlToMarkdown(afterHtml).trim() : '';
      const selectionText = selectionHtml ? htmlToMarkdown(selectionHtml).trim() : "";

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
      // Fallback to plain text on error
      try {
        const { state } = editor;
        const { from, to } = state.selection;
        const docSize = state.doc.content.size;
        const beforeStart = Math.max(0, from - EDITOR_CONTEXT_WINDOW);
        const afterEnd = Math.min(docSize, to + EDITOR_CONTEXT_WINDOW);
        const before = state.doc.textBetween(beforeStart, from, "\n").trim();
        const after = state.doc.textBetween(to, afterEnd, "\n").trim();
        const selectionText = from !== to ? state.doc.textBetween(from, to, "\n").trim() : "";
        return {
          before: before || undefined,
          after: after || undefined,
          selection: selectionText || undefined
        };
      } catch (fallbackError) {
        return null;
      }
    }
  }, []);

  const buildDocumentPayload = useCallback((doc: WriterOutput, contentValue: string) => {
    const settingsPayload = doc.settings ?? defaultSettings;
    const resolvedTitle = resolveDocumentTitle(doc, contentValue);
    const payload: any = {
      title: resolvedTitle,
      content: contentValue
    };
    
    // Only include fields that have values (omit null/undefined)
    if (settingsPayload.marketTier) payload.tone = settingsPayload.marketTier;
    if (doc.prompt) payload.prompt = doc.prompt;
    if (settingsPayload.characterLength !== null && settingsPayload.characterLength !== undefined) {
      payload.characterLength = settingsPayload.characterLength;
    }
    if (settingsPayload.wordLength !== null && settingsPayload.wordLength !== undefined) {
      payload.wordLength = settingsPayload.wordLength;
    }
    if (settingsPayload.gradeLevel) payload.gradeLevel = settingsPayload.gradeLevel;
    if (settingsPayload.benchmark) payload.benchmark = settingsPayload.benchmark;
    if (settingsPayload.avoidWords) payload.avoidWords = settingsPayload.avoidWords;
    if (doc.writingStyle) payload.writingStyle = doc.writingStyle;
    if (doc.styleTitle) payload.styleTitle = doc.styleTitle;
    
    // Include pinned status from savedDocs if available
    const savedDoc = savedDocsRef.current.find((saved) => saved.id === doc.id);
    if (savedDoc && typeof savedDoc.pinned === 'boolean') {
      payload.pinned = savedDoc.pinned;
      console.log("[buildDocumentPayload] Including pinned status:", {
        documentId: doc.id,
        pinned: savedDoc.pinned
      });
    } else {
      console.log("[buildDocumentPayload] No pinned status found for document:", {
        documentId: doc.id,
        savedDocFound: !!savedDoc
      });
    }
    
    return payload;
  }, [resolveDocumentTitle]);

  const persistDocumentToServer = useCallback(
    async (doc: WriterOutput, contentValue: string) => {
      // Don't save documents with empty content
      if (!contentValue || !contentValue.trim()) {
        return null;
      }
      
      const resolvedTitle = resolveDocumentTitle(doc, contentValue);
      if (!isAuthenticated) {
        // Guests: save locally
        persistLocalDocEntry({
          id: doc.id,
          title: resolvedTitle,
          createdAt: doc.createdAt,
          lastEditedAt: new Date().toISOString(),
          prompt: doc.prompt,
          content: contentValue,
          settings: doc.settings,
          writingStyle: doc.writingStyle ?? null,
          styleTitle: doc.styleTitle ?? null,
          pinned: doc.pinned ?? false
        });
        return doc.id;
      }

      // First try to patch existing document
      if (doc.id) {
        try {
          // Include pinned status in patch if available
          const savedDoc = savedDocsRef.current.find((saved) => saved.id === doc.id);
          const patchData: any = { content: contentValue };
          if (savedDoc && typeof savedDoc.pinned === 'boolean') {
            patchData.pinned = savedDoc.pinned;
          }
          
          const patchResponse = await fetch(`/api/documents/${doc.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patchData)
          });

          if (patchResponse.ok) {
            // Update lastEditedAt in local state from server response
            try {
              const updatedDoc = await patchResponse.json();
              if (updatedDoc?.updatedAt) {
                setSavedDocs((prev) => {
                  const next = prev.map((entry) =>
                    entry.id === doc.id
                      ? { ...entry, lastEditedAt: updatedDoc.updatedAt }
                      : entry
                  );
                  return sortSavedDocs(next);
                });
              }
            } catch (e) {
              // If JSON parsing fails, just continue - timestamp will update on next fetch
              console.warn("[persistDocumentToServer] Failed to parse patch response", e);
            }
            return doc.id;
          }

          if (patchResponse.status !== 404) {
            const errorPayload = await patchResponse.json().catch(() => null);
            const isExpectedLocalFallback =
              patchResponse.status === 503 ||
              (typeof errorPayload?.error === "string" &&
                /document storage is disabled|database connection failed/i.test(errorPayload.error));
            if (isExpectedLocalFallback) {
              console.info("[persistDocumentToServer] Server unavailable; saving locally (patch).", {
                status: patchResponse.status
              });
            } else {
              console.warn("Autosave patch failed:", patchResponse.status, errorPayload);
            }
            // Database error - return null to indicate failure
            console.error("[persistDocumentToServer] Patch failed, not saving locally:", {
              status: patchResponse.status,
              documentId: doc.id
            });
            return null;
          }
        } catch (error) {
          console.error("Autosave patch error:", error);
        }
      }

      // If patch failed (likely 404) or doc has no id, create it
      try {
        const payload = buildDocumentPayload(doc, contentValue);
        
        // Validate payload before sending
        if (!payload.title || payload.title.trim().length === 0) {
          console.error("Document creation failed: empty title", { payload, doc, contentValue });
          return null;
        }
        
        console.log("[persistDocumentToServer] Creating document with payload:", {
          title: payload.title,
          contentLength: payload.content?.length,
          hasPrompt: !!payload.prompt,
          pinned: payload.pinned,
          keys: Object.keys(payload)
        });
        
        const createResponse = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!createResponse.ok) {
          let errorPayload: any = null;
          let errorText: string = "";
          
          // Try to get response text first
          const contentType = createResponse.headers.get("content-type");
          let responseText = "";
          
          try {
            responseText = await createResponse.text();
          } catch (textError) {
            console.error("Failed to read response text", textError);
            responseText = "Unable to read response";
          }
          
          // Log raw response for debugging
          console.log("[persistDocumentToServer] Error response:", {
            status: createResponse.status,
            statusText: createResponse.statusText,
            contentType,
            responseTextLength: responseText.length,
            responseTextPreview: responseText.substring(0, 500)
          });
          
          if (contentType?.includes("application/json") && responseText) {
            try {
              errorPayload = JSON.parse(responseText);
              // Check if errorPayload is meaningful (not empty object)
              if (errorPayload && typeof errorPayload === "object" && Object.keys(errorPayload).length === 0) {
                errorPayload = null;
                errorText = responseText || "Empty error response";
              }
            } catch (e) {
              console.error("Failed to parse error JSON", e);
              errorText = responseText;
            }
          } else {
            errorText = responseText || "No error message available";
          }
          
          const errorMessage = errorPayload?.error || errorPayload?.message || errorPayload?.details || errorText || `HTTP ${createResponse.status}: ${createResponse.statusText}`;
          
          const isExpectedLocalFallback =
            createResponse.status === 503 ||
            /document storage is disabled|database connection failed/i.test(errorMessage);
          const logDetails = {
            status: createResponse.status,
            statusText: createResponse.statusText,
            error: errorMessage,
            errorPayload: errorPayload && Object.keys(errorPayload).length > 0 ? errorPayload : undefined,
            errorText: errorText || undefined,
            payloadSize: JSON.stringify(payload).length,
            title: payload.title,
            contentLength: payload.content?.length,
            payloadKeys: Object.keys(payload),
            contentType,
            responseText: responseText.substring(0, 500)
          };
          // Database error - show error and return null
          console.error("[persistDocumentToServer] Document creation failed:", logDetails);
          const errorMsg = formatErrorMessage(errorMessage, "Failed to save document to database.");
          setToast(errorMsg);
          return null;
        }

        const responseText = await createResponse.text();
        if (!responseText) {
          console.error("[persistDocumentToServer] Document creation failed: empty response");
          setToast("Failed to save document: Empty response from server.");
          return null;
        }
        
        let created: any;
        try {
          created = JSON.parse(responseText);
        } catch (e) {
          console.error("[persistDocumentToServer] Document creation failed: invalid JSON response", { responseText });
          setToast("Failed to save document: Invalid response from server.");
          return null;
        }
        
        if (!created?.id) {
          console.error("[persistDocumentToServer] Document creation failed: no ID in response", { created });
          setToast("Failed to save document: No document ID returned from server.");
          return null;
        }
        
        fetchSavedDocs();
        return created.id as string;
      } catch (error) {
        console.error("[persistDocumentToServer] Document creation error:", error);
        if (error instanceof Error) {
          console.error("Error details:", {
            message: error.message,
            stack: error.stack,
            name: error.name
          });
          setToast(`Failed to save document: ${error.message}`);
        } else {
          setToast("Failed to save document: Unknown error.");
        }
        return null;
      }
    },
    [buildDocumentPayload, fetchSavedDocs, isAuthenticated, resolveDocumentTitle]
  );

  // Save current document immediately (without debounce)
  const saveCurrentDocument = useCallback(
    async (documentId: string | null, documentContent: string) => {
      if (!documentId) return null;
      const currentDoc = outputsRef.current.find((o) => o.id === documentId);
      if (!currentDoc) return null;
      const savedId = await persistDocumentToServer(currentDoc, documentContent);
      if (savedId && savedId !== documentId) {
        setOutputs((prev) =>
          prev.map((entry) => (entry.id === documentId ? { ...entry, id: savedId } : entry))
        );
        setActiveDocumentId(savedId);
        return savedId;
      }
      return documentId;
    },
    [persistDocumentToServer]
  );

  const assignDocumentToFolder = useCallback(
    async (folderId: string, options?: { folderName?: string }) => {
      if (!isAuthenticated) {
        setToast("Sign in to organize documents into folders.");
        return;
      }
      if (!activeDocumentId) {
        setToast("Open a document before adding it to a folder.");
        return;
      }

      const currentDoc = outputsRef.current.find((o) => o.id === activeDocumentId);
      if (!currentDoc) {
        setToast("Document is still loading.");
        return;
      }

      const latestId = await saveCurrentDocument(activeDocumentId, currentDoc.content);
      const resolvedDocumentId = latestId ?? activeDocumentId;
      if (!resolvedDocumentId) {
        setToast("Save the document before adding it to a folder.");
        return;
      }

      try {
        const response = await fetch("/api/folders/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folderId,
            documentId: resolvedDocumentId
          })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setToast(formatErrorMessage(payload?.error, "Unable to add document to folder."));
          return;
        }

        const folderName =
          options?.folderName ||
          payload?.folder?.name ||
          folders.find((folder) => folder.id === folderId)?.name ||
          "folder";
        setToast(`Added to ${folderName}.`);
        fetchFolders();
      } catch (error) {
        console.error("assign document to folder failed:", error);
        setToast("Unable to add document to folder.");
      }
    },
    [activeDocumentId, fetchFolders, folders, isAuthenticated, saveCurrentDocument]
  );

  const handleAddToFolder = useCallback(
    (folderId: string) => {
      void assignDocumentToFolder(folderId);
    },
    [assignDocumentToFolder]
  );

  const handlePinDocument = useCallback(
    async (doc: SavedDoc) => {
      const newPinnedState = !doc.pinned;
      const title = doc.title?.trim() || "Untitled doc";
      
      // Update local state immediately for instant UI feedback
      setSavedDocs((prev) => {
        const next = prev.map((entry) =>
          entry.id === doc.id ? { ...entry, pinned: newPinnedState } : entry
        );
        return sortSavedDocs(next);
      });
      
      // Persist to local storage for guests only
      if (!isAuthenticated) {
        const updatedDoc = { ...doc, pinned: newPinnedState };
        persistLocalDocEntry(updatedDoc);
        return;
      }
      
      // Persist to database for authenticated users
      try {
        const response = await fetch(`/api/documents/${doc.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinned: newPinnedState })
        });
        
        if (response.ok) {
          const updatedDocFromServer = await response.json().catch(() => null);
          console.log("[PIN SUCCESS] Pin status saved to database:", {
            documentId: doc.id,
            pinned: newPinnedState,
            serverResponse: updatedDocFromServer
          });
          // Refresh saved docs from database to ensure consistency
          await fetchSavedDocs();
        } else {
          // Get error details from response
          const status = response?.status ?? 0;
          const statusText = response?.statusText ?? 'Unknown error';
          let errorMessage = `HTTP ${status}: ${statusText}`;
          
          console.log("[PIN ERROR] Starting error handling. Status:", status, "StatusText:", statusText);
          
          try {
            // Try to get error details from response
            const errorPayload = await response.json().catch(async () => {
              // If JSON parsing fails, try text
              try {
                const text = await response.text();
                return { rawText: text };
              } catch {
                return null;
              }
            });
            
            console.log("[PIN ERROR] Error payload:", errorPayload);
            
            if (errorPayload) {
              if (typeof errorPayload === 'object' && errorPayload !== null) {
                const extractedError = errorPayload.error || errorPayload.details || errorPayload.message || errorPayload.rawText;
                if (typeof extractedError === 'string' && extractedError.trim().length > 0) {
                  errorMessage = extractedError;
                } else if (extractedError) {
                  errorMessage = String(extractedError);
                }
              } else if (typeof errorPayload === 'string') {
                errorMessage = errorPayload;
              }
            }
          } catch (e) {
            console.log("[PIN ERROR] Exception reading response:", e);
            // Keep default errorMessage
          }
          
          // Final safety check - ensure errorMessage is always a non-empty string
          if (typeof errorMessage !== 'string' || !errorMessage.trim()) {
            errorMessage = `HTTP ${status}: ${statusText || 'Unknown error'}`;
          }
          
          // Only revert on auth errors - for other errors, keep the optimistic update and local storage
          if (response.status === 401 || response.status === 403) {
            // Log auth errors as actual errors
            console.error("[PIN ERROR] Authentication failed:", {
              status,
              statusText,
              error: errorMessage,
              documentId: doc?.id
            });
            
            // Revert on auth error
            setSavedDocs((prev) => {
              const next = prev.map((entry) =>
                entry.id === doc.id ? { ...entry, pinned: doc.pinned } : entry
              );
              return sortSavedDocs(next);
            });
            setToast(`Failed to update pin status: ${errorMessage}`);
          } else {
            // Revert optimistic update on any database error for authenticated users
            setSavedDocs((prev) => {
              const next = prev.map((entry) =>
                entry.id === doc.id ? { ...entry, pinned: doc.pinned } : entry
              );
              return sortSavedDocs(next);
            });
            
            if (response.status === 404) {
              console.error("[PIN ERROR] Document not in database:", {
                documentId: doc?.id,
                title,
                error: errorMessage
              });
              setToast(`Failed to pin: Document not saved to database yet. Save the document first.`);
            } else {
              console.error("[PIN ERROR] Database update failed:", {
                status,
                statusText,
                error: errorMessage,
                documentId: doc?.id
              });
              setToast(`Failed to update pin status: ${errorMessage}`);
            }
          }
        }
      } catch (error) {
        console.error("[PIN ERROR] Network error:", error);
        // Revert optimistic update on network errors for authenticated users
        setSavedDocs((prev) => {
          const next = prev.map((entry) =>
            entry.id === doc.id ? { ...entry, pinned: doc.pinned } : entry
          );
          return sortSavedDocs(next);
        });
        setToast(`Failed to update pin status: Network error. Please try again.`);
      }
    },
    [isAuthenticated, setToast, fetchSavedDocs]
  );

  const handleCreateFolder = useCallback(async () => {
    if (!isAuthenticated) {
      setToast("Create a free account to organize documents into folders.");
      return;
    }
    const folderName = typeof window !== "undefined" ? window.prompt("Name your folder") : null;
    if (folderName === null) {
      return;
    }
    const trimmedName = folderName.trim();
    if (!trimmedName) {
      setToast("Folder name cannot be empty.");
      return;
    }

    try {
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setToast(formatErrorMessage(payload?.error, "Unable to create folder."));
        return;
      }

      const normalizedFolder: FolderSummary = {
        id: payload.id,
        name: payload.name ?? trimmedName,
        createdAt: payload.createdAt ?? new Date().toISOString(),
        documentCount: typeof payload.documentCount === "number" ? payload.documentCount : 0
      };
      setFolders((prev) => [normalizedFolder, ...prev.filter((folder) => folder.id !== normalizedFolder.id)]);
      await assignDocumentToFolder(normalizedFolder.id, { folderName: normalizedFolder.name });
    } catch (error) {
      console.error("create folder failed:", error);
      setToast("Unable to create folder.");
    }
  }, [assignDocumentToFolder, isAuthenticated]);

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

    // Create a fresh document entry (don't save until it has content)
    let baseDoc: WriterOutput = ensurePlaceholderState({
      id: crypto.randomUUID(),
      title: "Untitled doc",
      content: "",
      createdAt: new Date().toISOString(),
      settings: normalizeSettings(defaultSettings),
      prompt: "",
      writingStyle: null,
      styleTitle: null
    });

    // Don't save empty documents - they'll be saved when user types first character
    
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

  // Set active document when outputs change (but only if we don't already have one active)
  useEffect(() => {
    if (outputs.length > 0 && !activeDocumentId) {
      setActiveDocumentId(outputs[0].id);
    }
  }, [outputs, activeDocumentId]);

  // Handle document title changes with autosave
  const handleTitleChange = useCallback(
    (title: string) => {
      if (!activeDocumentId) return;
      
      // Update local state immediately
      setOutputs((prev) =>
        prev.map((output) =>
          output.id === activeDocumentId ? { ...output, title } : output
        )
      );

      bumpSavedDoc(activeDocumentId, (doc) => ({
        ...doc,
        title
      }));

      // Clear existing title autosave timeout
      if (titleAutosaveTimeout) {
        clearTimeout(titleAutosaveTimeout);
      }

      // Set new autosave timeout (debounce for 2 seconds)
      const timeout = setTimeout(async () => {
        const currentDoc = outputsRef.current.find((o) => o.id === activeDocumentId);
        if (!currentDoc) return;

        try {
          const patchResponse = await fetch(`/api/documents/${activeDocumentId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title })
          });

          if (patchResponse.ok) {
            // Title saved successfully
            return;
          }

          if (patchResponse.status !== 404) {
            const errorPayload = await patchResponse.json().catch(() => null);
            console.error("Title autosave failed:", patchResponse.status, errorPayload);
          }
        } catch (error) {
          console.error("Title autosave error:", error);
        }
      }, 2000); // 2 second debounce

      setTitleAutosaveTimeout(timeout);
    },
    [activeDocumentId, bumpSavedDoc, titleAutosaveTimeout]
  );

  // Handle document content changes with autosave
  const handleDocumentChange = useCallback(
    async (content: string) => {
      // If no active document but there's content, create one automatically
      if (!activeDocumentId && content.trim()) {
        const newDoc: WriterOutput = ensurePlaceholderState({
          id: crypto.randomUUID(),
          title: "Untitled doc",
          content: content.trim(),
          createdAt: new Date().toISOString(),
          settings: normalizeSettings(defaultSettings),
          prompt: "",
          writingStyle: null,
          styleTitle: null
        });
        
        // Add to outputs and set as active
        setOutputs([newDoc]);
        setActiveDocumentId(newDoc.id);
        
        // Immediately save to server (no debounce for initial creation)
        const savedId = await persistDocumentToServer(newDoc, content.trim());
        if (savedId && savedId !== newDoc.id) {
          setOutputs((prev) =>
            prev.map((entry) =>
              entry.id === newDoc.id ? { ...entry, id: savedId } : entry
            )
          );
          setActiveDocumentId(savedId);
        }
        return;
      }
      
      if (!activeDocumentId) return;
      
      // Get previous content to detect transition from empty to non-empty
      const currentDoc = outputsRef.current.find((o) => o.id === activeDocumentId);
      const previousContent = currentDoc?.content ?? "";
      const wasEmpty = !previousContent || !previousContent.trim();
      const isNowNonEmpty = content && content.trim().length > 0;
      const shouldSaveImmediately = wasEmpty && isNowNonEmpty;
      
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

      // If transitioning from empty to non-empty, save immediately
      if (shouldSaveImmediately) {
        const savedId = await persistDocumentToServer(
          { ...currentDoc!, content },
          content
        );
        console.log("[AUTOSAVE] Document saved immediately (first character):", {
          documentId: activeDocumentId,
          savedId
        });
        if (savedId && savedId !== activeDocumentId) {
          setOutputs((prev) =>
            prev.map((entry) =>
              entry.id === activeDocumentId ? { ...entry, id: savedId } : entry
            )
          );
          setActiveDocumentId(savedId);
        }
        // Saved docs list will be updated by persistDocumentToServer (via fetchSavedDocs or persistLocalDocEntry)
        return;
      }

      // For subsequent changes, use debounced autosave (only if content is non-empty)
      if (isNowNonEmpty) {
        // Update saved docs list for existing documents
        bumpSavedDoc(activeDocumentId, (doc) => ({
          ...doc,
          content
        }));

        const timeout = setTimeout(async () => {
          const currentDoc = outputsRef.current.find((o) => o.id === activeDocumentId);
          if (!currentDoc) return;

          const savedId = await persistDocumentToServer(currentDoc, content);
          console.log("[AUTOSAVE] Document saved:", {
            documentId: activeDocumentId,
            savedId,
            pinned: savedDocsRef.current.find((s) => s.id === activeDocumentId)?.pinned
          });
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
      }
    },
    [activeDocumentId, autosaveTimeout, bumpSavedDoc, persistDocumentToServer]
  );

  // Cleanup autosave timeouts on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimeout) {
        clearTimeout(autosaveTimeout);
      }
      if (titleAutosaveTimeout) {
        clearTimeout(titleAutosaveTimeout);
      }
    };
  }, [autosaveTimeout, titleAutosaveTimeout]);

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

  const documentHorizontalPadding = useMemo(() => {
    const basePadding = 180;
    const desktopSidebarOffsetActive = sidebarOpen && isAuthenticated && isDesktop;
    if (!desktopSidebarOffsetActive) {
      return { left: basePadding, right: basePadding };
    }
    // Sidebar is 320px wide (lg:w-80), content is pushed 320px (lg:ml-[320px])
    // To have equal visible margins (180px on both sides):
    // - Right margin: 180px (basePadding)
    // - Left visible margin: from viewport edge to document content = 180px
    // - Content starts at 320px from left, so we need 180px left padding
    // - This creates: 320px (sidebar) + 180px (padding) = 500px from left edge
    // - But wait, the visible margin is just the padding (180px), which matches right side
    return {
      left: basePadding,
      right: basePadding
    };
  }, [sidebarOpen, isAuthenticated, isDesktop]);

    // Listen for sidebar toggle event from header
    useEffect(() => {
      const handleToggleSidebar = () => {
        setSidebarOpen((prev) => !prev);
      };
      window.addEventListener("toggle-sidebar", handleToggleSidebar);
      return () => window.removeEventListener("toggle-sidebar", handleToggleSidebar);
    }, []);
    
    // Dispatch sidebar state changes synchronously so header animation stays in sync
    useLayoutEffect(() => {
      window.dispatchEvent(new CustomEvent("sidebar-state-change", { detail: { open: sidebarOpen } }));
    }, [sidebarOpen]);

    // Dispatch settings state changes synchronously so header darkens in sync
    useLayoutEffect(() => {
      window.dispatchEvent(new CustomEvent("settings-state-change", { detail: { open: sheetOpen } }));
    }, [sheetOpen]);

    return (
    <div className="flex min-h-screen bg-brand-background/33 text-brand-text">
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
          activeDocumentId={activeDocumentId}
          docs={docDocuments}
          styles={styleDocuments}
          brandSummary={brandSummary}
          hasBrand={hasBrand}
          brandKeyMessaging={brandKeyMessaging}
          onRemoveKeyMessaging={handleRemoveKeyMessaging}
          userName={user.name}
          topOffset={30}
          bottomOffset={hasOutputs ? 140 : 32}
          isDesktop={isDesktop}
          activeStyleId={activeStyle?.id}
          onSelect={handleLoadDoc}
              onToggle={() => setSidebarOpen((prev) => !prev)}
          onOpen={() => setSidebarOpen(true)}
          onApplyStyle={handleApplyStyle}
          onTabChange={(tab) => setSidebarTab(tab)}
          onPinDocument={handlePinDocument}
          settingsOpen={sheetOpen}
        />
      )}
      <div className={cn("flex min-h-screen flex-1 flex-col pb-[350px] transition-all duration-300", sidebarOpen && isAuthenticated && isDesktop ? "lg:ml-[320px]" : undefined)}>
        <div className="flex-1 px-4 py-8 sm:px-6">
          <div className="mx-auto w-full max-w-5xl">
            {guestLimitEnabled && isGuest && guestLimitReached && <RegisterGate />}
            <DocumentEditor
              document={activeDocument}
              onDocumentChange={handleDocumentChange}
              onTitleChange={handleTitleChange}
              onSelectionChange={handleSelectionChange}
              onEditorReady={handleEditorReady}
              loading={loading && activeDocument?.isPending}
              brandSummary={brandSummary}
              styleGuide={activeStyle ? { name: activeStyle.name, description: activeStyle.description } : null}
              horizontalPadding={documentHorizontalPadding}
            />
            {/* Forgetaboutit Icon - positioned below document canvas */}
            <div className="flex justify-center mt-20 pointer-events-none" style={{ opacity: 1 }}>
              <div className="w-6 h-auto" style={{ opacity: 1, filter: 'brightness(0) saturate(100%) invert(10%)' }}>
                <NextImage 
                  src="/FAI-icon-blue-no-padding.png" 
                  alt="Forgetaboutit" 
                  width={24}
                  height={0}
                  className="w-6 h-auto"
                  style={{ opacity: 1 }}
                  unoptimized
                />
              </div>
            </div>
          </div>
        </div>
        {/* Gradient overlay behind compose bar */}
        <div 
          className={cn("fixed bottom-0 left-0 right-0 pointer-events-none transition-all duration-300", sidebarOpen && isAuthenticated && isDesktop ? "lg:left-[320px]" : undefined)}
          style={{
            zIndex: 50,
            height: '150px',
            background: 'linear-gradient(to top, rgba(0, 0, 0, 0.66) 0%, rgba(0, 0, 0, 0) 100%)'
          }}
        />
        <div className={cn("fixed bottom-[10px] left-0 right-0 px-[180px] pointer-events-none z-[60] transition-all duration-300", sidebarOpen && isAuthenticated && isDesktop ? "lg:left-[320px]" : undefined)}>
          <div className="mx-auto max-w-[680px] pointer-events-auto">
            <ComposeBar
              value={composeValue}
              onChange={setComposeValue}
              onSubmit={handleSubmit}
              disabled={loading || (guestLimitEnabled && isGuest && guestLimitReached)}
              loading={loading}
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
        "pointer-events-none fixed top-1/2 left-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 transform rounded-2xl bg-brand-panel px-4 py-3 text-center text-sm text-brand-text shadow-[0_20px_60px_rgba(0,0,0,0.45)] transition-all duration-300 z-[9999]",
        {
          "opacity-100 translate-y-[-50%]": Boolean(message),
          "opacity-0 translate-y-[-40%]": !message
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
  activeDocumentId: string | null;
  docs: SavedDoc[];
  styles: SavedDoc[];
  brandSummary: string | null;
  hasBrand: boolean;
  brandKeyMessaging: Array<{ id: string; text: string; createdAt: string }>;
  onRemoveKeyMessaging: (id: string) => void;
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
  onPinDocument?: (doc: SavedDoc) => void;
  settingsOpen?: boolean;
};

function WorkspaceSidebar({
  open,
  activeTab,
  activeDocumentId,
  docs,
  styles,
  brandSummary,
  hasBrand,
  brandKeyMessaging,
  onRemoveKeyMessaging,
  userName,
  topOffset,
  bottomOffset,
  isDesktop,
  activeStyleId,
  onToggle,
  onOpen,
  onTabChange,
  onSelect,
  onApplyStyle,
  onPinDocument,
  settingsOpen = false
}: WorkspaceSidebarProps) {
  const [hoveredTimestampId, setHoveredTimestampId] = useState<string | null>(null);
  const timestampTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const tabs: { id: SidebarTab; label: string; icon: string }[] = [
    { id: "docs", label: "Docs", icon: "draft" },
    { id: "styles", label: "Styles", icon: "groups" },
    { id: "brands", label: "Brands", icon: "flag" }
  ];
  const selectedIndex = Math.max(
    tabs.findIndex((tab) => tab.id === activeTab),
    0
  );

  const handleTabChange = (index: number) => {
    const nextTab = tabs[index]?.id ?? tabs[0].id;
    onTabChange(nextTab);
  };

  // Prevent focus stealing from sidebar buttons
  const handleButtonMouseDown = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  }, []);

  // Handle timestamp hover with delay
  const handleTimestampMouseEnter = useCallback((docId: string) => {
    // Clear any existing timeout
    if (timestampTimeoutRef.current) {
      clearTimeout(timestampTimeoutRef.current);
    }
    // Set timeout to show tooltip after 1 second
    timestampTimeoutRef.current = setTimeout(() => {
      setHoveredTimestampId(docId);
    }, 1000);
  }, []);

  const handleTimestampMouseLeave = useCallback(() => {
    // Clear timeout if user moves away before delay completes
    if (timestampTimeoutRef.current) {
      clearTimeout(timestampTimeoutRef.current);
      timestampTimeoutRef.current = null;
    }
    setHoveredTimestampId(null);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timestampTimeoutRef.current) {
        clearTimeout(timestampTimeoutRef.current);
      }
    };
  }, []);

  // Helper function to extract preview text from content
  function getContentPreview(content: string, maxLength: number = 80): string {
    if (!content || !content.trim()) {
      return "";
    }
    // Strip markdown formatting
    let text = content
      .replace(/```[\s\S]*?```/g, "") // code blocks
      .replace(/`([^`]+)`/g, "$1") // inline code
      .replace(/!\[[^\]]*]\([^)]+\)/g, "") // images
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1") // links
      .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1") // emphasis/strike
      .replace(/^#{1,6}\s+/gm, "") // headings
      .replace(/^\s{0,3}[-*+]\s+/gm, "") // unordered lists
      .replace(/^\s{0,3}\d+\.\s+/gm, "") // ordered lists
      .replace(/^>\s?/gm, "") // blockquotes
      .replace(/\n+/g, " ") // newlines to spaces
      .trim();
    
    if (text.length <= maxLength) {
      return text;
    }
    // Truncate at word boundary
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(" ");
    return lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated;
  }

  function renderDocList(items: SavedDoc[], emptyLabel: string) {
    if (!items.length) {
      return <p className="text-sm text-brand-muted">{emptyLabel}</p>;
    }
    return (
      <ul className="space-y-3">
        {items.map((doc) => {
          const isActive = activeDocumentId === doc.id;
          const preview = getContentPreview(doc.content);
          const displayTitle = doc.title || "Untitled doc";
          return (
            <li key={doc.id} className="relative group">
              <button
                type="button"
                onMouseDown={handleButtonMouseDown}
                onClick={() => onSelect(doc)}
                className={cn(
                  "w-full rounded-[7px] border border-brand-stroke/40 bg-brand-background/60 p-5 text-left transition",
                  isActive
                    ? "border-white shadow-[0_20px_45px_rgba(0,0,0,0.45)]"
                    : "hover:opacity-50"
                )}
                tabIndex={-1}
              >
                <p className="text-[21px] font-semibold pr-9 mb-[5px] pb-1" style={{ lineHeight: '1.6rem', minHeight: '3rem', color: 'rgba(255, 255, 255, 0.75)' }}>{displayTitle}</p>
                {preview && (
                  <p className="text-xs font-semibold text-brand-muted/70 mt-1">
                    {preview}
                  </p>
                )}
              </button>
              <button
                type="button"
                aria-label="Pin document"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onPinDocument?.(doc);
                }}
                className={cn(
                  "absolute top-1 right-1 pt-[5px] pr-[5px] pb-0.5 pl-0.5 text-xs text-white/70 opacity-0 transition group-hover:opacity-50 focus-visible:opacity-50 hover:opacity-100 hover:text-white",
                  doc.pinned ? "opacity-100 group-hover:opacity-100 hover:!opacity-50 text-brand-blue hover:text-brand-blue" : undefined
                )}
                tabIndex={-1}
              >
                <span className="material-symbols-rounded text-base leading-none" style={{ transform: 'rotate(45deg) scale(0.66)' }}>push_pin</span>
              </button>
              <div 
                className={cn(
                  "absolute transition-opacity",
                  isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
                style={{ bottom: '8px', right: '8px' }}
                onMouseEnter={() => handleTimestampMouseEnter(doc.id)}
                onMouseLeave={handleTimestampMouseLeave}
              >
                <p className="text-[8px] font-semibold text-brand-muted/25 cursor-default">
                  {formatTimestamp(doc.lastEditedAt ?? doc.createdAt)}
                </p>
                {hoveredTimestampId === doc.id && (
                  <div className="absolute bottom-full right-0 mb-2 px-2 py-1.5 rounded border border-brand-stroke/60 bg-brand-panel text-xs text-brand-text whitespace-nowrap z-50 pointer-events-none">
                    <div className="space-y-0.5">
                      <div>Last Edited: {formatTimestamp(doc.lastEditedAt ?? doc.createdAt)}</div>
                      <div>Created: {formatTimestamp(doc.createdAt)}</div>
                    </div>
                    <div className="absolute top-full right-4 -mt-px">
                      <div className="border-4 border-transparent border-t-brand-stroke/60"></div>
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  function renderStyleList(items: SavedDoc[]) {
    if (!items.length) {
      return <p className="text-sm text-brand-muted">Save a style from any output and it&apos;ll appear here.</p>;
    }
    return (
      <ul className="space-y-3">
        {items.map((style) => (
          <li key={style.id}>
            <button
              type="button"
              onMouseDown={handleButtonMouseDown}
              onClick={() => onApplyStyle(style)}
              className={cn(
                "w-full rounded-[5px] border border-brand-stroke/40 bg-brand-background/60 px-3 py-3 text-left transition hover:border-white",
                activeStyleId === style.id ? "border-white bg-white/10" : undefined
              )}
              tabIndex={-1}
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

  function renderBrandsContent() {
    return (
      <div className="space-y-4">
        {hasBrand && brandSummary && (
          <div className="rounded-2xl border border-brand-stroke/40 bg-brand-background/60 p-4 text-sm text-brand-muted/90">
            <p className="text-base font-semibold text-white">Defined brand</p>
            <p className="mt-2 whitespace-pre-line leading-relaxed">{brandSummary}</p>
            <p className="mt-4 text-xs text-brand-muted">Update the brand summary inside Settings.</p>
          </div>
        )}
        {brandKeyMessaging.length > 0 && (
          <div>
            <p className="mb-3 text-sm font-semibold text-white">Key Messaging</p>
            <ul className="space-y-2">
              {brandKeyMessaging.map((item) => (
                <li
                  key={item.id}
                  className="group flex items-start justify-between gap-2 rounded-xl border border-brand-stroke/40 bg-brand-background/60 p-3 transition hover:border-white"
                >
                  <p className="flex-1 text-sm text-brand-muted/90">{item.text}</p>
                  <button
                    type="button"
                    onMouseDown={handleButtonMouseDown}
                    onClick={() => onRemoveKeyMessaging(item.id)}
                    className="opacity-0 transition group-hover:opacity-100"
                    title="Remove"
                    tabIndex={-1}
                  >
                    <span className="material-symbols-outlined text-base text-brand-muted hover:text-white">
                      close
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!hasBrand && brandKeyMessaging.length === 0 && (
          <p className="text-sm text-brand-muted">
            No brand defined yet. Add one inside Settings, or select text and click &ldquo;Add to Brand&rdquo; in the formatting toolbar.
          </p>
        )}
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "flex flex-col text-brand-text transition-all duration-300",
        open
          ? "bg-brand-panel/85 shadow-[0_30px_80px_rgba(0,0,0,0.5)] fixed inset-0 w-full lg:fixed lg:left-0 lg:top-0 lg:bottom-0 lg:w-80 lg:h-full lg:border-r lg:border-brand-stroke/40 lg:shadow-none lg:translate-x-0"
          : "fixed left-4 top-[calc(88px+16px)] lg:hidden lg:translate-x-[-100%]",
        settingsOpen ? "brightness-50" : undefined
      )}
      style={{ zIndex: 1200 }}
      tabIndex={-1}
      onFocus={(e) => {
        // Prevent sidebar from receiving focus
        if (e.target === e.currentTarget) {
          e.currentTarget.blur();
        }
      }}
    >
      {open ? (
        <div className="flex h-full flex-col">
          <Tab.Group className="flex flex-1 flex-col min-h-0" selectedIndex={selectedIndex} onChange={handleTabChange}>
            <Tab.List className="flex bg-brand-background/40 text-xs font-semibold uppercase flex-shrink-0 w-full p-1.5">
              {tabs.map((tab) => (
                <Tab
                  key={tab.id}
                  className={({ selected }) =>
                    cn(
                      "flex flex-1 flex-col items-center justify-center gap-1 py-3 rounded-full transition focus:outline-none",
                      selected
                        ? "bg-white/15 text-white shadow-[0_15px_35px_rgba(0,0,0,0.45)]"
                        : "text-brand-muted hover:text-white"
                    )
                  }
                >
                  <span className="material-symbols-outlined text-xl">{tab.icon}</span>
                  <span>{tab.label}</span>
                </Tab>
              ))}
            </Tab.List>
            <div className="flex-1 min-h-0 overflow-hidden pl-5 pr-0">
              <Tab.Panels className="h-full">
                <Tab.Panel className="h-full overflow-y-auto pt-8 pb-8 pr-5 focus:outline-none">
                  {renderDocList(docs, "No docs yet. Generate something to see it here.")}
                </Tab.Panel>
                <Tab.Panel className="h-full overflow-y-auto pt-8 pb-8 pr-5 focus:outline-none">
                  {renderStyleList(styles)}
                </Tab.Panel>
                <Tab.Panel className="h-full overflow-y-auto pt-8 pb-8 pr-5 focus:outline-none">
                  {renderBrandsContent()}
                </Tab.Panel>
              </Tab.Panels>
            </div>
          </Tab.Group>
          <div className="mt-auto border-t border-brand-stroke/40 pt-4 pb-6 px-5 flex-shrink-0">
            <div className="flex items-center justify-between gap-3">
              <Link href="/membership" className="flex items-center gap-[5px] hover:opacity-80 transition-opacity">
                <ProfileAvatar name={userName} size={32} />
                <div>
                  <p className="text-[10px] text-brand-muted">Account</p>
                  <p className="mt-[1px] text-sm font-semibold text-white">{userName}</p>
                </div>
              </Link>
              <div className="flex-shrink-0">
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onClick={() => signOut({ callbackUrl: "/sign-in" })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-stroke/70 px-3 py-1.5 text-xs font-semibold text-brand-text transition hover:border-brand-blue hover:text-brand-blue"
                  tabIndex={-1}
                >
                  <ArrowRightOnRectangleIcon className="h-3 w-3" />
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
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

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function generateColorFromName(name: string): string {
  // Generate a consistent color from the name using a simple hash
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Generate HSL values that work well with dark backgrounds
  // We want colors that are vibrant but not too bright
  const hue = Math.abs(hash) % 360;
  
  // Use a moderate saturation (50-70%) and lightness (45-55%) for good contrast on dark backgrounds
  const saturation = 50 + (Math.abs(hash) % 20);
  const lightness = 45 + (Math.abs(hash >> 8) % 10);
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function ProfileAvatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = getInitials(name);
  
  return (
    <div
      className="flex items-center justify-center rounded-full font-semibold text-white flex-shrink-0"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`,
        minHeight: `${size}px`,
        background: 'linear-gradient(135deg, #4a4a4a 0%, #2a2a2a 100%)',
        fontSize: `${size * 0.4}px`
      }}
    >
      {initials}
    </div>
  );
}

