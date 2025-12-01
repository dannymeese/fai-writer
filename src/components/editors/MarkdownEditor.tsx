"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useCallback, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import MarkdownIt from "markdown-it";
import { 
  BoldIcon, 
  ItalicIcon, 
  ListBulletIcon,
  LinkIcon
} from "@heroicons/react/24/outline";

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
  const [showFormattingToolbar, setShowFormattingToolbar] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState({ top: 0, left: 0 });
  const toolbarRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const isUpdatingToolbarRef = useRef(false);
  
  // Initialize markdown parser
  const md = useRef(new MarkdownIt({ html: true, breaks: true })).current;

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
      // Convert HTML to markdown for storage
      const html = editor.getHTML();
      
      // Better HTML to markdown conversion
      function htmlToMarkdown(html: string): string {
        // Create a temporary div to parse HTML
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
      }
      
      const markdown = htmlToMarkdown(html);
      onChange(markdown);
    },
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-invert prose-lg max-w-none focus:outline-none",
          "prose-h1:text-white prose-h1:text-3xl prose-h1:font-bold prose-h1:mt-8 prose-h1:mb-4 prose-h1:leading-tight",
          "prose-h2:text-white prose-h2:text-2xl prose-h2:font-bold prose-h2:mt-6 prose-h2:mb-3 prose-h2:leading-tight",
          "prose-h3:text-white prose-h3:text-xl prose-h3:font-bold prose-h3:mt-4 prose-h3:mb-2 prose-h3:leading-tight",
          "prose-h4:text-white prose-h4:text-lg prose-h4:font-semibold prose-h4:mt-3 prose-h4:mb-2",
          "prose-h5:text-white prose-h5:text-base prose-h5:font-semibold prose-h5:mt-2 prose-h5:mb-1",
          "prose-h6:text-white prose-h6:text-sm prose-h6:font-semibold prose-h6:mt-2 prose-h6:mb-1",
          "prose-p:text-brand-text/90 prose-p:my-2 prose-p:leading-relaxed",
          "prose-strong:text-white prose-strong:font-semibold",
          "prose-code:text-brand-blue prose-pre:bg-brand-panel prose-pre:text-brand-text",
          "prose-blockquote:border-brand-blue prose-blockquote:text-brand-muted",
          "prose-ul:text-brand-text prose-ul:my-2 prose-ul:pl-6 prose-ul:list-disc",
          "prose-ol:text-brand-text prose-ol:my-2 prose-ol:pl-6 prose-ol:list-decimal",
          "prose-li:text-brand-text prose-li:my-1 prose-li:marker:text-white",
          className
        )
      },
      handleKeyDown: (view, event) => {
        // CMD/CTRL + A, C, V, X are handled natively by TipTap and browser
        // Don't interfere with these shortcuts - let them work as expected
        return false;
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
      const cursorHeight = lineHeight * 1.5; // 1.5x taller (keep current height)

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
      
      // Center cursor vertically with a capital X
      // Capital X center is typically around 35-40% down from the top of the line
      // We want to center the cursor on that point
      const capitalXCenter = coords.top + (lineHeight * 0.375); // ~37.5% down for capital X center
      const relativeTop = capitalXCenter - containerRect.top - (cursorHeight / 2);

      // Update position and size
      cursorMarker.style.cssText = `
        position: absolute;
        width: 2px;
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

  // Update formatting toolbar position (with guard to prevent concurrent updates)
  const updateToolbarPosition = useCallback(() => {
    // Prevent concurrent updates
    if (isUpdatingToolbarRef.current) return;
    
    try {
      isUpdatingToolbarRef.current = true;
      
      if (!editor || !editorContainerRef.current) {
        setShowFormattingToolbar(false);
        isUpdatingToolbarRef.current = false;
        return;
      }

      const { from, to } = editor.state.selection;
      
      if (from === to) {
        setShowFormattingToolbar(false);
        isUpdatingToolbarRef.current = false;
        return;
      }

      // Get selection coordinates - use the start position (from) for top line
      const selectionStart = Math.min(from, to);
      const selectionEnd = Math.max(from, to);
      
      let startCoords, endCoords;
      try {
        startCoords = editor.view.coordsAtPos(selectionStart);
        endCoords = editor.view.coordsAtPos(selectionEnd);
      } catch (error) {
        console.error("Error getting selection coordinates:", error);
        setShowFormattingToolbar(false);
        isUpdatingToolbarRef.current = false;
        return;
      }
      
      // Get editor container position
      const containerRect = editorContainerRef.current.getBoundingClientRect();
      
      // Position toolbar above the selection, centered horizontally
      // Use the top of the first line of selection
      const selectionTop = startCoords.top;
      const selectionLeft = Math.min(startCoords.left, endCoords.left);
      const selectionRight = Math.max(startCoords.right, endCoords.right);
      const selectionCenter = (selectionLeft + selectionRight) / 2;
      
      // Approximate toolbar width and height (will be adjusted after render)
      const toolbarWidth = 400;
      const toolbarHeight = 40; // Approximate height
      const left = selectionCenter - containerRect.left - toolbarWidth / 2;
      // Position toolbar 10px above the top line of the selection
      // selectionTop is relative to viewport, so subtract container top to get relative position
      const top = selectionTop - containerRect.top - toolbarHeight - 10;
      
      setToolbarPosition({ top: Math.max(10, top), left: Math.max(10, left) });
      setShowFormattingToolbar(true);
      
      // Reset flag after a short delay to allow state updates
      setTimeout(() => {
        isUpdatingToolbarRef.current = false;
      }, 50);
    } catch (error) {
      console.error("Error updating toolbar position:", error);
      setShowFormattingToolbar(false);
      isUpdatingToolbarRef.current = false;
    }
  }, [editor]);

  // Refine toolbar position after it's rendered (debounced to prevent freezing)
  useEffect(() => {
    if (!showFormattingToolbar || !toolbarRef.current || !editorContainerRef.current || !editor) {
      return;
    }

    let timeoutId: NodeJS.Timeout | null = null;
    let rafId: number | null = null;
    let isMounted = true;

    const refinePosition = () => {
      try {
        if (!isMounted || !toolbarRef.current || !editorContainerRef.current || !editor) {
          return;
        }

        const { from, to } = editor.state.selection;
        if (from === to) {
          setShowFormattingToolbar(false);
          return;
        }

        // Normalize selection order
        const selectionStart = Math.min(from, to);
        const selectionEnd = Math.max(from, to);
        
        // Get coordinates for the start of selection (top line)
        let startCoords, endCoords;
        try {
          startCoords = editor.view.coordsAtPos(selectionStart);
          endCoords = editor.view.coordsAtPos(selectionEnd);
        } catch (error) {
          console.error("Error getting coordinates in refinePosition:", error);
          return;
        }
        
        const containerRect = editorContainerRef.current.getBoundingClientRect();
        
        // Use the top of the first line of selection
        const selectionTop = startCoords.top;
        const selectionLeft = Math.min(startCoords.left, endCoords.left);
        const selectionRight = Math.max(startCoords.right, endCoords.right);
        const selectionCenter = (selectionLeft + selectionRight) / 2;
        
        const toolbarWidth = toolbarRef.current.offsetWidth || 400;
        const toolbarHeight = toolbarRef.current.offsetHeight || 40;
        const left = selectionCenter - containerRect.left - toolbarWidth / 2;
        
        // Position toolbar 10px above the top line of the selection
        const top = selectionTop - containerRect.top - toolbarHeight - 10;
        const finalTop = Math.max(10, top);
        
        setToolbarPosition({ 
          top: finalTop, 
          left: Math.max(10, Math.min(left, containerRect.width - toolbarWidth - 10)) 
        });
      } catch (error) {
        console.error("Error in refinePosition:", error);
        setShowFormattingToolbar(false);
      }
    };

    // Debounce the refinement to prevent excessive updates
    timeoutId = setTimeout(() => {
      if (isMounted) {
        rafId = requestAnimationFrame(refinePosition);
      }
    }, 50);

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [showFormattingToolbar, editor]);

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
        
        // Normalize selection (handle right-to-left selections)
        const selectionStart = Math.min(from, to);
        const selectionEnd = Math.max(from, to);
        
        if (selectionStart !== selectionEnd) {
          // Store persistent selection (always use normalized order)
          setPersistentSelection({ from: selectionStart, to: selectionEnd });
          const selectedText = editor.state.doc.textBetween(selectionStart, selectionEnd);
          onSelectionChange(selectedText);
          // Debounce toolbar position update to prevent freezing
          setTimeout(() => {
            try {
              updateToolbarPosition();
            } catch (error) {
              console.error("Error updating toolbar position in handleMouseUp:", error);
            }
          }, 10);
        } else {
          // Only clear if user explicitly cleared (clicked in editor without selecting)
          const editorElement = editor.view.dom;
          if (window.document.activeElement === editorElement) {
            setPersistentSelection(null);
            onSelectionChange(null);
            setShowFormattingToolbar(false);
          }
        }
      }, 50);
    };

    const handleSelectionUpdate = () => {
      // Always check selection, regardless of drag state
      const { from, to } = editor.state.selection;
      
      // Normalize selection (handle right-to-left selections)
      const selectionStart = Math.min(from, to);
      const selectionEnd = Math.max(from, to);
      
      if (selectionStart !== selectionEnd) {
        // Store persistent selection (always use normalized order)
        setPersistentSelection({ from: selectionStart, to: selectionEnd });
        const selectedText = editor.state.doc.textBetween(selectionStart, selectionEnd);
        onSelectionChange(selectedText);
        // Debounce toolbar position update to prevent freezing
        setTimeout(() => {
          try {
            updateToolbarPosition();
          } catch (error) {
            console.error("Error updating toolbar position in handleSelectionUpdate:", error);
          }
        }, 10);
      } else {
        // Only clear persistent selection if user clicked directly in editor
        // Don't clear if focus was lost due to clicking input field
        const editorElement = editor.view.dom;
        const activeElement = window.document.activeElement;
        const isInputFocused = activeElement instanceof HTMLTextAreaElement && 
                               activeElement.closest('.compose-bar');
        
        // Only clear if editor has focus (user clicked in editor) and not if input is focused
        if (window.document.activeElement === editorElement && !isInputFocused) {
          setPersistentSelection(null);
          onSelectionChange(null);
          setShowFormattingToolbar(false);
        }
        // If input is focused, keep the persistent selection
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

    // Update toolbar on scroll (debounced to prevent freezing)
    const scrollContainer = editorElement.closest('.overflow-auto');
    let scrollTimeout: NodeJS.Timeout | null = null;
    const handleScroll = () => {
      try {
        const { from, to } = editor.state.selection;
        if (from !== to && showFormattingToolbar) {
          if (scrollTimeout) clearTimeout(scrollTimeout);
          scrollTimeout = setTimeout(() => {
            try {
              updateToolbarPosition();
            } catch (error) {
              console.error("Error updating toolbar position on scroll:", error);
            }
          }, 50);
        }
      } catch (error) {
        console.error("Error in scroll handler:", error);
      }
    };
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    }

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
      editorElement.removeEventListener("mousedown", handleMouseDown);
      editorElement.removeEventListener("mouseup", handleMouseUp);
      editorElement.removeEventListener("blur", handleBlur);
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', handleScroll);
      }
      if (dragTimeout) clearTimeout(dragTimeout);
      if (scrollTimeout) clearTimeout(scrollTimeout);
    };
  }, [editor, onSelectionChange, updateToolbarPosition]);

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

  // Sync content from parent - convert markdown to HTML for TipTap
  useEffect(() => {
    if (!editor) return;
    
    // Convert markdown to HTML for TipTap
    const html = md.render(content || '');
    
    // Get current HTML for comparison
    const currentHtml = editor.getHTML();
    
    // Only update if content actually changed (avoid infinite loops)
    if (html !== currentHtml && content !== '') {
      editor.commands.setContent(html, false); // false = don't emit update event
    } else if (content === '' && currentHtml !== '<p></p>') {
      editor.commands.setContent('', false);
    }
  }, [content, editor, md]);

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

  // Formatting button handlers
  const handleFormat = useCallback((command: () => boolean) => {
    if (!editor) return;
    // Ensure editor has focus before applying formatting
    editor.commands.focus();
    const result = command();
    // Keep selection after formatting
    setTimeout(() => {
      updateToolbarPosition();
    }, 10);
    return result;
  }, [editor, updateToolbarPosition]);

  // Don't render editor until mounted on client
  if (!mounted || !editor) {
    return (
      <div className="flex h-64 items-center justify-center text-brand-muted">
        Loading editor...
      </div>
    );
  }

  return (
    <div className="relative h-full w-full markdown-editor-wrapper" ref={editorContainerRef}>
      <EditorContent editor={editor} />
      
      {/* Floating Formatting Toolbar */}
      {showFormattingToolbar && editor && (
        <div
          ref={toolbarRef}
          className="absolute z-50 flex items-center gap-1 rounded-full border border-brand-stroke/60 bg-brand-panel px-2 py-1 shadow-lg"
          style={{
            top: `${toolbarPosition.top}px`,
            left: `${toolbarPosition.left}px`,
          }}
        >
          {/* Bold */}
          <button
            type="button"
            onClick={() => handleFormat(() => editor.chain().focus().toggleBold().run())}
            className={cn(
              "rounded-full p-2 transition hover:bg-brand-blue/20",
              editor.isActive('bold') ? "bg-brand-blue/30 text-white" : "text-brand-muted hover:text-white"
            )}
            title="Bold"
          >
            <BoldIcon className="h-4 w-4" />
          </button>

          {/* Italic */}
          <button
            type="button"
            onClick={() => handleFormat(() => editor.chain().focus().toggleItalic().run())}
            className={cn(
              "rounded-full p-2 transition hover:bg-brand-blue/20",
              editor.isActive('italic') ? "bg-brand-blue/30 text-white" : "text-brand-muted hover:text-white"
            )}
            title="Italic"
          >
            <ItalicIcon className="h-4 w-4" />
          </button>

          {/* Divider */}
          <div className="mx-1 h-6 w-px bg-brand-stroke/40" />

          {/* Headings */}
          {[1, 2, 3].map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => {
                editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 }).run();
                updateToolbarPosition();
              }}
              className={cn(
                "rounded-full px-2 py-1 text-xs font-semibold transition hover:bg-brand-blue/20",
                editor.isActive('heading', { level: level as 1 | 2 | 3 }) 
                  ? "bg-brand-blue/30 text-white" 
                  : "text-brand-muted hover:text-white"
              )}
              title={`Heading ${level}`}
            >
              H{level}
            </button>
          ))}

          {/* Divider */}
          <div className="mx-1 h-6 w-px bg-brand-stroke/40" />

          {/* Bullet List */}
          <button
            type="button"
            onClick={() => {
              editor.chain().focus().toggleBulletList().run();
              updateToolbarPosition();
            }}
            className={cn(
              "rounded-full p-2 transition hover:bg-brand-blue/20",
              editor.isActive('bulletList') ? "bg-brand-blue/30 text-white" : "text-brand-muted hover:text-white"
            )}
            title="Bullet List"
          >
            <ListBulletIcon className="h-4 w-4" />
          </button>

          {/* Ordered List */}
          <button
            type="button"
            onClick={() => {
              editor.chain().focus().toggleOrderedList().run();
              updateToolbarPosition();
            }}
            className={cn(
              "rounded-full px-2 py-1 text-xs font-semibold transition hover:bg-brand-blue/20",
              editor.isActive('orderedList') ? "bg-brand-blue/30 text-white" : "text-brand-muted hover:text-white"
            )}
            title="Numbered List"
          >
            123
          </button>
        </div>
      )}
    </div>
  );
}

