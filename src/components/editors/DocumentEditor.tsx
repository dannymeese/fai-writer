"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import MarkdownEditor from "./MarkdownEditor";
import { cn } from "@/lib/utils";
import { WriterOutput } from "@/types/writer";
import type { Editor } from "@tiptap/react";

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
};

export default function DocumentEditor({
  document,
  onDocumentChange,
  onRewriteSelection,
  onSelectionChange,
  onEditorReady,
  loading = false,
  className,
  brandSummary,
  styleGuide
}: DocumentEditorProps) {
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const editorRef = useRef<Editor | null>(null);

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

  return (
    <div className={cn("relative flex h-full flex-col", className)}>
      {/* Document Header - only show if document has a title */}
      {document?.title && (
        <div className="mb-4 flex items-center justify-between border-b border-brand-stroke/40 pb-4">
          <h2 className="text-xl font-semibold text-white">{document.title}</h2>
          {selectedText && (
            <div className="text-xs text-brand-muted">
              {selectedText.length} characters selected
            </div>
          )}
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

