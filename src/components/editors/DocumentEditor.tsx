"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import MarkdownEditor from "./MarkdownEditor";
import { cn } from "@/lib/utils";
import { WriterOutput } from "@/types/writer";
import type { Editor } from "@tiptap/react";
import jsPDF from "jspdf";

type DocumentEditorProps = {
  document: WriterOutput | null;
  onDocumentChange: (content: string) => void;
  onTitleChange?: (title: string) => void;
  onRewriteSelection?: (selectedText: string, instruction: string) => Promise<void>;
  onSelectionChange?: (selectedText: string | null) => void;
  onEditorReady?: (editor: Editor) => void;
  loading?: boolean;
  className?: string;
  brandSummary?: string | null;
  styleGuide?: {
    name: string;
    description: string;
  } | null;
  onDownload?: (format: "docx" | "txt" | "pdf" | "md") => void;
  horizontalPadding?: {
    left?: number;
    right?: number;
  };
  folderOptions?: Array<{ id: string; name: string }>;
  onAddToPinned?: () => void;
  onAddToFolder?: (folderId: string) => void;
  onCreateFolder?: () => void;
};

function derivePlaceholderMeta(content: string): Array<{ id: string; label: string }> {
  const meta: Array<{ id: string; label: string }> = [];
  const regex = /\[([^\]]+)]/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = regex.exec(content)) !== null) {
    const label = (match[1] ?? "").trim() || "missing info";
    meta.push({ id: `ph-${index++}`, label });
  }
  return meta;
}

function hasPendingPlaceholders(document: WriterOutput | null): boolean {
  if (!document) return false;
  
  // Derive placeholder metadata if missing
  let meta = document.placeholderMeta ?? [];
  if (!meta.length) {
    meta = derivePlaceholderMeta(document.content);
  }
  
  if (!meta.length) return false;
  
  const values = document.placeholderValues ?? {};
  return meta.some((placeholder) => {
    const value = values[placeholder.id];
    return !value || !value.trim();
  });
}

function resolveOutputContent(document: WriterOutput): string {
  const meta = document.placeholderMeta ?? [];
  const values = document.placeholderValues ?? {};
  if (!meta.length) {
    return document.content;
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
  return document.content.replace(/\[([^\]]+)]/g, (match, label) => {
    const trimmedLabel = label.trim();
    const value = labelToValue.get(trimmedLabel);
    return value || match;
  });
}

function markdownToPlainText(markdown: string): string {
  if (!markdown) {
    return "";
  }
  return markdown
    .replace(/```[\s\S]*?```/g, "") // code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[[^\]]*]\([^)]+\)/g, "") // images
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1") // links
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1") // emphasis/strike
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^\s{0,3}[-*+]\s+/gm, "") // unordered lists
    .replace(/^\s{0,3}\d+\.\s+/gm, "") // ordered lists
    .replace(/^>\s?/gm, "") // blockquotes
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default function DocumentEditor({
  document,
  onDocumentChange,
  onTitleChange,
  onRewriteSelection,
  onSelectionChange,
  onEditorReady,
  loading = false,
  className,
  brandSummary,
  styleGuide,
  onDownload,
  horizontalPadding,
  folderOptions,
  onAddToPinned,
  onAddToFolder,
  onCreateFolder
}: DocumentEditorProps) {
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [pendingDownload, setPendingDownload] = useState<"docx" | "txt" | "pdf" | null>(null);
  const [downloadMenuPosition, setDownloadMenuPosition] = useState<{ left: number; top: number; height: number } | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const [isTitleSticky, setIsTitleSticky] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const downloadMenuRef = useRef<HTMLDivElement>(null);

  // Sync title value with document
  useEffect(() => {
    if (document?.title) {
      setTitleValue(document.title);
    }
  }, [document?.title]);

  const resolvedHorizontalPadding = {
    left: horizontalPadding?.left ?? 180,
    right: horizontalPadding?.right ?? 180
  };
  const resolvedFolderOptions = folderOptions ?? [];

  const hasContent = useMemo(() => {
    return !!(document?.content?.trim());
  }, [document?.content]);

  const sharedHorizontalPaddingStyle = {
    paddingLeft: resolvedHorizontalPadding.left,
    paddingRight: resolvedHorizontalPadding.right
  };

  // Track when title scrolls out of view
  useEffect(() => {
    const titleElement = titleRef.current;
    if (!titleElement) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsTitleSticky(!entry.isIntersecting);
        });
      },
      {
        rootMargin: "-100px 0px 0px 0px", // Account for header height (100px at top, 60px when scrolled)
        threshold: 0
      }
    );

    observer.observe(titleElement);

    return () => {
      observer.disconnect();
    };
  }, []);

  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor;
    if (onEditorReady) {
      onEditorReady(editor);
    }
  }, [onEditorReady]);

  const handleSelectionChange = useCallback((text: string | null) => {
    setSelectedText(text);
    // Only notify parent if there's actual selected text (not just dragging)
    if (onSelectionChange) {
      onSelectionChange(text);
    }
  }, [onSelectionChange]);

  // Expose editor methods for rewriting
  useEffect(() => {
    if (editorRef.current && onRewriteSelection) {
      (editorRef.current as any).rewriteSelection = async (instruction: string) => {
        const selected = (editorRef.current as any).getSelectedText();
        if (selected) {
          await onRewriteSelection(selected, instruction);
        }
      };
    }
  }, [onRewriteSelection]);

  // Close download menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(event.target as Node)) {
        setShowDownloadMenu(false);
      }
    }
    if (showDownloadMenu) {
      window.document.addEventListener("mousedown", handleClickOutside);
      return () => window.document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showDownloadMenu]);

  const performDownloadWithContent = useCallback(async (format: "docx" | "txt" | "pdf" | "md", content: string, title: string) => {
    if (!content || !content.trim()) {
      console.error("Cannot download: content is empty");
      return;
    }
    
    const stamp = new Date().toISOString().split("T")[0];
    const isUntitled = !title || title.trim() === "" || title.toLowerCase() === "untitled doc" || title.toLowerCase() === "untitled document";
    const sanitizedTitle = isUntitled ? "Untitled_Doc" : title.replace(/\s+/g, "_");

    if (format === "pdf") {
      // Generate PDF client-side
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 20;
      const maxWidth = pageWidth - 2 * margin;
      
      // Add title only if not untitled
      let yPosition = margin;
      if (!isUntitled) {
        pdf.setFontSize(18);
        pdf.setFont("helvetica", "bold");
        const titleLines = pdf.splitTextToSize(title, maxWidth);
        pdf.text(titleLines, margin, margin + 10);
        yPosition = margin + 20;
      }
      
      // Add content
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "normal");
      const contentLines = pdf.splitTextToSize(content, maxWidth);
      
      contentLines.forEach((line: string) => {
        if (yPosition > pdf.internal.pageSize.getHeight() - margin) {
          pdf.addPage();
          yPosition = margin;
        }
        pdf.text(line, margin, yPosition);
        yPosition += 7;
      });
      
      pdf.save(`${sanitizedTitle}_${stamp}.pdf`);
      return;
    }

    if (format === "txt") {
      const textContent = isUntitled ? content : `${title}\n\n${content}`;
      const blob = new Blob([textContent], { type: "text/plain" });
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${sanitizedTitle}_${stamp}.txt`;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      return;
    }

    if (format === "md") {
      // Markdown format - download as .md file
      const markdownContent = isUntitled ? content : `# ${title}\n\n${content}`;
      const blob = new Blob([markdownContent], { type: "text/markdown" });
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${sanitizedTitle}_${stamp}.md`;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      return;
    }

    // DOCX format - use API
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: isUntitled ? "" : title,
          content: content,
          format: "docx"
        })
      });

      if (!response.ok) {
        console.error("Download failed");
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${sanitizedTitle}_${stamp}.docx`;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download error:", error);
    }
  }, []);

  const performDownload = useCallback(async (format: "docx" | "txt" | "pdf" | "md") => {
    if (!document) {
      console.error("Cannot download: no document available");
      return;
    }

    const resolvedContent = resolveOutputContent(document);
    if (!resolvedContent) {
      console.error("Cannot download: document content is empty");
      return;
    }
    
    await performDownloadWithContent(format, resolvedContent, document.title || "Untitled Document");
  }, [document, performDownloadWithContent]);

  const handleDownloadClick = useCallback(async (format: "docx" | "txt" | "pdf" | "md") => {
    // If no document but editor has content, get content from editor
    let contentToDownload = "";
    let titleToUse = "Untitled Document";
    
    if (!document) {
      // Try to get content from editor directly
      if (editorRef.current) {
        const editor = editorRef.current as any;
        // Get markdown content from editor
        const editorContent = editor.getMarkdown ? editor.getMarkdown() : editor.getText();
        if (editorContent && editorContent.trim()) {
          contentToDownload = editorContent.trim();
          titleToUse = "Untitled Document";
        } else {
          console.warn("No document available and editor is empty");
          window.dispatchEvent(new CustomEvent("close-download-menu"));
          return;
        }
      } else {
        console.warn("No document available and editor not ready");
        window.dispatchEvent(new CustomEvent("close-download-menu"));
        return;
      }
    } else {
      const hasPlaceholders = hasPendingPlaceholders(document);
      
      if (hasPlaceholders) {
        setPendingDownload(format);
        window.dispatchEvent(new CustomEvent("close-download-menu"));
        return;
      }
      
      contentToDownload = resolveOutputContent(document);
      titleToUse = document.title || "Untitled Document";
    }

    // Perform download with the content
    await performDownloadWithContent(format, contentToDownload, titleToUse);
    window.dispatchEvent(new CustomEvent("close-download-menu"));
  }, [document, performDownloadWithContent]);

  function handleConfirmDownload() {
    if (pendingDownload) {
      performDownload(pendingDownload);
      setPendingDownload(null);
    }
  }

  function handleCancelDownload() {
    setPendingDownload(null);
  }

  // Create empty document if none exists
  const displayDocument = document || {
    id: "new",
    title: "",
    content: "",
    createdAt: new Date(),
    settings: {},
    prompt: "",
    writingStyle: null,
    placeholderValues: {},
    isPending: false
  };

  const handleTitleClick = useCallback(() => {
    setIsEditingTitle(true);
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 0);
  }, []);

  const handleTitleBlur = useCallback(() => {
    setIsEditingTitle(false);
    const trimmedTitle = titleValue.trim();
    if (trimmedTitle && onTitleChange && trimmedTitle !== document?.title) {
      onTitleChange(trimmedTitle);
    } else if (!trimmedTitle && document?.title) {
      // Restore original title if empty
      setTitleValue(document.title);
    }
  }, [titleValue, document?.title, onTitleChange]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      titleInputRef.current?.blur();
    }
    if (e.key === "Escape") {
      if (document?.title) {
        setTitleValue(document.title);
      }
      setIsEditingTitle(false);
      titleInputRef.current?.blur();
    }
  }, [document?.title]);

  // Listen for download events from header
  useEffect(() => {
    function handleDownloadEvent(event: CustomEvent) {
      const format = event.detail?.format;
      if (!format) {
        console.error("Download event missing format");
        window.dispatchEvent(new CustomEvent("close-download-menu"));
        return;
      }
      if (document) {
        handleDownloadClick(format);
      } else {
        console.warn("Download requested but no document is available");
        window.dispatchEvent(new CustomEvent("close-download-menu"));
      }
    }
    window.addEventListener("download-document", handleDownloadEvent as EventListener);
    return () => {
      window.removeEventListener("download-document", handleDownloadEvent as EventListener);
    };
  }, [document, handleDownloadClick]);

  const handleCopyDocument = useCallback(async () => {
    try {
      let content = "";
      if (document) {
        content = resolveOutputContent(document);
      } else if (editorRef.current) {
        const editor = editorRef.current as any;
        if (typeof editor.getMarkdown === "function") {
          content = editor.getMarkdown();
        } else if (typeof editor.getText === "function") {
          content = editor.getText();
        }
      }

      const plainText = markdownToPlainText(content);
      if (!plainText) {
        console.warn("copy document skipped: no content");
        return;
      }
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(plainText);
        setCopyStatus("copied");
      } else {
        console.warn("Clipboard API unavailable");
      }
    } catch (error) {
      console.error("copy document failed", error);
      setCopyStatus("error");
    }
  }, [document]);

  useEffect(() => {
    if (copyStatus === "idle") return;
    const timeout = window.setTimeout(() => setCopyStatus("idle"), 2000);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  const handleDownloadButtonClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setDownloadMenuPosition({
      left: rect.left + rect.width / 2,
      top: rect.top,
      height: rect.height
    });
    setShowDownloadMenu((prev) => !prev);
  }, []);

  const downloadMenu =
    showDownloadMenu && downloadMenuPosition && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={downloadMenuRef}
            className="fixed z-[1000] w-56 rounded-2xl border border-brand-stroke/60 bg-brand-panel/95 p-2 text-left shadow-[0_25px_80px_rgba(0,0,0,0.65)]"
            style={{
              left: downloadMenuPosition.left,
              top: downloadMenuPosition.top + window.scrollY,
              transform: "translate(-50%, calc(-100% - 12px))"
            }}
          >
            {[
              { format: "docx", label: ".docx", detail: "MS Word" },
              { format: "txt", label: ".txt", detail: "Plaintext" },
              { format: "pdf", label: ".pdf", detail: "PDF" },
              { format: "md", label: ".md", detail: "Markdown" }
            ].map((entry) => (
              <button
                key={entry.format}
                type="button"
                onClick={() => {
                  setShowDownloadMenu(false);
                  void handleDownloadClick(entry.format as "docx" | "txt" | "pdf" | "md");
                }}
                className="flex w-full items-center justify-between rounded-xl px-4 py-2 text-sm text-white transition hover:bg-brand-blue/15"
              >
                <span className="font-semibold">{entry.label}</span>
                <span className="text-xs text-white/60">{entry.detail}</span>
              </button>
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <div className={cn("relative flex h-full flex-col", className)}>
      {/* Sticky Title Bar - appears when title scrolls out of view */}
      <div
        className={cn(
          "sticky top-[60px] z-30 w-full transition-all duration-300 ease-in-out",
          isTitleSticky
            ? "translate-y-0 opacity-100"
            : "-translate-y-full opacity-0 pointer-events-none"
        )}
      >
        <div
          onClick={() => {
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="w-full py-1 bg-[#0a0a0a] cursor-pointer"
        >
          <div className="flex w-full items-center justify-between gap-4">
            <div className="flex-1">
              <div className="max-w-[680px]">
                <h1 className="text-lg font-semibold text-white/50">
                  {titleValue || document?.title || "Untitled doc"}
                </h1>
              </div>
            </div>
            <div
              className="ml-auto flex-shrink-0"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <TitleActionButtons
                compact
                onCopy={handleCopyDocument}
                copyStatus={copyStatus}
                onToggleDownload={handleDownloadButtonClick}
                hasContent={hasContent}
                folderOptions={resolvedFolderOptions}
                onAddToPinned={onAddToPinned}
                onAddToFolder={onAddToFolder}
                onCreateFolder={onCreateFolder}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Placeholder Warning */}
      {pendingDownload && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-brand-stroke/60 bg-brand-panel/70 px-4 py-3 text-sm text-brand-text">
          <p className="flex-1 text-sm text-brand-muted">
            There are still{" "}
            <span className="underline decoration-2 decoration-brand-blue underline-offset-2">placeholders</span>{" "}
            in your text.
          </p>
          <button
            type="button"
            className="rounded-full bg-brand-blue px-3 py-1 text-xs font-semibold text-white transition hover:bg-brand-blue/80"
            onClick={handleConfirmDownload}
          >
            Download anyway
          </button>
          <button
            type="button"
            className="rounded-full border border-brand-stroke/60 px-3 py-1 text-xs font-semibold text-brand-text hover:border-brand-blue hover:text-brand-blue"
            onClick={handleCancelDownload}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Document Title */}
      <div ref={titleRef} className="mb-[22.5px] py-2">
        <div className="flex w-full items-center justify-between gap-4">
          <div className="flex-1">
            <div className="max-w-[680px]">
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={handleTitleKeyDown}
              className="w-full bg-transparent text-2xl font-semibold text-white outline-none placeholder:text-white/50"
              placeholder="Untitled doc"
            />
        ) : (
          <h1
            onClick={handleTitleClick}
            className="cursor-text text-2xl font-semibold text-white/50 hover:text-white/70 transition-colors"
          >
            {titleValue || document?.title || "Untitled doc"}
          </h1>
        )}
            </div>
          </div>
          <div className="flex-shrink-0">
            <TitleActionButtons
              onCopy={handleCopyDocument}
              copyStatus={copyStatus}
              onToggleDownload={handleDownloadButtonClick}
              hasContent={hasContent}
              folderOptions={resolvedFolderOptions}
              onAddToPinned={onAddToPinned}
              onAddToFolder={onAddToFolder}
              onCreateFolder={onCreateFolder}
            />
          </div>
        </div>
      </div>

      {/* Editor Container - Hard corners and standard doc margins */}
      <div className="relative flex-1 overflow-auto border border-brand-stroke/60 bg-brand-panel/90 shadow-[0_25px_80px_rgba(0,0,0,0.35)]">
        <div className="py-[90px]" style={sharedHorizontalPaddingStyle}>
          <div className="mx-auto max-w-[680px]">
            {loading ? (
              <div className="flex flex-col gap-3 min-h-[500px]">
                <div className="flex flex-wrap gap-2">
                  <div className="loading-pill w-32" />
                  <div className="loading-pill w-24" />
                  <div className="loading-pill w-40" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="loading-pill w-28" />
                  <div className="loading-pill w-36" />
                  <div className="loading-pill w-20" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="loading-pill w-44" />
                  <div className="loading-pill w-32" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="loading-pill w-36" />
                  <div className="loading-pill w-28" />
                  <div className="loading-pill w-40" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="loading-pill w-32" />
                  <div className="loading-pill w-24" />
                </div>
              </div>
            ) : (
              <MarkdownEditor
                content={displayDocument.content}
                onChange={onDocumentChange}
                onSelectionChange={handleSelectionChange}
                onReady={handleEditorReady}
                editable={true}
                placeholder="Start writing or select text to rewrite..."
                className="min-h-[500px]"
                hasBrand={!!brandSummary}
                horizontalPadding={horizontalPadding}
              />
            )}
          </div>
        </div>
      </div>
      {downloadMenu}
    </div>
  );
}

type FolderOption = { id: string; name: string };

type TitleActionButtonsProps = {
  compact?: boolean;
  onCopy: () => void;
  copyStatus?: "idle" | "copied" | "error";
  onToggleDownload?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  hasContent?: boolean;
  folderOptions?: FolderOption[];
  onAddToPinned?: () => void;
  onAddToFolder?: (folderId: string) => void;
  onCreateFolder?: () => void;
};

function TitleActionButtons({
  compact = false,
  onCopy,
  copyStatus = "idle",
  onToggleDownload,
  hasContent = true,
  folderOptions = [],
  onAddToPinned,
  onAddToFolder,
  onCreateFolder
}: TitleActionButtonsProps) {
  const baseButtonClass = cn(
    "rounded-full border border-brand-stroke/60 bg-brand-ink/40 text-brand-text transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/60 flex items-center justify-center",
    compact ? "h-9 w-9 text-base" : "h-11 w-11 text-xl",
    hasContent
      ? "hover:border-brand-blue hover:text-brand-blue"
      : "opacity-[0.33] cursor-not-allowed"
  );
  const addButtonClass = cn(
    "rounded-full border border-brand-stroke/60 bg-brand-ink/40 text-brand-text transition hover:border-brand-blue hover:text-brand-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/60 flex items-center justify-center",
    compact ? "h-9 w-9 text-base" : "h-11 w-11 text-xl"
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.document.addEventListener("mousedown", handleClickOutside);
    return () => window.document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const handleMenuToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setMenuOpen((prev) => !prev);
  };

  const handleCopyClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onCopy();
  };

  const handlePinned = () => {
    onAddToPinned?.();
    setMenuOpen(false);
  };

  const handleFolderSelect = (folderId: string) => {
    onAddToFolder?.(folderId);
    setMenuOpen(false);
  };

  const handleCreateFolder = () => {
    onCreateFolder?.();
    setMenuOpen(false);
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          className={addButtonClass}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Add to collection"
          onClick={handleMenuToggle}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <span className="material-symbols-outlined leading-none">add</span>
        </button>
        {menuOpen && (
          <div className="absolute right-0 z-[1000] mt-2 w-64 rounded-2xl border border-brand-stroke/60 bg-brand-panel/95 p-2 text-left shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-brand-text transition hover:bg-brand-ink/40"
              onClick={handlePinned}
            >
              <span className="material-symbols-outlined text-base">push_pin</span>
              Add to Pinned
            </button>
            {folderOptions.length > 0 && (
              <div className="mt-2 border-t border-brand-stroke/40 pt-2">
                <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-muted">
                  Existing folders
                </p>
                <div className="mt-1 space-y-1">
                  {folderOptions.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-sm text-brand-text transition hover:bg-brand-ink/40"
                      onClick={() => handleFolderSelect(folder.id)}
                    >
                      <span className="material-symbols-outlined text-base text-brand-muted">folder</span>
                      <span className="truncate">{folder.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-2 border-t border-brand-stroke/40 pt-2">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-brand-text transition hover:bg-brand-ink/40"
                onClick={handleCreateFolder}
              >
                <span className="material-symbols-outlined text-base">create_new_folder</span>
                + Add to New Folder
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="relative">
        <button
          type="button"
          className={baseButtonClass}
          aria-haspopup="menu"
          aria-label="Download document"
          disabled={!hasContent}
          onClick={(event) => {
            if (hasContent) {
              onToggleDownload?.(event);
            }
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <span className="material-symbols-outlined leading-none">download</span>
        </button>
      </div>
      <button
        type="button"
        className={baseButtonClass}
        aria-label={copyStatus === "copied" ? "Copied" : "Copy document"}
        title="Copy document"
        disabled={!hasContent}
        onClick={(event) => {
          if (hasContent) {
            handleCopyClick(event);
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {copyStatus === "copied" ? (
          <span className="text-xs font-semibold">Copied</span>
        ) : (
          <span className="material-symbols-outlined leading-none">content_copy</span>
        )}
      </button>
    </div>
  );
}

