"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import MarkdownEditor from "./MarkdownEditor";
import { cn } from "@/lib/utils";
import { WriterOutput } from "@/types/writer";
import type { Editor } from "@tiptap/react";
import { ArrowDownTrayIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import jsPDF from "jspdf";

type DocumentEditorProps = {
  document: WriterOutput | null;
  onDocumentChange: (content: string) => void;
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
  onDownload?: (format: "docx" | "txt" | "pdf") => void;
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

export default function DocumentEditor({
  document,
  onDocumentChange,
  onRewriteSelection,
  onSelectionChange,
  onEditorReady,
  loading = false,
  className,
  brandSummary,
  styleGuide,
  onDownload
}: DocumentEditorProps) {
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [pendingDownload, setPendingDownload] = useState<"docx" | "txt" | "pdf" | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const downloadMenuRef = useRef<HTMLDivElement>(null);

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

  const performDownload = useCallback(async (format: "docx" | "txt" | "pdf") => {
    if (!document) return;

    const resolvedContent = resolveOutputContent(document);
    const stamp = new Date().toISOString().split("T")[0];
    const sanitizedTitle = document.title.replace(/\s+/g, "_") || "Untitled_Doc";

    if (format === "pdf") {
      // Generate PDF client-side
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 20;
      const maxWidth = pageWidth - 2 * margin;
      
      // Add title
      pdf.setFontSize(18);
      pdf.setFont("helvetica", "bold");
      const titleLines = pdf.splitTextToSize(document.title || "Untitled Document", maxWidth);
      pdf.text(titleLines, margin, margin + 10);
      
      // Add content
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "normal");
      const contentLines = pdf.splitTextToSize(resolvedContent, maxWidth);
      let yPosition = margin + 20;
      
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
      const textContent = `${document.title || "Untitled Document"}\n\n${resolvedContent}`;
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

    // DOCX format - use API
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: document.title || "Untitled Document",
          content: resolvedContent,
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
  }, [document]);

  const handleDownloadClick = useCallback(async (format: "docx" | "txt" | "pdf") => {
    if (!document) return;

    const hasPlaceholders = hasPendingPlaceholders(document);
    
    if (hasPlaceholders) {
      setPendingDownload(format);
      setShowDownloadMenu(false);
      return;
    }

    await performDownload(format);
  }, [document, performDownload]);

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

  // Listen for download events from header
  useEffect(() => {
    function handleDownloadEvent(event: CustomEvent) {
      if (document) {
        handleDownloadClick(event.detail.format);
      }
    }
    window.addEventListener("download-document", handleDownloadEvent as EventListener);
    return () => {
      window.removeEventListener("download-document", handleDownloadEvent as EventListener);
    };
  }, [document, handleDownloadClick]);

  return (
    <div className={cn("relative flex h-full flex-col", className)}>
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

      {/* Editor Container - Hard corners and standard doc margins */}
      <div className="relative flex-1 overflow-auto border border-brand-stroke/60 bg-brand-panel/90 px-16 py-12 shadow-[0_25px_80px_rgba(0,0,0,0.35)]">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-4 w-1/2 animate-pulse rounded-full bg-brand-blue/40" />
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
          />
        )}
      </div>

    </div>
  );
}

