"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect, Fragment } from "react";
import { Tab, Dialog, Transition } from "@headlessui/react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import NextImage from "next/image";
import { MinusSmallIcon } from "@heroicons/react/24/outline";
import DocumentEditor from "../editors/DocumentEditor";
import ComposeBar from "../forms/ComposeBar";
import SettingsSheet from "../modals/SettingsSheet";
import { ComposerSettingsInput } from "@/lib/validators";
import { DocumentFolderReference, FolderSummary, OutputPlaceholder, WriterOutput } from "@/types/writer";
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
  styleSummary?: string | null;
  pinned?: boolean;
  folders: DocumentFolderReference[];
};

type StyleDocInput = {
  id: string;
  title?: string;
  writingStyle?: string | null;
  content?: string;
  styleSummary?: string | null;
  [key: string]: unknown;
};

type SidebarTab = "docs" | "styles" | "brands";

type ActiveStyle = {
  id: string;
  name: string;
  description: string;
};

type BrandKeyMessage = {
  id: string;
  text: string;
  createdAt: string;
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
      const safeEntry = entry as Partial<SavedDoc> & { folders?: unknown };
      const normalizedFolders: DocumentFolderReference[] = Array.isArray(safeEntry.folders)
        ? safeEntry.folders
            .map((folder: unknown) => {
              if (!folder || typeof folder !== "object") {
                return null;
              }
              const candidate = folder as Partial<DocumentFolderReference>;
              if (typeof candidate.id !== "string" || typeof candidate.name !== "string") {
                return null;
              }
              return {
                id: candidate.id,
                name: candidate.name
              };
            })
            .filter(
              (folder: DocumentFolderReference | null): folder is DocumentFolderReference => Boolean(folder)
            )
        : [];
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
      styleSummary:
        typeof safeEntry.styleSummary === "string"
          ? safeEntry.styleSummary
          : safeEntry.styleSummary ?? null,
        styleTitle:
          typeof safeEntry.styleTitle === "string"
            ? safeEntry.styleTitle
            : safeEntry.styleTitle ?? null,
        pinned: typeof safeEntry.pinned === "boolean" ? safeEntry.pinned : false,
        folders: normalizedFolders
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
      {
        ...doc,
        lastEditedAt: doc.lastEditedAt ?? doc.createdAt,
        pinned: doc.pinned ?? false,
        folders: Array.isArray(doc.folders) ? doc.folders : []
      },
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

function fallbackStyleDescription(description: string | null, content: string, summary?: string | null): string {
  if (summary?.trim()) {
    return summary.trim();
  }
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
    instanceKey: output.instanceKey ?? output.id,
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
  const initialBlankDocRef = useRef<WriterOutput | null>(null);
  if (!initialBlankDocRef.current) {
    const clientId = crypto.randomUUID();
    initialBlankDocRef.current = ensurePlaceholderState({
      id: clientId,
      instanceKey: clientId,
      title: "Untitled doc",
      content: "",
      createdAt: new Date().toISOString(),
      settings: normalizeSettings(defaultSettings),
      prompt: "",
      writingStyle: null,
      styleTitle: null
    });
  }
  const [outputs, setOutputs] = useState<WriterOutput[]>(() => [initialBlankDocRef.current!]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetAnchor, setSheetAnchor] = useState<DOMRect | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [guestLimitReached, setGuestLimitReached] = useState(false);
  const [hasBrand, setHasBrand] = useState(false);
  const [brandName, setBrandName] = useState<string | null>(null);
  const [brandSummary, setBrandSummary] = useState<string | null>(null);
  const [brandKeyMessaging, setBrandKeyMessaging] = useState<BrandKeyMessage[]>([]);
  const [allBrands, setAllBrands] = useState<Array<{ id: string; name: string | null; info: string; isActive: boolean }>>([]);
  const [savedDocs, setSavedDocs] = useState<SavedDoc[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [folderDialogState, setFolderDialogState] = useState<{ assignActiveDocument?: boolean; documentId?: string | null } | null>(null);
  const [folderDialogError, setFolderDialogError] = useState<string | null>(null);
  const [folderDialogLoading, setFolderDialogLoading] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("docs");
  const [activeStyle, setActiveStyle] = useState<ActiveStyle | null>(null);
  const [activeBrandId, setActiveBrandId] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(true);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(() => initialBlankDocRef.current?.id ?? null);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [autosaveTimeout, setAutosaveTimeout] = useState<NodeJS.Timeout | null>(null);
  const [titleAutosaveTimeout, setTitleAutosaveTimeout] = useState<NodeJS.Timeout | null>(null);
  const [showGuestTypingNotice, setShowGuestTypingNotice] = useState(false);
  const [styleGenPopup, setStyleGenPopup] = useState<{
    open: boolean;
    title: string | null;
    summary: string | null;
    generating: boolean;
    logs: Array<{ step: string; details?: Record<string, any>; timestamp: string }>;
    progress: number;
    status: string;
  }>({ open: false, title: null, summary: null, generating: false, logs: [], progress: 0, status: "" });
  const editorRef = useRef<any>(null); // Reference to the TipTap editor instance
  const outputsRef = useRef<WriterOutput[]>(outputs);
  const savedDocsRef = useRef<SavedDoc[]>([]);
const lastSavedContentRef = useRef<Map<string, string>>(new Map());
  const composeInputRef = useRef<HTMLTextAreaElement>(null);
  const typingStartTimeRef = useRef<number | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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
        const folderRefs: DocumentFolderReference[] = Array.isArray(doc.folders)
          ? doc.folders
              .map((folder: any) => {
                if (!folder || typeof folder !== "object") {
                  return null;
                }
                const folderId = typeof folder.id === "string" ? folder.id : null;
                const folderName = typeof folder.name === "string" ? folder.name : null;
                if (!folderId || !folderName) {
                  return null;
                }
                return {
                  id: folderId,
                  name: folderName
                };
              })
              .filter(
                (folder: DocumentFolderReference | null): folder is DocumentFolderReference => Boolean(folder)
              )
          : [];
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
          styleSummary: doc.styleSummary ?? null,
          styleTitle: doc.styleTitle ?? null,
          pinned: typeof doc.pinned === "boolean" ? doc.pinned : existing?.pinned ?? false,
          folders: folderRefs
        };
      });
      console.log("[fetchSavedDocs] mapped documents:", mapped.length);
      const regularDocs = mapped.filter((doc) => !isStyleDocument(doc));
      const styles = mapped.filter((doc) => isStyleDocument(doc));
      console.log("[fetchSavedDocs] classified - docs:", regularDocs.length, "styles:", styles.length);
      console.log("[fetchSavedDocs] sample doc titles:", regularDocs.slice(0, 3).map(d => d.title));
      // Track last saved content separately so autosave comparisons use server state
      const savedContentMap = lastSavedContentRef.current;
      savedContentMap.clear();
      mapped.forEach((doc) => {
        if (typeof doc.content === "string") {
          savedContentMap.set(doc.id, doc.content);
        }
      });
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
        // API already returns folders sorted by most recent assignment, so use as-is
        setFolders(
          data.map((folder: any) => ({
            id: folder.id,
            name: folder.name ?? "Untitled folder",
            createdAt: folder.createdAt ?? new Date().toISOString(),
            documentCount: typeof folder.documentCount === "number" ? folder.documentCount : 0,
            pinned: folder.pinned ?? false
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
      const savedContentMap = lastSavedContentRef.current;
      savedContentMap.clear();
      local.forEach((doc) => {
        if (typeof doc.content === "string") {
          savedContentMap.set(doc.id, doc.content);
        }
      });
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
  function handleBrandSummaryUpdate(summary: string | null, name?: string | null) {
    setBrandSummary(summary);
    setBrandName(name ?? null);
    setHasBrand(Boolean(summary?.trim()) || Boolean(name?.trim()));
    
    // Refresh all brands list for authenticated users
    if (isAuthenticated) {
      fetchAllBrands();
    }
  }

  async function handleUseBrand(brandId?: string) {
    // Handle clearing/deactivating brand
    if (!brandId) {
      const previousActiveBrandId = activeBrandId;
      setActiveBrandId(null);
      setBrandName(null);
      setBrandSummary(null);
      setHasBrand(false);
      
      // For authenticated users, deactivate via API
      if (isAuthenticated) {
        try {
          const response = await fetch("/api/brand", {
            method: "DELETE"
          });
          
          if (response.ok) {
            setToast("Brand deactivated. Writing will no longer use brand context.");
            // Update local list to remove active state
            setAllBrands((prev) =>
              prev.length
                ? prev.map((b) => ({ ...b, isActive: false }))
                : prev
            );
          } else {
            // Revert on error
            setActiveBrandId(previousActiveBrandId);
            setToast("Failed to deactivate brand. Please try again.");
          }
        } catch (error) {
          console.error("Failed to deactivate brand", error);
          // Revert on error
          setActiveBrandId(previousActiveBrandId);
          setToast("Failed to deactivate brand. Please try again.");
        }
      } else {
        // For guests, just clear local state
        setToast("Brand cleared.");
      }
      return;
    }
    
    // Optimistically update UI immediately
    const previousActiveBrandId = activeBrandId;
    setActiveBrandId(brandId);
    
    // Find brand immediately from current list for UI/labels
    const brand = allBrands.find((b) => b.id === brandId);
    const brandDisplayName = brand?.name || brandName || "Custom Brand";
    if (brand) {
      // Update brand info state so button/dot reflect immediately
      setBrandName(brand.name ?? null);
      setBrandSummary(brand.info ?? null);
      setHasBrand(Boolean(brand.info) || Boolean(brand.name));
    }
    
    // For authenticated users, activate via API
    if (isAuthenticated) {
      try {
        const response = await fetch(`/api/brand?activate=${brandId}`, {
          method: "POST"
        });
        
        if (response.ok) {
          // Show toast immediately
          setToast(`Brand "${brandDisplayName}" is now active and will be used for all compositions.`);
          // Immediately update local list so UI reflects active state (button + blue dot) without waiting for refetch
          setAllBrands((prev) =>
            prev.length
              ? prev.map((b) => ({ ...b, isActive: b.id === brandId }))
              : prev
          );
          
          // Refresh brands list in background to sync with server
          fetch("/api/brand?all=true")
            .then(brandsResponse => {
              if (brandsResponse.ok) {
                return brandsResponse.json();
              }
              return null;
            })
            .then(brandsData => {
              if (brandsData?.brands && Array.isArray(brandsData.brands)) {
                setAllBrands(brandsData.brands);
              }
            })
            .catch(err => {
              console.error("Failed to refresh brands list", err);
              // Don't show error to user, UI is already updated optimistically
            });
          
          // Close sidebar on mobile after selection for better UX
          if (!isDesktop) {
            setTimeout(() => setSidebarOpen(false), 500);
          }
        } else {
          // Revert on error
          setActiveBrandId(previousActiveBrandId);
          setToast("Failed to activate brand. Please try again.");
        }
      } catch (error) {
        console.error("Failed to activate brand", error);
        // Revert on error
        setActiveBrandId(previousActiveBrandId);
        setToast("Failed to activate brand. Please try again.");
      }
    } else {
      // For guests, just set local state
      if (hasBrand) {
        // Ensure brand info state is set so indicators update
        if (brand) {
          setBrandName(brand.name ?? null);
          setBrandSummary(brand.info ?? null);
          setHasBrand(Boolean(brand.info) || Boolean(brand.name));
        } else {
          setHasBrand(true);
        }
        setToast(`Brand "${brandDisplayName}" is now active and will be used for all compositions.`);
        // Close sidebar on mobile after selection for better UX
        if (!isDesktop) {
          setTimeout(() => setSidebarOpen(false), 500);
        }
      } else {
        setActiveBrandId(previousActiveBrandId); // Revert
        setToast("No brand defined. Define a brand in Settings first.");
      }
    }
  }

  // Removed auto-dismiss - toasts now stay open until manually closed

  // Check if brand is defined (works for both authenticated users and guests)
  useEffect(() => {
    async function checkBrand() {
      try {
        const response = await fetch("/api/brand");
        if (response.ok) {
          const data = await response.json();
          const summary = data.brandInfo ?? null;
          const name = data.brandName ?? null;
          setBrandSummary(summary);
          setBrandName(name);
          setHasBrand(Boolean(summary) || Boolean(name));
        }
      } catch (error) {
        console.error("Failed to check brand info", error);
      }
    }
    checkBrand();
  }, []);

  // Fetch all brands for authenticated users
  const fetchAllBrands = useCallback(async () => {
    if (!isAuthenticated) {
      // For guests, use the single brand from state
      if (hasBrand) {
        setAllBrands([{
          id: "brand-primary",
          name: brandName,
          info: brandSummary || "",
          isActive: true
        }]);
      } else {
        setAllBrands([]);
      }
      return;
    }

    try {
      const response = await fetch("/api/brand?all=true");
      if (response.ok) {
        const data = await response.json();
        if (data.brands && Array.isArray(data.brands)) {
          setAllBrands(data.brands);
          // Update activeBrandId if we have one
          if (data.activeBrandId) {
            setActiveBrandId(data.activeBrandId);
          } else {
            setActiveBrandId(null);
          }
        }
      }
    } catch (error) {
      console.error("Failed to fetch all brands", error);
    }
  }, [isAuthenticated, hasBrand, brandName, brandSummary]);

  useEffect(() => {
    fetchAllBrands();
  }, [fetchAllBrands]);

  // Set active brand on mount if brand exists
  useEffect(() => {
    if (hasBrand && !activeBrandId) {
      setActiveBrandId("brand-primary");
    } else if (!hasBrand) {
      setActiveBrandId(null);
    }
  }, [hasBrand, activeBrandId]);

  // Store key messages per brand
  const [brandKeyMessagingMap, setBrandKeyMessagingMap] = useState<Map<string, BrandKeyMessage[]>>(new Map());

  // Fetch brand key messaging items for a specific brand
  const fetchBrandKeyMessaging = useCallback(async (brandId?: string) => {
    if (!isAuthenticated) return;
    try {
      const url = brandId 
        ? `/api/brand/key-messaging?brandId=${encodeURIComponent(brandId)}`
        : "/api/brand/key-messaging";
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        const normalized: BrandKeyMessage[] = Array.isArray(data.items)
          ? data.items.map((item: any) => ({
              id: item.id,
              text: item.text,
              createdAt: item.createdAt
            }))
          : [];
        
        if (brandId) {
          // Store per brand
          setBrandKeyMessagingMap(prev => {
            const newMap = new Map(prev);
            newMap.set(brandId, normalized);
            return newMap;
          });
        } else {
          // Legacy: store all messages (for backward compatibility)
          setBrandKeyMessaging(normalized);
        }
      }
    } catch (error) {
      console.error("Failed to fetch brand key messaging items", error);
    }
  }, [isAuthenticated]);

  // Fetch key messaging items for all brands when brands tab is opened
  useEffect(() => {
    if (isAuthenticated && sidebarTab === "brands" && allBrands.length > 0) {
      // Fetch key messages for each brand
      allBrands.forEach(brand => {
        fetchBrandKeyMessaging(brand.id);
      });
    }
  }, [isAuthenticated, sidebarTab, allBrands, fetchBrandKeyMessaging]);

  // Listen for new items being added
  useEffect(() => {
    const handleBrandKeyMessagingAdded = (event: Event) => {
      const customEvent = event as CustomEvent<{ brandId?: string }>;
      const brandId = customEvent.detail?.brandId || activeBrandId;
      if (brandId) {
        fetchBrandKeyMessaging(brandId);
      } else {
        fetchBrandKeyMessaging();
      }
    };
    window.addEventListener("brand-key-messaging-added", handleBrandKeyMessagingAdded);
    return () => {
      window.removeEventListener("brand-key-messaging-added", handleBrandKeyMessagingAdded);
    };
  }, [fetchBrandKeyMessaging, activeBrandId]);

  // Handle removing a key messaging item
  // Note: The actual deletion is handled in BrandCard.handleRemoveMessage
  // This function just refreshes the list after deletion
  const handleRemoveKeyMessaging = useCallback(async (id: string) => {
    if (!isAuthenticated) return;
    // Just refresh the list - deletion is already handled by BrandCard
    await fetchBrandKeyMessaging();
  }, [isAuthenticated, fetchBrandKeyMessaging]);

  const handleClearBrand = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch("/api/brand", { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        return { success: false, error: body?.error || "Unable to deselect brand." };
      }
      // Only clear active brand state, don't clear the brands list
      setBrandSummary(null);
      setBrandName(null);
      setHasBrand(false);
      setActiveBrandId(null);
      
      // Refresh all brands list to update active status
      if (isAuthenticated) {
        try {
          const brandsResponse = await fetch("/api/brand?all=true");
          if (brandsResponse.ok) {
            const brandsData = await brandsResponse.json();
            if (brandsData.brands && Array.isArray(brandsData.brands)) {
              setAllBrands(brandsData.brands);
            }
          }
        } catch (error) {
          console.error("Failed to refresh brands list", error);
        }
      }
      
      return { success: true };
    } catch (error) {
      console.error("Failed to deselect brand", error);
      return { success: false, error: "Unable to deselect brand." };
    }
  }, [isAuthenticated]);

  const handleAddKeyMessaging = useCallback(
    async (text: string, brandId?: string): Promise<{ success: boolean; error?: string }> => {
      if (!isAuthenticated) {
        return { success: false, error: "Sign in to add key messages." };
      }
      const payload = text.trim();
      if (!payload) {
        return { success: false, error: "Key message cannot be empty." };
      }
      try {
        const response = await fetch("/api/brand/key-messaging", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: payload, brandId })
        });
        if (response.ok) {
          // Refresh key messages for the specific brand
          if (brandId) {
            await fetchBrandKeyMessaging(brandId);
          } else {
            await fetchBrandKeyMessaging();
          }
          return { success: true };
        }
        const errorBody = await response.json().catch(() => null);
        let message: string | null = null;
        if (typeof errorBody?.error === "string") {
          message = errorBody.error;
        } else if (errorBody?.error?.formErrors) {
          message = errorBody.error.formErrors.filter(Boolean).join(" ");
        }
        return { success: false, error: message || "Failed to add key message." };
      } catch (error) {
        console.error("Error adding key messaging item", error);
        return { success: false, error: "Unable to add key message right now." };
      }
    },
    [isAuthenticated, fetchBrandKeyMessaging]
  );

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
      instanceKey: tempId,
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
        instanceKey: tempId,
        title: data.title ?? smartTitleFromPrompt(currentPrompt),
        content: data.content,
        createdAt: data.createdAt ?? new Date().toISOString(),
        settings: normalizeSettings({
          ...snapshotSettings,
          marketTier: snapshotSettings.marketTier ?? null
        }),
        prompt: currentPrompt,
        writingStyle: data.writingStyle ?? null,
        styleSummary: data.styleSummary ?? null,
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
          writingStyle: newOutput.writingStyle ?? null,
          styleSummary: newOutput.styleSummary ?? null,
          folders: []
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
    if (!isAuthenticated) {
      setToast("Register to save styles.");
      return;
    }

    const resolvedContent = resolveOutputContent(output);
    const writingStyle = output.writingStyle?.trim() || null;
    
    if (!resolvedContent || !resolvedContent.trim()) {
      setToast("Unable to save style: no content available.");
      return;
    }

    // Server will generate the title in "[adjective] [adjective] [noun]" format
    const placeholderTitle = "Style";
    
    // Show popup immediately with empty logs
    setStyleGenPopup({ 
      open: true, 
      title: null, 
      summary: null, 
      generating: true, 
      logs: [], 
      progress: 0, 
      status: "Starting..." 
    });
    
    console.log("[handleSaveStyle] Saving style:", {
      contentLength: resolvedContent.length,
      hasStyleTitle: !!output.styleTitle,
      hasWritingStyle: !!writingStyle,
      writingStyleLength: writingStyle?.length
    });

    const localStyleDoc: SavedDoc = {
      id: `${output.id}-style-${Date.now()}`,
      title: placeholderTitle,
      createdAt: new Date().toISOString(),
      lastEditedAt: new Date().toISOString(),
      prompt: output.prompt ?? "",
      content: resolvedContent,
      settings: normalizeSettings(output.settings),
      writingStyle: writingStyle ?? null,
      styleSummary: null,
      styleTitle: null,
      pinned: false,
      folders: []
    };
    
    const requestBody = {
      title: placeholderTitle,
      content: resolvedContent,
      tone: output.settings.marketTier ?? undefined,
      prompt: output.prompt,
      gradeLevel: output.settings.gradeLevel ?? undefined,
      benchmark: output.settings.benchmark ?? undefined,
      avoidWords: output.settings.avoidWords ?? undefined
    };

    try {
      const response = await fetch("/api/documents/save-style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok || !response.body) {
        setStyleGenPopup({ open: false, title: null, summary: null, generating: false, logs: [], progress: 0, status: "" });
        setToast("Unable to save style. Check your connection and try again.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let remoteDoc: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === "log") {
                setStyleGenPopup(prev => ({
                  ...prev,
                  logs: [...prev.logs, { 
                    step: data.step, 
                    details: data.details, 
                    timestamp: data.timestamp 
                  }]
                }));
              } else if (data.type === "progress") {
                setStyleGenPopup(prev => ({
                  ...prev,
                  progress: data.progress,
                  status: data.status
                }));
              } else if (data.type === "result") {
                if (data.success && data.data) {
                  remoteDoc = data.data;
                  const generatedTitle = remoteDoc?.styleTitle ?? remoteDoc?.title ?? null;
                  const generatedSummary = remoteDoc?.styleSummary ?? null;
                  
                  setStyleGenPopup(prev => ({
                    ...prev,
                    title: generatedTitle,
                    summary: generatedSummary,
                    generating: false,
                    progress: 100,
                    status: "Complete"
                  }));
                  
                  const hydratedStyleDoc: SavedDoc = {
                    ...localStyleDoc,
                    id: remoteDoc?.id ?? localStyleDoc.id,
                    title: remoteDoc?.title ?? remoteDoc?.styleTitle ?? localStyleDoc.title,
                    writingStyle: remoteDoc?.writingStyle ?? null,
                    styleTitle: remoteDoc?.styleTitle ?? remoteDoc?.title ?? localStyleDoc.styleTitle ?? localStyleDoc.title,
                    styleSummary: remoteDoc?.styleSummary ?? null,
                    createdAt: remoteDoc?.createdAt ?? localStyleDoc.createdAt,
                    lastEditedAt: remoteDoc?.updatedAt ?? remoteDoc?.createdAt ?? localStyleDoc.lastEditedAt,
                    pinned: localStyleDoc.pinned ?? false
                  };
                  applyLocalDoc(hydratedStyleDoc);
                  fetchSavedDocs();
                } else if (!data.success) {
                  setStyleGenPopup(prev => ({
                    ...prev,
                    generating: false,
                    logs: [...prev.logs, { 
                      step: `Error: ${data.error}`, 
                      timestamp: new Date().toISOString() 
                    }]
                  }));
                  setToast(formatErrorMessage(data.error, "Unable to save writing style."));
                }
              }
            } catch (parseError) {
              console.warn("Failed to parse SSE message", parseError);
            }
          }
        }
      }
    } catch (error) {
      console.error("save style network failure", error);
      setStyleGenPopup({ open: false, title: null, summary: null, generating: false, logs: [], progress: 0, status: "" });
      setToast("Unable to save style. Check your connection and try again.");
    }
  }

  function handleSaveCurrentStyle() {
    if (!activeDocument) {
      setToast("No document to save as style.");
      return;
    }
    
    if (!selectedText || !selectedText.trim()) {
      setToast("Please select text to save as a style.");
      return;
    }
    
    // Save Writing Style only works with selected text
    // Create a modified document with only the selected text
    const styleDocument: WriterOutput = {
      ...activeDocument,
      content: selectedText.trim()
    };
    handleSaveStyle(styleDocument);
  }

  const hasOutputs = outputs.length > 0;

  const applyLocalDoc = useCallback((doc: SavedDoc) => {
    persistLocalDocEntry(doc);
    setSavedDocs((prev) => {
      const normalizedDoc: SavedDoc = {
        ...doc,
        lastEditedAt: doc.lastEditedAt ?? doc.createdAt,
        folders: Array.isArray(doc.folders) ? doc.folders : []
      };
      const next = [normalizedDoc, ...prev.filter((entry) => entry.id !== doc.id)];
      return sortSavedDocs(next).slice(0, 25);
    });
  }, []);

  const bumpSavedDoc = useCallback(
    (docId: string, transform?: (doc: SavedDoc) => SavedDoc, updateTimestamp: boolean = true) => {
      setSavedDocs((prev) => {
        const index = prev.findIndex((doc) => doc.id === docId);
        if (index === -1) {
          return prev;
        }
        const target = prev[index];
        const transformed = transform ? transform(target) : target;
        const updatedDoc: SavedDoc = {
          ...transformed,
          lastEditedAt: updateTimestamp ? new Date().toISOString() : (transformed.lastEditedAt ?? transformed.createdAt),
          folders: Array.isArray(transformed.folders) ? transformed.folders : []
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

  const activeSavedDoc = useMemo(() => {
    if (!activeDocumentId) {
      return null;
    }
    return savedDocs.find((doc) => doc.id === activeDocumentId) ?? null;
  }, [activeDocumentId, savedDocs]);
  const activeDocPinned = activeSavedDoc?.pinned ?? false;

  function handleApplyStyle(styleDoc: StyleDocInput) {
    const description = fallbackStyleDescription(
      styleDoc.writingStyle ?? null,
      styleDoc.content ?? "",
      styleDoc.styleSummary ?? null
    );
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

  const handleClearBrandForComposeBar = () => {
    handleClearBrand().catch((error) => {
      console.error("Failed to clear brand:", error);
    });
  };

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
    if (doc.styleSummary) payload.styleSummary = doc.styleSummary;
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
      
      // Skip if we've already saved this exact content version
      const lastSavedContent = lastSavedContentRef.current.get(doc.id);
      if (lastSavedContent !== undefined && lastSavedContent === contentValue) {
        return doc.id;
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
        styleSummary: doc.styleSummary ?? null,
          styleTitle: doc.styleTitle ?? null,
          pinned: doc.pinned ?? false,
          folders: Array.isArray(doc.folders) ? doc.folders : []
        });
        lastSavedContentRef.current.set(doc.id, contentValue);
        return doc.id;
      }

      // First try to patch existing document
      if (doc.id) {
        try {
          // Include pinned status in patch if available
          const savedDoc = savedDocsRef.current.find((saved) => saved.id === doc.id);
          
          // Skip PATCH if content hasn't changed (prevents unnecessary timestamp updates)
          if (savedDoc && savedDoc.content === contentValue) {
            // Content hasn't changed, just return the existing doc id
            return doc.id;
          }
          
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
            // Record last saved content for future comparisons
            lastSavedContentRef.current.set(doc.id, contentValue);
            // Only update lastEditedAt if content actually changed
            // Prisma automatically updates updatedAt on any PATCH, so we need to check if content changed
            try {
              const updatedDoc = await patchResponse.json();
              const savedDoc = savedDocsRef.current.find((d) => d.id === doc.id);
              const contentChanged = !savedDoc || savedDoc.content !== contentValue;
              
              if (contentChanged && updatedDoc?.updatedAt) {
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
        
        lastSavedContentRef.current.set(created.id as string, contentValue);
        if (created.id !== doc.id) {
          lastSavedContentRef.current.delete(doc.id);
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
    async (folderId: string, options?: { folderName?: string; documentId?: string | null }) => {
      if (!isAuthenticated) {
        setToast("Sign in to organize documents into folders.");
        return;
      }

      const folderFromState = folders.find((folder) => folder.id === folderId);
      let targetDocumentId = options?.documentId ?? null;

      if (targetDocumentId) {
        const trackedDoc = savedDocsRef.current.find((doc) => doc.id === targetDocumentId);
        if (!trackedDoc) {
          setToast("Save the document before adding it to a folder.");
          return;
        }
      }

      if (!targetDocumentId) {
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
        targetDocumentId = latestId ?? activeDocumentId;
      }

      if (!targetDocumentId) {
        setToast("Save the document before adding it to a folder.");
        return;
      }

      if (targetDocumentId.startsWith("local-")) {
        setToast("Save the document before adding it to a folder.");
        return;
      }

      try {
        const response = await fetch("/api/folders/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folderId,
            documentId: targetDocumentId
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
          folderFromState?.name ||
          folders.find((folder) => folder.id === folderId)?.name ||
          "folder";
        setToast(`Added to ${folderName}.`);

        const folderReference: DocumentFolderReference = {
          id: payload?.folder?.id ?? folderId,
          name: folderName
        };

        const documentWasTracked = savedDocsRef.current.some((doc) => doc.id === targetDocumentId);

        setSavedDocs((prev) => {
          let updated = false;
          const next = prev.map((doc) => {
            if (doc.id !== targetDocumentId) {
              return doc;
            }
            const hasFolder = doc.folders.some((folder) => folder.id === folderReference.id);
            if (hasFolder) {
              return doc;
            }
            updated = true;
            return {
              ...doc,
              folders: [...doc.folders, folderReference]
            };
          });
          return updated ? sortSavedDocs(next) : next;
        });

        fetchFolders();
        if (!documentWasTracked) {
          void fetchSavedDocs();
        }
      } catch (error) {
        console.error("assign document to folder failed:", error);
        setToast("Unable to add document to folder.");
      }
    },
    [activeDocumentId, fetchFolders, fetchSavedDocs, folders, isAuthenticated, saveCurrentDocument]
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

  const handlePinFolder = useCallback(
    async (folder: FolderSummary) => {
      const newPinnedState = !folder.pinned;
      
      // Update local state immediately for instant UI feedback
      setFolders((prev) => {
        const next = prev.map((entry) =>
          entry.id === folder.id ? { ...entry, pinned: newPinnedState } : entry
        );
        // Sort: pinned first, then by creation date
        return next.sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
      });
      
      // Persist to database for authenticated users
      if (!isAuthenticated) {
        return;
      }
      
      try {
        const response = await fetch(`/api/folders/${folder.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinned: newPinnedState })
        });
        
        if (response.ok) {
          await fetchFolders();
        } else {
          // Revert optimistic update on error
          setFolders((prev) => {
            const next = prev.map((entry) =>
              entry.id === folder.id ? { ...entry, pinned: folder.pinned ?? false } : entry
            );
            return next.sort((a, b) => {
              if (a.pinned && !b.pinned) return -1;
              if (!a.pinned && b.pinned) return 1;
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });
          });
          
          // Try to parse error message from response
          let errorMessage = "Unknown error";
          try {
            const errorData = await response.json().catch(() => null);
            if (errorData?.error) {
              errorMessage = typeof errorData.error === "string" ? errorData.error : JSON.stringify(errorData.error);
            } else {
              const errorText = await response.text().catch(() => null);
              if (errorText) {
                errorMessage = errorText;
              }
            }
          } catch {
            const errorText = await response.text().catch(() => null);
            if (errorText) {
              errorMessage = errorText;
            }
          }
          
          setToast(`Failed to update folder pin status: ${errorMessage}`);
        }
      } catch (error) {
        // Revert optimistic update on network errors
        setFolders((prev) => {
          const next = prev.map((entry) =>
            entry.id === folder.id ? { ...entry, pinned: folder.pinned ?? false } : entry
          );
          return next.sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          });
        });
        setToast(`Failed to update folder pin status: Network error. Please try again.`);
      }
    },
    [isAuthenticated, setToast, fetchFolders]
  );

  const createFolder = useCallback(
    async (name: string): Promise<FolderSummary | null> => {
      if (!isAuthenticated) {
        setToast("Create a free account to organize documents into folders.");
        return null;
      }

      const trimmedName = name.trim();
      if (!trimmedName) {
        setFolderDialogError("Folder name cannot be empty.");
        return null;
      }

      if (trimmedName.length > 30) {
        setFolderDialogError("Folder name must be 30 characters or less.");
        return null;
      }

      const duplicate = folders.some((folder) => folder.name.toLowerCase() === trimmedName.toLowerCase());
      if (duplicate) {
        setFolderDialogError("You already have a folder with that name.");
        return null;
      }

      try {
        const response = await fetch("/api/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmedName })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setFolderDialogError(formatErrorMessage(payload?.error, "Unable to create folder."));
          return null;
        }

        const normalizedFolder: FolderSummary = {
          id: payload.id,
          name: payload.name ?? trimmedName,
          createdAt: payload.createdAt ?? new Date().toISOString(),
          documentCount: typeof payload.documentCount === "number" ? payload.documentCount : 0
        };
        setFolders((prev) => [normalizedFolder, ...prev.filter((folder) => folder.id !== normalizedFolder.id)]);
        return normalizedFolder;
      } catch (error) {
        console.error("create folder failed:", error);
        setFolderDialogError("Unable to create folder.");
        return null;
      }
    },
    [folders, isAuthenticated, setToast]
  );

  const openFolderDialog = useCallback(
    (options?: { assignActiveDocument?: boolean; documentId?: string | null }) => {
      if (!isAuthenticated) {
        setToast("Create a free account to organize documents into folders.");
        return;
      }
      setFolderDialogError(null);
      setFolderDialogState({
        assignActiveDocument: options?.assignActiveDocument,
        documentId: options?.documentId ?? null
      });
    },
    [isAuthenticated, setToast]
  );

  const closeFolderDialog = useCallback(() => {
    if (folderDialogLoading) {
      return;
    }
    setFolderDialogState(null);
    setFolderDialogError(null);
  }, [folderDialogLoading]);

  const handleFolderDialogSubmit = useCallback(
    async (name: string) => {
      if (!folderDialogState) {
        return;
      }
      setFolderDialogLoading(true);
      setFolderDialogError(null);
      try {
        const folder = await createFolder(name);
        if (!folder) {
          return;
        }
        if (folderDialogState.assignActiveDocument) {
          await assignDocumentToFolder(folder.id, {
            folderName: folder.name,
            documentId: folderDialogState.documentId ?? undefined
          });
        } else if (folderDialogState.documentId) {
          await assignDocumentToFolder(folder.id, {
            folderName: folder.name,
            documentId: folderDialogState.documentId
          });
        }
        setFolderDialogState(null);
        setFolderDialogError(null);
      } finally {
        setFolderDialogLoading(false);
      }
    },
    [assignDocumentToFolder, createFolder, folderDialogState]
  );

  const handleOpenFolderPicker = useCallback(() => {
    if (!isAuthenticated) {
      setToast("Create a free account to organize documents into folders.");
      return;
    }
    if (!activeDocumentId) {
      setToast("Open a document before adding it to a folder.");
      return;
    }
    if (!folders.length) {
      openFolderDialog({ assignActiveDocument: true });
      return;
    }
    setFolderPickerOpen(true);
  }, [activeDocumentId, folders.length, isAuthenticated, openFolderDialog, setToast]);

  const handleFolderSelection = useCallback(
    (folderId: string) => {
      setFolderPickerOpen(false);
      void assignDocumentToFolder(folderId);
    },
    [assignDocumentToFolder]
  );
  const handleFolderPickerClose = useCallback(() => {
    setFolderPickerOpen(false);
  }, []);

  const handleCreateFolderFromPicker = useCallback(() => {
    setFolderPickerOpen(false);
    openFolderDialog({ assignActiveDocument: true });
  }, [openFolderDialog]);

  const handleOpenCreateFolder = useCallback(() => {
    openFolderDialog();
  }, [openFolderDialog]);

  const handleDocDroppedOnFolder = useCallback(
    (folderId: string, docId: string) => {
      if (!isAuthenticated) {
        setToast("Create a free account to organize documents into folders.");
        return;
      }
      if (!docId) {
        return;
      }
      const targetDoc = savedDocsRef.current.find((doc) => doc.id === docId);
      if (!targetDoc || docId.startsWith("local-")) {
        setToast("Save the document before adding it to a folder.");
        return;
      }
      void assignDocumentToFolder(folderId, {
        folderName: folders.find((folder) => folder.id === folderId)?.name,
        documentId: docId
      });
    },
    [assignDocumentToFolder, folders, isAuthenticated, setToast]
  );

  const handleDocumentMenuPinToggle = useCallback(() => {
    if (!activeDocumentId) {
      setToast("Save the document before pinning.");
      return;
    }
    const savedDoc = savedDocsRef.current.find((doc) => doc.id === activeDocumentId);
    if (!savedDoc) {
      setToast("Save the document before pinning.");
      return;
    }
    void handlePinDocument(savedDoc);
  }, [activeDocumentId, handlePinDocument, setToast]);

  const isLoadingDocRef = useRef(false);
  
  const handleLoadDoc = useCallback(
    async (doc: SavedDoc) => {
      if (activeDocumentId && activeDocumentId !== doc.id) {
        const currentDoc = outputsRef.current.find((o) => o.id === activeDocumentId);
        if (currentDoc && currentDoc.content.trim()) {
          await saveCurrentDocument(activeDocumentId, currentDoc.content);
        }
      }

      isLoadingDocRef.current = true;
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
      
      // Reset flag after a short delay to allow editor to initialize
      setTimeout(() => {
        isLoadingDocRef.current = false;
      }, 100);
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
  }, [activeDocumentId, autosaveTimeout, saveCurrentDocument]);

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

      // Check if title actually changed before updating lastEditedAt
      const savedDoc = savedDocsRef.current.find((d) => d.id === activeDocumentId);
      const titleChanged = !savedDoc || savedDoc.title !== title;
      
      bumpSavedDoc(activeDocumentId, (doc) => ({
        ...doc,
        title
      }), titleChanged);

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
        const clientId = crypto.randomUUID();
        const newDoc: WriterOutput = ensurePlaceholderState({
          id: clientId,
          instanceKey: clientId,
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
          const instanceKey = newDoc.instanceKey ?? newDoc.id;
          setOutputs((prev) =>
            prev.map((entry) =>
              entry.id === newDoc.id ? { ...entry, id: savedId, instanceKey } : entry
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
          const instanceKey = currentDoc?.instanceKey ?? activeDocumentId;
          setOutputs((prev) =>
            prev.map((entry) =>
              entry.id === activeDocumentId ? { ...entry, id: savedId, instanceKey } : entry
            )
          );
          setActiveDocumentId(savedId);
        }
        // Saved docs list will be updated by persistDocumentToServer (via fetchSavedDocs or persistLocalDocEntry)
        return;
      }

      // For subsequent changes, use debounced autosave (only if content is non-empty)
      if (isNowNonEmpty) {
        // Skip updating if we're currently loading a document (prevents order changes on click)
        if (isLoadingDocRef.current) {
          return;
        }
        
        // Check if content actually changed before updating lastEditedAt
        const savedDoc = savedDocsRef.current.find((d) => d.id === activeDocumentId);
        const contentChanged = !savedDoc || savedDoc.content !== content;
        
        // Update saved docs list for existing documents (only update timestamp if content changed)
        bumpSavedDoc(activeDocumentId, (doc) => ({
          ...doc,
          content
        }), contentChanged);

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
            const instanceKey = currentDoc?.instanceKey ?? activeDocumentId;
            setOutputs((prev) =>
              prev.map((entry) =>
                entry.id === activeDocumentId ? { ...entry, id: savedId, instanceKey } : entry
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

  // Handle typing events for guest notice
  const handleTyping = useCallback(() => {
    if (!isGuest || showGuestTypingNotice) return;
    
    const now = Date.now();
    
    // If this is the first typing event, start tracking
    if (typingStartTimeRef.current === null) {
      typingStartTimeRef.current = now;
      
      // Set timeout to show notice after 10 seconds
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = setTimeout(() => {
        setShowGuestTypingNotice(true);
      }, 10000); // 10 seconds
    }
  }, [isGuest, showGuestTypingNotice]);

  // Cleanup typing timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
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

  // Calculate brand cards for display
  const brandCards = useMemo(() => {
    if (isAuthenticated && allBrands.length > 0) {
      // For authenticated users, use all brands from database
      // Use activeBrandId state directly for immediate UI updates
      return allBrands.map((brand) => ({
        id: brand.id,
        name: brand.name?.trim() || "Custom Brand",
        summary: brand.info,
        hasSummary: Boolean(brand.info?.trim()),
        // Get key messages for this specific brand
        keyMessages: brandKeyMessagingMap.get(brand.id) || []
      }));
    } else if (hasBrand || brandKeyMessaging.length) {
      // For guests or legacy, use single brand from state
      return [
        {
          id: "brand-primary",
          name: brandName?.trim() || "Custom Brand",
          summary: brandSummary,
          hasSummary: Boolean(brandSummary?.trim()),
          keyMessages: brandKeyMessaging
        }
      ];
    }
    return [];
  }, [isAuthenticated, allBrands, brandName, brandSummary, brandKeyMessaging, brandKeyMessagingMap, hasBrand]);

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
          folders={folders}
          canOrganizeFolders={isAuthenticated}
          brandName={brandName}
          brandSummary={brandSummary}
          hasBrand={hasBrand}
          brandKeyMessaging={brandKeyMessaging}
          brandCards={brandCards}
          onRemoveKeyMessaging={handleRemoveKeyMessaging}
          onAddKeyMessaging={handleAddKeyMessaging}
          onClearBrand={handleClearBrand}
          onUseBrand={handleUseBrand}
          activeBrandId={activeBrandId}
          userName={user.name}
          topOffset={30}
          bottomOffset={hasOutputs ? 140 : 32}
          isDesktop={isDesktop}
          isAuthenticated={isAuthenticated}
          activeStyleId={activeStyle?.id}
          onSelect={handleLoadDoc}
              onToggle={() => setSidebarOpen((prev) => !prev)}
          onOpen={() => setSidebarOpen(true)}
          onApplyStyle={handleApplyStyle}
          onClearStyle={handleClearStyle}
          onTabChange={(tab) => setSidebarTab(tab)}
          onPinDocument={handlePinDocument}
          onPinFolder={handlePinFolder}
          onCreateFolder={handleOpenCreateFolder}
          onDocumentDroppedOnFolder={handleDocDroppedOnFolder}
          settingsOpen={sheetOpen}
        />
      )}
      <div className={cn("flex min-h-screen flex-1 flex-col pb-[350px] transition-all duration-300", sidebarOpen && isAuthenticated && isDesktop ? "lg:ml-[320px]" : undefined)}>
        <div className="flex-1 px-4 py-8 sm:px-6">
          <div className="mx-auto w-full max-w-5xl">
            {guestLimitEnabled && isGuest && guestLimitReached && <RegisterGate />}
            {isGuest && showGuestTypingNotice && (
              <GuestTypingNotice onClose={() => setShowGuestTypingNotice(false)} />
            )}
            <DocumentEditor
              document={activeDocument}
              onDocumentChange={handleDocumentChange}
              onTitleChange={handleTitleChange}
              onSelectionChange={handleSelectionChange}
              onEditorReady={handleEditorReady}
              loading={loading && activeDocument?.isPending}
              brandSummary={brandSummary}
              activeBrandId={activeBrandId}
              styleGuide={activeStyle ? { name: activeStyle.name, description: activeStyle.description } : null}
              horizontalPadding={documentHorizontalPadding}
              onTogglePin={isAuthenticated ? handleDocumentMenuPinToggle : undefined}
              onRequestAddToFolder={isAuthenticated ? handleOpenFolderPicker : undefined}
              canOrganizeDocuments={isAuthenticated}
              documentPinned={activeDocPinned}
              onSaveStyle={handleSaveCurrentStyle}
              onTyping={handleTyping}
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
              activeBrand={activeBrandId && hasBrand ? { id: activeBrandId, name: (brandName?.trim() || allBrands.find(b => b.id === activeBrandId)?.name?.trim() || "Custom Brand") } : null}
              onClearBrand={handleClearBrandForComposeBar}
              hasSelection={!!selectedText}
              selectedText={selectedText}
              isGuest={isGuest}
            />
          </div>
        </div>
      </div>
      <FolderPickerDialog
        open={folderPickerOpen && folders.length > 0}
        folders={folders}
        onClose={handleFolderPickerClose}
        onSelect={handleFolderSelection}
        onCreateFolder={handleCreateFolderFromPicker}
      />
      <FolderDialog
        open={Boolean(folderDialogState)}
        error={folderDialogError}
        loading={folderDialogLoading}
        onClose={closeFolderDialog}
        onSubmit={handleFolderDialogSubmit}
        onResetError={() => setFolderDialogError(null)}
      />
      <SettingsSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        settings={settings}
        onChange={setSettings}
        anchorRect={sheetAnchor}
        onBrandUpdate={handleBrandSummaryUpdate}
        initialBrandDefined={hasBrand}
        activeBrandId={activeBrandId}
        styles={styleDocuments}
        activeStyleId={activeStyle?.id}
        onApplyStyle={handleApplyStyle}
        onClearStyle={handleClearStyle}
      />
      <Toast message={toast} onClose={() => setToast(null)} />
      <StyleGenerationPopup
        open={styleGenPopup.open}
        title={styleGenPopup.title}
        summary={styleGenPopup.summary}
        generating={styleGenPopup.generating}
        logs={styleGenPopup.logs}
        progress={styleGenPopup.progress}
        status={styleGenPopup.status}
        onClose={() => setStyleGenPopup({ open: false, title: null, summary: null, generating: false, logs: [], progress: 0, status: "" })}
      />
    </div>
  );
}

function TruncateTitle({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [truncatedText, setTruncatedText] = useState(text);

  useEffect(() => {
    const element = textRef.current;
    if (!element) return;

    const measureAndTruncate = () => {
      const container = element.parentElement;
      if (!container) return;

      // Calculate available width: container width minus padding (46px right padding)
      const containerWidth = container.clientWidth;
      const paddingRight = 46; // pr-[46px]
      const paddingLeft = 20; // p-5 = 20px
      const maxWidth = containerWidth - paddingLeft - paddingRight;

      const words = text.split(' ');
      let result = '';
      
      // Create a temporary element to measure text width
      const tempElement = document.createElement('span');
      tempElement.style.visibility = 'hidden';
      tempElement.style.position = 'absolute';
      tempElement.style.fontSize = window.getComputedStyle(element).fontSize;
      tempElement.style.fontWeight = window.getComputedStyle(element).fontWeight;
      tempElement.style.fontFamily = window.getComputedStyle(element).fontFamily;
      tempElement.style.whiteSpace = 'nowrap';
      document.body.appendChild(tempElement);

      for (const word of words) {
        const testText = result ? `${result} ${word}` : word;
        tempElement.textContent = testText;
        
        if (tempElement.offsetWidth <= maxWidth) {
          result = testText;
        } else {
          break;
        }
      }

      document.body.removeChild(tempElement);
      setTruncatedText(result || words[0] || '');
    };

    // Small delay to ensure layout is complete
    const timeoutId = setTimeout(measureAndTruncate, 0);
    
    const resizeObserver = new ResizeObserver(measureAndTruncate);
    resizeObserver.observe(element.parentElement || element);
    
    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, [text]);

  return (
    <p ref={textRef} className={className} style={style}>
      {truncatedText}
    </p>
  );
}

function AutoFitText({ children, className, maxFontSize = 15, minFontSize = 8, lineHeight = 1.33 }: { children: string; className?: string; maxFontSize?: number; minFontSize?: number; lineHeight?: number }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const textElement = textRef.current;
    const containerElement = containerRef.current;
    if (!textElement || !containerElement) return;

    const adjustFontSize = () => {
      const containerHeight = containerElement.clientHeight;
      const containerWidth = containerElement.clientWidth;
      let fontSize = maxFontSize;
      
      // Reset to max size first
      textElement.style.fontSize = `${fontSize}px`;
      textElement.style.lineHeight = `${lineHeight}`;
      
      // Check if text fits - allow up to 3 lines
      while (fontSize > minFontSize) {
        const textHeight = textElement.scrollHeight;
        const textWidth = textElement.scrollWidth;
        const maxHeight = containerHeight;
        const maxWidth = containerWidth;
        
        if (textHeight <= maxHeight && textWidth <= maxWidth) {
          break;
        }
        
        fontSize -= 0.5;
        textElement.style.fontSize = `${fontSize}px`;
      }
    };

    // Small delay to ensure layout is complete
    const timeoutId = setTimeout(adjustFontSize, 0);
    
    // Adjust on resize
    const resizeObserver = new ResizeObserver(() => {
      adjustFontSize();
    });
    resizeObserver.observe(containerElement);
    
    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, [children, maxFontSize, minFontSize, lineHeight]);

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center pt-1">
      <span ref={textRef} className={cn("font-semibold w-full text-center break-words line-clamp-3", className)}>
        {children}
      </span>
    </div>
  );
}

type FolderDialogProps = {
  open: boolean;
  loading: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
  onResetError?: () => void;
};

function FolderDialog({ open, loading, error, onSubmit, onClose, onResetError }: FolderDialogProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setValue("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-brand-stroke/60 bg-brand-panel px-5 py-6 text-left shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">Create folder</h3>
          <button
            type="button"
            className="text-brand-muted transition hover:text-white disabled:opacity-50"
            onClick={onClose}
            disabled={loading}
          >
            <span className="material-symbols-outlined text-xl leading-none">close</span>
          </button>
        </div>
        <p className="mt-1 text-sm text-brand-muted">Give your folder a name to organize docs.</p>
        <div className="mt-4">
          <input
            ref={inputRef}
            type="text"
            maxLength={30}
            className="w-full rounded-xl border border-brand-stroke/60 bg-brand-background/40 px-3 py-2 text-sm text-white placeholder:text-brand-muted focus:border-white focus:outline-none"
            placeholder="Folder name"
            value={value}
            onChange={(event) => {
              const newValue = event.target.value.slice(0, 30);
              setValue(newValue);
              onResetError?.();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && value.trim() && !loading) {
                onSubmit(value);
              }
            }}
            disabled={loading}
          />
          <div className="mt-1 flex justify-end">
            <span className={cn(
              "text-xs",
              value.length >= 30 ? "text-red-400" : "text-brand-muted"
            )}>
              {value.length}/30
            </span>
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-full border border-brand-stroke/60 px-4 py-1.5 text-xs font-semibold text-brand-muted transition hover:border-white hover:text-white disabled:opacity-50"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-full bg-brand-blue px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-blue/80 disabled:opacity-50"
            onClick={() => onSubmit(value)}
            disabled={loading || !value.trim()}
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

type FolderPickerDialogProps = {
  open: boolean;
  folders: FolderSummary[];
  onClose: () => void;
  onSelect: (folderId: string) => void;
  onCreateFolder: () => void;
};

function FolderPickerDialog({ open, folders, onClose, onSelect, onCreateFolder }: FolderPickerDialogProps) {
  if (!open) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-brand-stroke/60 bg-brand-panel px-5 py-6 text-left shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">Add to folder</h3>
          <button
            type="button"
            className="text-brand-muted transition hover:text-white"
            onClick={onClose}
          >
            <span className="material-symbols-outlined text-xl leading-none">close</span>
          </button>
        </div>
        <div className="mt-4 max-h-60 space-y-2 overflow-y-auto">
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className="flex w-full items-center justify-between rounded-3xl border border-brand-stroke/40 px-3 py-2 text-left text-sm text-white transition hover:border-white"
              onClick={() => onSelect(folder.id)}
            >
              <span className="truncate pr-2">{folder.name}</span>
              <span className="text-xs text-white/60">{folder.documentCount} docs</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-brand-blue transition hover:text-white"
          onClick={onCreateFolder}
        >
          <span className="material-symbols-outlined text-base leading-none">add_circle</span>
          Create folder
        </button>
      </div>
    </div>
  );
}

function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  
  return (
    <div
      className={cn(
        "fixed top-1/2 left-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 transform rounded-2xl bg-brand-panel px-4 py-3 text-center text-sm text-brand-text shadow-[0_20px_60px_rgba(0,0,0,0.45)] transition-all duration-300 z-[9999] select-text",
        "opacity-100 translate-y-[-50%] pointer-events-auto"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex-1 text-left">{message}</span>
        <button
          onClick={onClose}
          className="flex-shrink-0 rounded-full p-1 hover:bg-brand-background/50 transition-colors"
          aria-label="Close"
        >
          <span className="material-symbols-outlined text-base leading-none">close</span>
        </button>
      </div>
    </div>
  );
}

function StyleGenerationPopup({ 
  open, 
  title, 
  summary, 
  generating,
  logs,
  progress,
  status,
  onClose 
}: { 
  open: boolean; 
  title: string | null; 
  summary: string | null; 
  generating: boolean;
  logs: Array<{ step: string; details?: Record<string, any>; timestamp: string }>;
  progress: number;
  status: string;
  onClose: () => void;
}) {
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);
  
  if (!open) return null;
  
  return (
    <Transition show={open} as={Fragment}>
      <Dialog onClose={onClose} className="fixed inset-0 z-[1300]">
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
        </Transition.Child>
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="relative w-full max-w-2xl rounded-2xl border border-brand-stroke/60 bg-brand-panel p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold text-white">
                    {generating ? "Generating Style..." : "Style Generated"}
                  </h3>
                  {generating && (
                    <span className="text-xs text-brand-muted bg-brand-background/50 px-2 py-1 rounded-full">
                      {status || "Processing"}
                    </span>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="rounded-full p-1 text-brand-muted transition hover:bg-brand-background/50 hover:text-white"
                  aria-label="Close"
                >
                  <span className="material-symbols-outlined text-xl leading-none">close</span>
                </button>
              </div>
              
              {/* Progress bar */}
              <div className="mb-4">
                <div className="h-1.5 bg-brand-background/40 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-brand-blue transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-brand-muted">{progress}%</span>
                  <span className="text-xs text-brand-muted">{status}</span>
                </div>
              </div>
              
              {/* Live logs feed */}
              <div className="mb-4">
                <p className="text-xs uppercase tracking-[0.2em] text-brand-muted mb-2">Live Activity Log</p>
                <div className="bg-brand-background/30 rounded-lg border border-brand-stroke/30 h-48 overflow-y-auto font-mono text-xs">
                  <div className="p-3 space-y-1.5">
                    {logs.length === 0 ? (
                      <div className="flex items-center gap-2 text-brand-muted">
                        <div className="h-1.5 w-1.5 rounded-full bg-brand-blue animate-pulse" />
                        <span>Initializing...</span>
                      </div>
                    ) : (
                      logs.map((log, index) => {
                        const time = new Date(log.timestamp).toLocaleTimeString('en-US', { 
                          hour12: false, 
                          hour: '2-digit', 
                          minute: '2-digit', 
                          second: '2-digit',
                          fractionalSecondDigits: 3
                        });
                        const isError = log.step.toLowerCase().includes('error') || log.step.toLowerCase().includes('failed');
                        const isSuccess = log.step.toLowerCase().includes('success') || log.step.toLowerCase().includes('complete');
                        
                        return (
                          <div key={index} className="flex items-start gap-2 group">
                            <span className="text-brand-muted/60 flex-shrink-0 tabular-nums">{time}</span>
                            <span className={`flex-shrink-0 ${isError ? 'text-red-400' : isSuccess ? 'text-green-400' : 'text-brand-blue'}`}>
                              {isError ? '✗' : isSuccess ? '✓' : '→'}
                            </span>
                            <span className={`${isError ? 'text-red-300' : isSuccess ? 'text-green-300' : 'text-brand-text'}`}>
                              {log.step}
                            </span>
                            {log.details && Object.keys(log.details).length > 0 && (
                              <span className="text-brand-muted/50 hidden group-hover:inline">
                                {JSON.stringify(log.details)}
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                    <div ref={logsEndRef} />
                  </div>
                </div>
              </div>
              
              {/* Result section - shown when complete */}
              {!generating && (title || summary) && (
                <div className="space-y-4 border-t border-brand-stroke/30 pt-4">
                  {title && (
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-brand-muted mb-2">Style Title</p>
                      <p className="text-lg font-semibold text-white">{title}</p>
                    </div>
                  )}
                  {summary && (
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-brand-muted mb-2">Style Summary</p>
                      <p className="text-sm text-brand-text leading-relaxed">{summary}</p>
                    </div>
                  )}
                </div>
              )}
              
              {!generating && !title && !summary && (
                <p className="text-sm text-brand-muted border-t border-brand-stroke/30 pt-4">
                  Style generation completed.
                </p>
              )}
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
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
          href="/membership"
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

function GuestTypingNotice({ onClose }: { onClose: () => void }) {
  return (
    <div className="mb-6 rounded-3xl border border-brand-blue/50 bg-brand-panel/90 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.4)]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="text-sm text-brand-text">
            Register to save your work, bookmark writing styles and define brand voices
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/membership"
            className="rounded-full bg-brand-blue px-5 py-2 text-sm font-semibold text-white hover:bg-brand-blue/80 transition"
          >
            Register
          </Link>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-brand-muted hover:text-white transition"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-xl leading-none">close</span>
          </button>
        </div>
      </div>
    </div>
  );
}

type BrandCard = {
  id: string;
  name: string;
  summary: string | null;
  hasSummary: boolean;
  keyMessages: BrandKeyMessage[];
};

type WorkspaceSidebarProps = {
  open: boolean;
  activeTab: SidebarTab;
  activeDocumentId: string | null;
  docs: SavedDoc[];
  styles: SavedDoc[];
  folders: FolderSummary[];
  canOrganizeFolders: boolean;
  brandName: string | null;
  brandSummary: string | null;
  hasBrand: boolean;
  brandKeyMessaging: BrandKeyMessage[];
  brandCards: BrandCard[];
  onRemoveKeyMessaging: (id: string) => Promise<void>;
  onAddKeyMessaging?: (text: string) => Promise<{ success: boolean; error?: string }>;
  onClearBrand?: () => Promise<{ success: boolean; error?: string }>;
  onUseBrand?: (brandId?: string) => void;
  activeBrandId?: string | null;
  userName: string;
  topOffset: number;
  bottomOffset: number;
  isDesktop: boolean;
  isAuthenticated: boolean;
  activeStyleId?: string;
  onToggle: () => void;
  onOpen: () => void;
  onTabChange: (tab: SidebarTab) => void;
  onSelect: (doc: SavedDoc) => void;
  onApplyStyle: (style: SavedDoc) => void;
  onClearStyle?: () => void;
  onPinDocument?: (doc: SavedDoc) => void;
  onPinFolder?: (folder: FolderSummary) => void;
  onCreateFolder: () => void;
  onDocumentDroppedOnFolder?: (folderId: string, docId: string) => void;
  settingsOpen?: boolean;
};

function WorkspaceSidebar({
  open,
  activeTab,
  activeDocumentId,
  docs,
  styles,
  folders,
  canOrganizeFolders,
  brandName,
  brandSummary,
  hasBrand,
  brandKeyMessaging,
  brandCards,
  onRemoveKeyMessaging,
  onAddKeyMessaging,
  onClearBrand,
  onUseBrand,
  activeBrandId,
  userName,
  topOffset,
  bottomOffset,
  isDesktop,
  isAuthenticated,
  activeStyleId,
  onToggle,
  onOpen,
  onTabChange,
  onSelect,
  onApplyStyle,
  onClearStyle,
  onPinDocument,
  onPinFolder,
  onCreateFolder,
  onDocumentDroppedOnFolder,
  settingsOpen = false
}: WorkspaceSidebarProps) {
  const [hoveredTimestampId, setHoveredTimestampId] = useState<string | null>(null);
  const timestampTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [folderFilterId, setFolderFilterId] = useState<string | null>(null);
  const [draggingDocId, setDraggingDocId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

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
    // Clear folder filter when switching to docs tab
    if (nextTab === "docs" && folderFilterId !== null) {
      setFolderFilterId(null);
    }
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

  const handleDocDragStart = useCallback((docId: string, event: React.DragEvent<HTMLLIElement>) => {
    setDraggingDocId(docId);
    if (event.dataTransfer) {
      event.dataTransfer.setData("text/plain", docId);
      event.dataTransfer.effectAllowed = "move";
    }
  }, []);

  const handleDocDragEnd = useCallback(() => {
    setDraggingDocId(null);
    setDragOverFolderId(null);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timestampTimeoutRef.current) {
        clearTimeout(timestampTimeoutRef.current);
      }
    };
  }, []);

  const effectiveFolderFilterId = useMemo(() => {
    if (!folderFilterId) {
      return null;
    }
    return folders.some((folder) => folder.id === folderFilterId) ? folderFilterId : null;
  }, [folderFilterId, folders]);

  const filteredDocs = useMemo(() => {
    if (!effectiveFolderFilterId) {
      return docs;
    }
    return docs.filter((doc) => doc.folders?.some((folder) => folder.id === effectiveFolderFilterId));
  }, [docs, effectiveFolderFilterId]);

  // Helper function to truncate text at word boundaries
  function truncateAtWordBoundary(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    return lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated;
  }

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
      <ul className="space-y-1.5">
        {items.map((doc) => {
          const isActive = activeDocumentId === doc.id;
          const preview = getContentPreview(doc.content);
          const fullTitle = doc.title || "Untitled doc";
          const docFolders = doc.folders ?? [];
          const canDragDoc = canOrganizeFolders && !doc.id.startsWith("local-");
          return (
            <li
              key={doc.id}
              className={cn(
                "relative group",
                canDragDoc ? "cursor-grab" : undefined,
                draggingDocId === doc.id ? "opacity-70" : undefined
              )}
              draggable={canDragDoc}
              onDragStart={(event) => handleDocDragStart(doc.id, event)}
              onDragEnd={handleDocDragEnd}
            >
              <button
                type="button"
                onMouseDown={handleButtonMouseDown}
                onClick={() => onSelect(doc)}
                className={cn(
                  "w-full h-[90px] rounded-[7px] border border-brand-stroke/40 bg-brand-background/60 p-5 text-left transition flex flex-col",
                  isActive
                    ? "border-white shadow-[0_20px_45px_rgba(0,0,0,0.45)]"
                    : "hover:border-white/50"
                )}
                tabIndex={-1}
              >
                <TruncateTitle 
                  text={fullTitle}
                  className="text-lg font-semibold pr-[46px] mb-[2.5px] pb-0.5 overflow-hidden whitespace-nowrap"
                  style={{ lineHeight: '1.6rem', color: 'rgba(255, 255, 255, 0.75)' }}
                />
                {preview && (
                  <p className="text-xs font-semibold text-brand-muted/70 mt-0.5 overflow-hidden whitespace-nowrap">
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

  function renderFolderGrid() {
    if (!canOrganizeFolders) {
      return (
        <div className="pt-6 border-t border-brand-stroke/40 bg-brand-panel/95 backdrop-blur-sm">
          <p className="mb-4 text-sm font-semibold text-white">Folders</p>
          <div className="rounded-2xl border border-brand-stroke/40 bg-brand-background/60 px-4 py-3 text-xs text-brand-muted">
            Sign in to create folders and organize docs.
          </div>
        </div>
      );
    }

    return (
      <div className="border-t border-brand-stroke/40 bg-brand-panel/95 backdrop-blur-sm">
        <div className="pt-2 pb-2 flex items-center gap-2 px-3 bg-black/20 rounded">
          <p className="text-sm font-semibold text-white">Folders</p>
          <button
            type="button"
            onMouseDown={handleButtonMouseDown}
            onClick={onCreateFolder}
            className="inline-flex items-center justify-center rounded-full border border-brand-stroke/50 py-0.5 px-0.5 text-xs text-brand-muted transition hover:border-white hover:text-white"
            title="Create folder"
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '16px' }}>add</span>
          </button>
        </div>
        {folders.length === 0 ? (
          <button
            type="button"
            onMouseDown={handleButtonMouseDown}
            onClick={onCreateFolder}
            className="inline-flex items-center gap-2 rounded-full border border-dashed border-brand-stroke/60 px-4 py-2 text-xs font-semibold text-brand-text transition hover:border-white hover:text-white"
          >
            <span className="material-symbols-outlined text-base leading-none">add_circle</span>
            Create folder
          </button>
        ) : (
          <div className="max-h-[200px] overflow-y-auto px-3 pt-2">
            <div className="grid grid-cols-3 gap-2">
            {folders.map((folder: FolderSummary) => {
              const isSelected = effectiveFolderFilterId === folder.id;
              const isDragTarget = dragOverFolderId === folder.id;
              const allowDrop = Boolean(onDocumentDroppedOnFolder && draggingDocId);
              return (
                <button
                  key={folder.id}
                  type="button"
                  onMouseDown={handleButtonMouseDown}
                  onClick={() =>
                    setFolderFilterId((current) => (current === folder.id ? null : folder.id))
                  }
                  onDragOver={(event) => {
                    if (!allowDrop) return;
                    event.preventDefault();
                    setDragOverFolderId(folder.id);
                  }}
                  onDragLeave={(event) => {
                    if (!allowDrop) return;
                    event.preventDefault();
                    if (dragOverFolderId === folder.id) {
                      setDragOverFolderId(null);
                    }
                  }}
                  onDrop={(event) => {
                    if (!allowDrop) return;
                    event.preventDefault();
                    setDragOverFolderId(null);
                    const droppedId = event.dataTransfer?.getData("text/plain") || draggingDocId;
                    if (droppedId) {
                      onDocumentDroppedOnFolder?.(folder.id, droppedId);
                    }
                  }}
                  className={cn(
                    "aspect-square relative flex flex-col items-center justify-start rounded-2xl border transition p-[7px] group",
                    isSelected ? "border-white bg-white/10 text-white" : "border-brand-stroke/50 bg-black/10 text-brand-muted hover:border-white/50 hover:text-white hover:bg-black/15",
                    isDragTarget ? "border-brand-blue text-brand-blue bg-black/15" : undefined
                  )}
                >
                  {onPinFolder && (
                    <div
                      role="button"
                      aria-label="Pin folder"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onPinFolder(folder);
                      }}
                      className={cn(
                        "absolute top-1 right-1 pt-[5px] pr-[5px] pb-0.5 pl-0.5 text-xs text-white/70 opacity-0 transition group-hover:opacity-50 focus-visible:opacity-50 hover:opacity-100 hover:text-white z-10 cursor-pointer",
                        folder.pinned ? "opacity-100 group-hover:opacity-100 hover:!opacity-50 text-brand-blue hover:text-brand-blue" : undefined
                      )}
                      tabIndex={-1}
                    >
                      <span className="material-symbols-rounded text-base leading-none" style={{ transform: 'rotate(45deg) scale(0.66)' }}>push_pin</span>
                    </div>
                  )}
                  <div className="flex-1 w-full min-h-0">
                    <AutoFitText 
                      className="text-white/75"
                      maxFontSize={15}
                      minFontSize={8}
                      lineHeight={1.33}
                    >
                      {folder.name}
                    </AutoFitText>
                  </div>
                  <span className="text-[9px] text-white/60 text-center mt-1">{folder.documentCount}</span>
                </button>
              );
            })}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderStyleList(items: SavedDoc[]) {
    if (!items.length) {
      return <p className="text-sm text-brand-muted">Save a style from any output and it&apos;ll appear here.</p>;
    }

    const activeStyle = activeStyleId ? items.find((style) => style.id === activeStyleId) : null;

    return (
      <div className="flex h-full flex-col">
        {activeStyle && onClearStyle && (
          <div className="h-[24px] pt-[6px] flex items-center justify-center px-3 mb-2 flex-shrink-0 bg-black/20 rounded">
            <button
              type="button"
              onMouseDown={handleButtonMouseDown}
              onClick={() => onClearStyle()}
              className="flex items-center gap-1 text-brand-muted hover:text-[#f00] transition font-semibold text-xs"
            >
              <div className="w-2.5 h-2.5 bg-current" />
              Stop Writing in this Style
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto pt-[4px] px-3">
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
                    <p className="text-sm font-semibold text-white">{style.styleTitle || style.title || "Saved Style"}</p>
                    {activeStyleId === style.id && <span className="text-[10px] font-semibold uppercase text-brand-muted">Applied</span>}
              </div>
                  <p className="mt-2 line-clamp-3 text-xs text-brand-muted/90">
                    {style.styleSummary || "Style summary will appear here after generation."}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  function renderBrandsContent() {
    if (!brandCards.length) {
      return (
        <div className="flex h-full flex-col justify-center pt-[4px] px-3">
          <div className="rounded-2xl border border-dashed border-brand-stroke/50 bg-brand-background/40 p-6 text-center text-sm text-brand-muted">
            <p className="font-semibold text-white">No brands yet</p>
            <p className="mt-2">
              Define your brand inside Settings to generate a summary and start saving key messages.
            </p>
          </div>
        </div>
      );
    }

    const activeBrand = activeBrandId ? brandCards.find((brand) => brand.id === activeBrandId) : null;

    return (
      <div className="flex h-full flex-col">
        {activeBrand && (
          <div className="h-[24px] pt-[6px] flex items-center justify-center px-3 mb-2 flex-shrink-0 bg-black/20 rounded">
            <button
              type="button"
              onMouseDown={handleButtonMouseDown}
              onClick={() => onUseBrand?.(undefined)}
              className="flex items-center gap-1 text-brand-muted hover:text-[#f00] transition font-semibold text-xs"
            >
              <div className="w-2.5 h-2.5 bg-current" />
              Stop Writing As Brand
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto pt-[4px] px-3 space-y-4">
          {brandCards.map((brand) => (
            <BrandCard
              key={brand.id}
              id={brand.id}
              name={brand.name}
              summary={brand.summary}
              hasSummary={brand.hasSummary}
              keyMessages={brand.keyMessages}
              allowKeyMessageActions={isAuthenticated && Boolean(onAddKeyMessaging)}
              onAddKeyMessage={onAddKeyMessaging}
              onRemoveKeyMessage={onRemoveKeyMessaging}
              onClearBrand={onClearBrand}
              onUseBrand={() => onUseBrand?.(brand.id)}
              isActive={activeBrandId === brand.id}
            />
          ))}
        </div>
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
          {!isDesktop && (
            <div className="flex items-center justify-between border-b border-brand-stroke/40 px-4 py-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-brand-muted">Library</p>
                <p className="text-sm font-semibold text-white">Docs, styles & brands</p>
              </div>
              <button
                type="button"
                onClick={onToggle}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-brand-stroke/60 text-white transition hover:border-white hover:text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                aria-label="Hide panel"
              >
                <span className="material-symbols-outlined text-2xl leading-none">chevron_left</span>
              </button>
            </div>
          )}
          <Tab.Group className="flex flex-1 flex-col min-h-0" selectedIndex={selectedIndex} onChange={handleTabChange}>
            <Tab.List className="flex bg-brand-background/40 text-xs font-semibold uppercase flex-shrink-0 w-full p-1.5 h-[60px]">
              {tabs.map((tab) => (
                <Tab
                  key={tab.id}
                  onClick={() => {
                    // Clear folder filter when clicking docs tab
                    if (tab.id === "docs" && folderFilterId !== null) {
                      setFolderFilterId(null);
                    }
                  }}
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
            <div className="flex-1 min-h-0 overflow-hidden">
              <Tab.Panels className="h-full">
                <Tab.Panel className="h-full flex flex-col focus:outline-none">
                  {(() => {
                    const activeFolder = effectiveFolderFilterId ? folders.find((f) => f.id === effectiveFolderFilterId) : null;
                    if (!activeFolder) return null;
                    return (
                      <div className="h-[24px] pt-[6px] flex items-center justify-between px-3 mb-2 flex-shrink-0 bg-black/20 rounded">
                        <div className="flex items-center gap-1 text-xs font-semibold">
                          <button
                            type="button"
                            onMouseDown={handleButtonMouseDown}
                            onClick={() => setFolderFilterId(null)}
                            className="text-brand-muted hover:text-white transition font-semibold"
                          >
                            All
                          </button>
                          <span className="material-symbols-outlined leading-none text-brand-muted" style={{ fontSize: '10.5px' }}>chevron_right</span>
                          <span className="material-symbols-outlined leading-none text-white" style={{ fontSize: '10px' }}>folder</span>
                          <span className="text-white font-semibold">{activeFolder.name}</span>
                        </div>
                        <button
                          type="button"
                          onMouseDown={handleButtonMouseDown}
                          onClick={() => setFolderFilterId(null)}
                          className="text-brand-muted hover:text-white transition pt-[3px]"
                          aria-label="Close folder"
                        >
                          <span className="material-symbols-outlined leading-none" style={{ fontSize: '16px' }}>close</span>
                        </button>
                      </div>
                    );
                  })()}
                  <div className="flex-1 min-h-0 overflow-y-auto pt-[4px] px-3">
                    {renderDocList(
                      filteredDocs,
                      effectiveFolderFilterId ? "No docs in this folder yet." : "No docs yet. Generate something to see it here."
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    {renderFolderGrid()}
                  </div>
                </Tab.Panel>
                <Tab.Panel className="h-full focus:outline-none">
                  {renderStyleList(styles)}
                </Tab.Panel>
                <Tab.Panel className="h-full focus:outline-none">
                  {renderBrandsContent()}
                </Tab.Panel>
              </Tab.Panels>
            </div>
          </Tab.Group>
          <div className="mt-auto border-t border-brand-stroke/40 pt-2.5 pb-3 px-5 flex-shrink-0">
            <div className="flex items-center justify-between gap-3">
              <Link href="/membership" className="flex items-center gap-[3px] hover:opacity-80 transition-opacity">
                <ProfileAvatar name={userName} size={16} />
                <p className="text-xs font-semibold text-white">{userName}</p>
              </Link>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                onClick={() => signOut({ callbackUrl: "/sign-in" })}
                className="text-xs text-brand-muted hover:text-white transition"
                tabIndex={-1}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

type BrandCardProps = {
  id: string;
  name: string;
  summary: string | null;
  hasSummary: boolean;
  keyMessages: BrandKeyMessage[];
  allowKeyMessageActions: boolean;
  onAddKeyMessage?: (text: string, brandId?: string) => Promise<{ success: boolean; error?: string }>;
  onRemoveKeyMessage?: (id: string) => Promise<void>;
  onClearBrand?: () => Promise<{ success: boolean; error?: string }>;
  onUseBrand?: (brandId?: string) => void;
  isActive?: boolean;
};

function BrandCard({
  id,
  name,
  summary,
  hasSummary,
  keyMessages,
  allowKeyMessageActions,
  onAddKeyMessage,
  onRemoveKeyMessage,
  onClearBrand,
  onUseBrand,
  isActive = false
}: BrandCardProps) {
  const [localActive, setLocalActive] = useState(isActive);
  const [isHovered, setIsHovered] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [brandName, setBrandName] = useState(name);
  const [brandInfo, setBrandInfo] = useState(summary || "");
  const [brandProcessing, setBrandProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [removingMessageId, setRemovingMessageId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    setLocalActive(isActive);
  }, [isActive]);

  useEffect(() => {
    setBrandName(name);
  }, [name]);

  useEffect(() => {
    setBrandInfo(summary || "");
  }, [summary]);

  const handleSelectBrand = () => {
    if (onUseBrand) {
      setLocalActive(true);
      setIsHovered(false); // Clear hover state immediately to prevent overlay flicker
      onUseBrand(id);
    }
  };

  const handleEditBrand = async () => {
    if (!brandInfo.trim()) {
      setErrorMessage("Brand information is required");
      return;
    }

    setBrandProcessing(true);
    setErrorMessage(null);

    try {
      const requestBody = {
        brandName: brandName?.trim() || undefined,
        brandInfo: brandInfo.trim()
      };

      const response = await fetch("/api/brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      if (response.ok && !data?.error) {
        setEditModalOpen(false);
        // Refresh the page or update parent state
        window.location.reload();
      } else {
        setErrorMessage(data?.error || "Failed to update brand");
      }
    } catch (error) {
      console.error("Failed to update brand", error);
      setErrorMessage("Failed to update brand. Please try again.");
    } finally {
      setBrandProcessing(false);
    }
  };

  const handleRemoveMessage = async (messageId: string) => {
    if (confirmDeleteId !== messageId) {
      // First click - show confirmation
      setConfirmDeleteId(messageId);
      return;
    }

    // Second click - confirm deletion
    setRemovingMessageId(messageId);
    setConfirmDeleteId(null);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/brand/key-messaging?id=${messageId}`, {
        method: "DELETE"
      });

      if (response.ok) {
        // Call the parent callback if provided, or reload
        if (onRemoveKeyMessage) {
          await onRemoveKeyMessage(messageId);
        } else {
          window.location.reload();
        }
      } else {
        const data = await response.json().catch(() => ({ error: "Failed to remove message" }));
        setErrorMessage(data?.error || "Failed to remove message");
        setRemovingMessageId(null);
      }
    } catch (error) {
      console.error("Failed to remove message", error);
      setErrorMessage("Failed to remove message. Please try again.");
      setRemovingMessageId(null);
    }
  };

  const firstLetter = name?.charAt(0)?.toUpperCase() || "?";

  return (
    <>
      <div
        className={cn(
          "group relative rounded-2xl border transition-all duration-200 cursor-pointer",
          isActive
            ? "border-brand-blue bg-brand-background/80 shadow-[0_8px_24px_rgba(59,130,246,0.3)]"
            : "border-brand-stroke/40 bg-brand-background/60 hover:border-brand-stroke/60 hover:bg-brand-background/70"
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="p-4">
          {/* Large capital first letter */}
          <div className="flex items-center gap-3 mb-2">
            <div className={cn(
              "flex items-center justify-center text-3xl font-bold transition-colors",
              isActive
                ? "text-brand-blue"
                : "text-brand-text/60 group-hover:text-brand-text/80"
            )}>
              {firstLetter}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-white truncate">{name}</h3>
            </div>
          </div>

          {/* Hover overlay with Write for Brand button */}
          {isHovered && !localActive && !isActive && onUseBrand && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/60 backdrop-blur-sm transition-opacity">
              <button
                type="button"
                onClick={handleSelectBrand}
                className="rounded-full bg-brand-blue px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-blue/80 shadow-lg"
              >
                Write for Brand
              </button>
            </div>
          )}

          {/* Edit button - only visible on hover or when active */}
          {(isHovered || localActive || isActive) && (
            <button
              type="button"
              onClick={() => setEditModalOpen(true)}
              className={cn(
                "absolute top-2 right-2 rounded-full p-1.5 transition",
                isActive
                  ? "text-brand-blue hover:bg-brand-blue/20"
                  : "text-brand-muted hover:text-brand-text hover:bg-brand-background/80"
              )}
              aria-label="Edit brand"
            >
              <span className="material-symbols-outlined text-sm">edit</span>
            </button>
          )}
        </div>
      </div>

      {/* Edit Brand Modal */}
      <Transition show={editModalOpen} as={Fragment}>
        <Dialog onClose={() => setEditModalOpen(false)} className="relative z-[1200]">
          <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-2xl rounded-3xl border border-brand-stroke/60 bg-brand-panel/95 p-6 text-brand-text shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
                <header className="mb-4 flex items-center justify-between">
                  <Dialog.Title className="font-display text-2xl text-brand-text">Edit Brand</Dialog.Title>
                  <button
                    onClick={() => setEditModalOpen(false)}
                    className="rounded-full border border-brand-stroke/70 p-2 text-brand-text hover:text-brand-blue"
                    aria-label="Close"
                  >
                    <MinusSmallIcon className="h-5 w-5" />
                  </button>
                </header>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-brand-muted">Brand Name</label>
                    <input
                      type="text"
                      value={brandName}
                      onChange={(e) => setBrandName(e.target.value.substring(0, 100))}
                      placeholder="Enter brand name (optional)"
                      maxLength={100}
                      className="mt-2 w-full rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text placeholder:text-brand-muted placeholder:opacity-30 focus:border-brand-blue focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-brand-muted">
                      Paste your brand information, style guides, vocabulary, tone, and any other details about your brand. The AI will create a concise 400-character summary.
                    </label>
                    <textarea
                      value={brandInfo}
                      onChange={(e) => setBrandInfo(e.target.value)}
                      placeholder="Paste brand information here..."
                      className="mt-2 w-full rounded-lg border border-brand-stroke/70 bg-brand-ink px-3 py-2 text-brand-text placeholder:text-brand-muted placeholder:opacity-30 focus:border-brand-blue focus:outline-none"
                      rows={12}
                    />
                  </div>

                  {/* Key Messages Section */}
                  {keyMessages.length > 0 && (
                    <div>
                      <label className="text-sm text-brand-muted mb-2 block">
                        Key Messages
                      </label>
                      <div className="mt-2 space-y-2 max-h-60 overflow-y-auto pr-1">
                        {keyMessages.map((message) => (
                          <div
                            key={message.id}
                            className={cn(
                              "group flex items-start justify-between gap-3 rounded-xl border p-3 transition-colors",
                              confirmDeleteId === message.id
                                ? "border-red-400/50 bg-red-400/10"
                                : "border-brand-stroke/40 bg-brand-background/60"
                            )}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-brand-text/90">{message.text}</p>
                              <p className="mt-1 text-[11px] text-brand-muted">
                                Saved {formatTimestamp(message.createdAt)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {confirmDeleteId === message.id && (
                                <span className="text-xs text-red-400 mr-2">Confirm?</span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRemoveMessage(message.id)}
                                disabled={removingMessageId === message.id}
                                className={cn(
                                  "rounded-full p-1.5 transition",
                                  confirmDeleteId === message.id
                                    ? "bg-red-400/20 text-red-400 hover:bg-red-400/30"
                                    : "text-brand-muted hover:text-red-400 hover:bg-brand-background/80",
                                  removingMessageId === message.id ? "opacity-60 cursor-not-allowed" : undefined
                                )}
                                aria-label="Remove key message"
                              >
                                <span className="material-symbols-outlined text-lg">
                                  {confirmDeleteId === message.id ? "check" : "remove"}
                                </span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {errorMessage && (
                    <p className="text-sm text-red-400">{errorMessage}</p>
                  )}
                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setEditModalOpen(false)}
                      className="rounded-full border border-brand-stroke/70 px-4 py-2 text-sm font-semibold text-brand-text transition hover:border-brand-blue hover:text-brand-blue"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleEditBrand}
                      disabled={!brandInfo.trim() || brandProcessing}
                      className="rounded-full bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue/80 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {brandProcessing ? "Processing..." : "Save Brand"}
                    </button>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}

function isStyleDocument(doc: SavedDoc): boolean {
  const title = (doc.title ?? "").trim();
  const styleTitle = (doc.styleTitle ?? "").trim();
  const titleLower = title.toLowerCase();
  const hasStyleMetadata = Boolean(styleTitle || doc.styleSummary || doc.writingStyle);

  // Primary: style saves set the generated styleTitle as the document title
  if (styleTitle && title && title === styleTitle) {
    return true;
  }

  // Legacy placeholder/suffix formats
  if (titleLower === "style" || titleLower.endsWith(" style") || titleLower.includes("• style")) {
    return true;
  }

  // Fallback: entries carrying style metadata should still be classified as styles
  if (styleTitle && hasStyleMetadata) {
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


