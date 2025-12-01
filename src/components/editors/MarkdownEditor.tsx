"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useCallback, useState } from "react";
import { cn } from "@/lib/utils";

type MarkdownEditorProps = {
  content: string;
  onChange: (content: string) => void;
  onSelectionChange?: (selectedText: string | null) => void;
  placeholder?: string;
  editable?: boolean;
  className?: string;
  onReady?: (editor: ReturnType<typeof useEditor>) => void;
};

export default function MarkdownEditor({
  content,
  onChange,
  onSelectionChange,
  placeholder = "Start writing...",
  editable = true,
  className,
  onReady
}: MarkdownEditorProps) {
  const [mounted, setMounted] = useState(false);
  const [persistentSelection, setPersistentSelection] = useState<{ from: number; to: number } | null>(null);

  // Ensure we're on the client before initializing the editor
  useEffect(() => {
    setMounted(true);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Configure markdown-friendly behavior
        heading: {
          levels: [1, 2, 3, 4, 5, 6]
        },
        bulletList: {
          keepMarks: true,
          keepAttributes: false
        },
        orderedList: {
          keepMarks: true,
          keepAttributes: false
        }
      }),
      Placeholder.configure({
        placeholder
      })
    ],
    content,
    editable,
    immediatelyRender: false, // Prevent SSR hydration issues
    onUpdate: ({ editor }) => {
      // Get content as plain text (which preserves markdown-like formatting)
      const text = editor.getText();
      onChange(text);
    },
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-invert prose-lg max-w-none focus:outline-none",
          "prose-headings:text-white prose-p:text-brand-text/90 prose-strong:text-white",
          "prose-code:text-brand-blue prose-pre:bg-brand-panel prose-pre:text-brand-text",
          "prose-blockquote:border-brand-blue prose-blockquote:text-brand-muted",
          "prose-ul:text-brand-text prose-ol:text-brand-text prose-li:text-brand-text",
          className
        )
      }
    }
  });

  // Notify parent when editor is ready
  useEffect(() => {
    if (editor && onReady) {
      onReady(editor);
    }
  }, [editor, onReady]);

  // Track if input is focused
  const [isInputFocused, setIsInputFocused] = useState(false);

  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (target instanceof HTMLTextAreaElement && target.closest('.compose-bar')) {
        setIsInputFocused(true);
      }
    };

    const handleFocusOut = (e: FocusEvent) => {
      const target = e.target;
      if (target instanceof HTMLTextAreaElement && target.closest('.compose-bar')) {
        setIsInputFocused(false);
      }
    };

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);

    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  // Custom cursor marker that's always visible
  useEffect(() => {
    if (!editor) return;

    let cursorMarker: HTMLElement | null = null;
    let animationFrame: number | null = null;

    const updateCursorMarker = () => {
      const { from, to } = editor.state.selection;
      
      // Only show cursor marker if there's no selection (cursor mode)
      if (from !== to) {
        if (cursorMarker) {
          cursorMarker.style.display = 'none';
        }
        return;
      }

      // Get cursor position relative to editor container
      const coords = editor.view.coordsAtPos(from);
      const coordsEnd = editor.view.coordsAtPos(from + 1); // Get next position to calculate line height
      const lineHeight = coordsEnd.top - coords.top || 24; // Default to 24px if can't calculate
      const cursorHeight = lineHeight * 1.5; // 1.5x taller

      // Get editor container position
      const editorElement = editor.view.dom;
      const editorContainer = editorElement.closest('.overflow-auto') || editorElement.parentElement;
      const containerRect = editorContainer?.getBoundingClientRect() || { left: 0, top: 0 };

      // Create or update cursor marker
      if (!cursorMarker) {
        cursorMarker = document.createElement("div");
        cursorMarker.className = "custom-cursor-marker";
        if (editorContainer) {
          editorContainer.appendChild(cursorMarker);
        } else {
          document.body.appendChild(cursorMarker);
        }
      }

      // Make cursor solid (no animation) when input is focused
      const animation = isInputFocused ? 'none' : 'blink 1s infinite';

      // Calculate position relative to container
      const relativeLeft = coords.left - containerRect.left;
      const relativeTop = coords.top - containerRect.top;

      // Update position and size
      cursorMarker.style.cssText = `
        position: absolute;
        width: 6px;
        height: ${cursorHeight}px;
        background-color: #00f;
        pointer-events: none;
        z-index: 1;
        animation: ${animation};
        left: ${relativeLeft}px;
        top: ${relativeTop}px;
        display: block;
      `;
    };

    const handleSelectionUpdate = () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      animationFrame = requestAnimationFrame(updateCursorMarker);
    };

    const handleUpdate = () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      animationFrame = requestAnimationFrame(updateCursorMarker);
    };

    // Update cursor marker on selection changes
    editor.on("selectionUpdate", handleSelectionUpdate);
    editor.on("update", handleUpdate);
    
    // Initial update
    updateCursorMarker();

    // Update on scroll - cursor will move with content automatically since it's positioned relative to container
    const editorElement = editor.view.dom;
    const scrollContainer = editorElement.closest('.overflow-auto');
    const handleScroll = () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      animationFrame = requestAnimationFrame(updateCursorMarker);
    };
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    }

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
      editor.off("update", handleUpdate);
      scrollContainer.removeEventListener('scroll', handleScroll);
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      if (cursorMarker) {
        cursorMarker.remove();
      }
    };
  }, [editor, isInputFocused]);

  // Handle selection changes and maintain persistent selection
  useEffect(() => {
    if (!editor || !onSelectionChange) return;

    let isDragging = false;
    let dragTimeout: NodeJS.Timeout | null = null;

    const handleMouseDown = () => {
      isDragging = true;
    };

    const handleMouseUp = () => {
      // Small delay to ensure selection is finalized
      if (dragTimeout) clearTimeout(dragTimeout);
      dragTimeout = setTimeout(() => {
        isDragging = false;
        const { from, to } = editor.state.selection;
        if (from !== to) {
          // Store persistent selection
          setPersistentSelection({ from, to });
          const selectedText = editor.state.doc.textBetween(from, to);
          onSelectionChange(selectedText);
        } else {
          // Only clear if user explicitly cleared (clicked in editor without selecting)
          const editorElement = editor.view.dom;
          if (document.activeElement === editorElement) {
            setPersistentSelection(null);
            onSelectionChange(null);
          }
        }
      }, 50);
    };

    const handleSelectionUpdate = () => {
      // Only update if not currently dragging
      if (!isDragging) {
        const { from, to } = editor.state.selection;
        if (from !== to) {
          // Store persistent selection
          setPersistentSelection({ from, to });
          const selectedText = editor.state.doc.textBetween(from, to);
          onSelectionChange(selectedText);
        } else {
          // Only clear persistent selection if user clicked directly in editor
          // Don't clear if focus was lost due to clicking input field
          const editorElement = editor.view.dom;
          const activeElement = document.activeElement;
          const isInputFocused = activeElement instanceof HTMLTextAreaElement && 
                                 activeElement.closest('.compose-bar');
          
          // Only clear if editor has focus (user clicked in editor) and not if input is focused
          if (document.activeElement === editorElement && !isInputFocused) {
            setPersistentSelection(null);
            onSelectionChange(null);
          }
          // If input is focused, keep the persistent selection
        }
      }
    };

    const handleBlur = () => {
      // When editor loses focus, maintain the selection visually
      // The selection state is already stored in persistentSelection
      // We'll use CSS to keep it styled
    };
    
    const handleClickInEditor = (e: MouseEvent) => {
      // If user clicks in editor, allow normal selection behavior
      // This will update persistentSelection through handleSelectionUpdate
    };

    editor.on("selectionUpdate", handleSelectionUpdate);
    const editorElement = editor.view.dom;
    editorElement.addEventListener("mousedown", handleMouseDown);
    editorElement.addEventListener("mouseup", handleMouseUp);
    editorElement.addEventListener("blur", handleBlur);

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
      editorElement.removeEventListener("mousedown", handleMouseDown);
      editorElement.removeEventListener("mouseup", handleMouseUp);
      editorElement.removeEventListener("blur", handleBlur);
      if (dragTimeout) clearTimeout(dragTimeout);
    };
  }, [editor, onSelectionChange]);

  // Custom selection overlay that persists even when editor loses focus
  useEffect(() => {
    if (!editor || !persistentSelection) {
      // Clear any existing selection overlays
      const existingOverlays = document.querySelectorAll('.custom-selection-overlay');
      existingOverlays.forEach(overlay => overlay.remove());
      return;
    }

    const { from, to } = persistentSelection;
    let selectionOverlays: HTMLElement[] = [];
    let animationFrame: number | null = null;

    const updateSelectionOverlay = () => {
      // Remove existing overlays
      selectionOverlays.forEach(overlay => overlay.remove());
      selectionOverlays = [];

      try {
        // Get editor container for relative positioning
        const editorElement = editor.view.dom;
        const editorContainer = editorElement.closest('.overflow-auto') || editorElement.parentElement;
        const containerRect = editorContainer?.getBoundingClientRect() || { left: 0, top: 0 };

        // Get coordinates for start and end of selection
        const startCoords = editor.view.coordsAtPos(from);
        const endCoords = editor.view.coordsAtPos(to);

        // Handle single-line selection
        if (Math.abs(startCoords.top - endCoords.top) < 5) {
          const left = Math.min(startCoords.left, endCoords.left);
          const top = startCoords.top;
          const width = Math.abs(endCoords.left - startCoords.left);
          const height = Math.max(startCoords.bottom - startCoords.top, endCoords.bottom - endCoords.top);

          // Calculate position relative to container
          const relativeLeft = left - containerRect.left;
          const relativeTop = top - containerRect.top;

          const overlay = document.createElement("div");
          overlay.className = "custom-selection-overlay";
          overlay.style.cssText = `
            position: absolute;
            left: ${relativeLeft}px;
            top: ${relativeTop}px;
            width: ${width}px;
            height: ${height}px;
            background-color: #00f;
            pointer-events: none;
            z-index: 0;
          `;
          if (editorContainer) {
            editorContainer.appendChild(overlay);
          } else {
            document.body.appendChild(overlay);
          }
          selectionOverlays.push(overlay);
        } else {
          // Multi-line selection - create overlays for each line
          const editorRect = editorElement.getBoundingClientRect();
          
          // Calculate positions relative to container
          const containerLeft = containerRect.left;
          const containerTop = containerRect.top;
          const containerWidth = editorRect.width;
          
          // Create overlay for first line (from start to end of line)
          const firstRelativeLeft = startCoords.left - containerLeft;
          const firstRelativeTop = startCoords.top - containerTop;
          const firstOverlay = document.createElement("div");
          firstOverlay.className = "custom-selection-overlay";
          firstOverlay.style.cssText = `
            position: absolute;
            left: ${firstRelativeLeft}px;
            top: ${firstRelativeTop}px;
            width: ${containerWidth - firstRelativeLeft}px;
            height: ${startCoords.bottom - startCoords.top}px;
            background-color: #00f;
            pointer-events: none;
            z-index: 0;
          `;
          if (editorContainer) {
            editorContainer.appendChild(firstOverlay);
          } else {
            document.body.appendChild(firstOverlay);
          }
          selectionOverlays.push(firstOverlay);
          
          // Create overlays for middle lines (full width)
          let currentTop = startCoords.bottom;
          const lineHeight = startCoords.bottom - startCoords.top;
          
          while (currentTop + lineHeight < endCoords.top) {
            const relativeTop = currentTop - containerTop;
            const overlay = document.createElement("div");
            overlay.className = "custom-selection-overlay";
            overlay.style.cssText = `
              position: absolute;
              left: 0px;
              top: ${relativeTop}px;
              width: ${containerWidth}px;
              height: ${lineHeight}px;
              background-color: #00f;
              pointer-events: none;
              z-index: 0;
            `;
            if (editorContainer) {
              editorContainer.appendChild(overlay);
            } else {
              document.body.appendChild(overlay);
            }
            selectionOverlays.push(overlay);
            currentTop += lineHeight;
          }
          
          // Create overlay for last line (from start of line to end)
          if (endCoords.top > startCoords.bottom) {
            const lastRelativeTop = endCoords.top - containerTop;
            const lastRelativeLeft = 0;
            const lastWidth = endCoords.left - containerLeft;
            const lastOverlay = document.createElement("div");
            lastOverlay.className = "custom-selection-overlay";
            lastOverlay.style.cssText = `
              position: absolute;
              left: ${lastRelativeLeft}px;
              top: ${lastRelativeTop}px;
              width: ${lastWidth}px;
              height: ${endCoords.bottom - endCoords.top}px;
              background-color: #00f;
              pointer-events: none;
              z-index: 0;
            `;
            if (editorContainer) {
              editorContainer.appendChild(lastOverlay);
            } else {
              document.body.appendChild(lastOverlay);
            }
            selectionOverlays.push(lastOverlay);
          }
        }
      } catch (error) {
        console.error('Error updating selection overlay:', error);
      }
    };

    const handleUpdate = () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      animationFrame = requestAnimationFrame(updateSelectionOverlay);
    };

    // Update overlay on scroll and content changes
    editor.on("update", handleUpdate);
    const editorElement = editor.view.dom;
    const scrollContainer = editorElement.closest('.overflow-auto');
    const handleScroll = () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      animationFrame = requestAnimationFrame(updateSelectionOverlay);
    };
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    }

    // Initial update
    updateSelectionOverlay();

    return () => {
      editor.off("update", handleUpdate);
      scrollContainer.removeEventListener('scroll', handleScroll);
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      selectionOverlays.forEach(overlay => overlay.remove());
    };
  }, [editor, persistentSelection]);

  // Sync content from parent
  useEffect(() => {
    if (!editor) return;
    // Get current content as plain text for comparison
    const currentText = editor.getText();
    // Only update if content actually changed (avoid infinite loops)
    if (content !== currentText && content !== editor.storage.markdown?.getMarkdown?.()) {
      // TipTap can handle plain text/markdown directly
      editor.commands.setContent(content, false); // false = don't emit update event
    }
  }, [content, editor]);

  // Convert markdown to HTML for display (TipTap works with HTML internally)
  const setMarkdownContent = useCallback(
    (markdown: string) => {
      if (!editor) return;
      // TipTap stores content as HTML, but we can work with plain text/markdown
      // For now, we'll set it as plain text and let TipTap handle formatting
      editor.commands.setContent(markdown);
    },
    [editor]
  );

  // Expose methods via ref if needed
  useEffect(() => {
    if (editor && onReady) {
      // Add markdown helper methods to editor instance
      (editor as any).setMarkdown = setMarkdownContent;
      (editor as any).getMarkdown = () => editor.getText();
      (editor as any).insertText = (text: string) => {
        editor.commands.insertContent(text);
      };
      (editor as any).replaceSelection = (text: string) => {
        const { from, to } = editor.state.selection;
        if (from !== to) {
          editor.commands.deleteRange({ from, to });
        }
        editor.commands.insertContent(text);
      };
      (editor as any).getSelectedText = () => {
        const { from, to } = editor.state.selection;
        return editor.state.doc.textBetween(from, to);
      };
    }
  }, [editor, setMarkdownContent, onReady]);

  // Don't render editor until mounted on client
  if (!mounted || !editor) {
    return (
      <div className="flex h-64 items-center justify-center text-brand-muted">
        Loading editor...
      </div>
    );
  }

  return (
    <div className="relative h-full w-full markdown-editor-wrapper">
      <EditorContent editor={editor} />
    </div>
  );
}

