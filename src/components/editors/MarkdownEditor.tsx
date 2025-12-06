"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useCallback, useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import MarkdownIt from "markdown-it";
import { 
  BoldIcon, 
  ItalicIcon, 
  ListBulletIcon,
  LinkIcon,
  StrikethroughIcon,
  PlusIcon
} from "@heroicons/react/24/outline";

const TOOLBAR_GAP_PX = 10;
const SHORTCUT_CODE_MAP: Record<string, "copy" | "cut" | "paste" | "selectAll"> = {
  KeyC: "copy",
  KeyX: "cut",
  KeyV: "paste",
  KeyP: "paste",
  KeyA: "selectAll"
} as const;
const SHORTCUT_KEY_MAP: Record<string, "copy" | "cut" | "paste" | "selectAll"> = {
  c: "copy",
  x: "cut",
  v: "paste",
  p: "paste",
  a: "selectAll"
} as const;

function stripLinksFromHtml(html: string): { sanitized: string; removed: boolean } {
  const tempDiv = window.document.createElement("div");
  tempDiv.innerHTML = html;
  const anchors = Array.from(tempDiv.querySelectorAll("a"));
  if (!anchors.length) {
    return { sanitized: html, removed: false };
  }
  anchors.forEach((anchor) => {
    if (anchor.childNodes.length) {
      const fragment = document.createDocumentFragment();
      while (anchor.firstChild) {
        fragment.appendChild(anchor.firstChild);
      }
      anchor.replaceWith(fragment);
    } else {
      anchor.replaceWith(anchor.textContent ?? "");
    }
  });
  return { sanitized: tempDiv.innerHTML, removed: true };
}

type MarkdownEditorProps = {
  content: string;
  onChange: (content: string) => void;
  onSelectionChange?: (selectedText: string | null) => void;
  placeholder?: string;
  editable?: boolean;
  className?: string;
  onReady?: (editor: ReturnType<typeof useEditor>) => void;
  hasPersona?: boolean;
  activePersonaId?: string | null;
  horizontalPadding?: {
    left?: number;
    right?: number;
  };
  onSaveStyle?: () => void;
  onTyping?: () => void;
};

export default function MarkdownEditor({
  content,
  onChange,
  onSelectionChange,
  placeholder = "Start writing...",
  editable = true,
  className,
  onReady,
  hasPersona = false,
  activePersonaId,
  horizontalPadding,
  onSaveStyle,
  onTyping
}: MarkdownEditorProps) {
  const [persistentSelection, setPersistentSelection] = useState<{ from: number; to: number } | null>(null);
  const [showFormattingToolbar, setShowFormattingToolbar] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState({ top: 0, left: 0, isSticky: false });
  const [addingToPersona, setAddingToPersona] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [plusMenuPosition, setPlusMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const addToPersonaButtonRef = useRef<HTMLButtonElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const isInternalUpdateRef = useRef(false);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const isUpdatingToolbarRef = useRef(false);
  const toolbarSizeRef = useRef({ width: 360, height: 48 });
  const persistentSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const lastSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const isSelectionDraggingRef = useRef(false);
  const pendingUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTypingTimeRef = useRef<number>(0);


  const getToolbarSafeTop = useCallback(() => {
    if (typeof window === "undefined") {
      return 64;
    }

    const resolveBottom = (element: HTMLElement | null) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const style = window.getComputedStyle(element);
      const isHidden =
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0" ||
        style.pointerEvents === "none";
      if (isHidden) return null;
      return rect.bottom;
    };

    const doc = window.document;
    const candidates: number[] = [];

    const stickyBar = doc.querySelector<HTMLElement>("[data-document-sticky-title]");
    const stickyBottom = resolveBottom(stickyBar);
    if (stickyBottom !== null) {
      candidates.push(stickyBottom + 4);
    }

    const siteHeader = doc.querySelector<HTMLElement>("[data-site-header]");
    const siteHeaderBottom = resolveBottom(siteHeader);
    if (siteHeaderBottom !== null) {
      candidates.push(siteHeaderBottom + 4);
    } else {
      const headers = doc.querySelectorAll<HTMLElement>("header");
      headers.forEach((header) => {
        const style = window.getComputedStyle(header);
        if (style.position === "sticky" || style.position === "fixed") {
          const bottom = resolveBottom(header);
          if (bottom !== null) {
            candidates.push(bottom + 4);
          }
        }
      });
    }

    return candidates.length ? Math.max(...candidates) : 64;
  }, []);

  const getToolbarSafeBottom = useCallback(() => {
    if (typeof window === "undefined") {
      return Infinity; // Fallback for SSR
    }

    const resolveTop = (element: HTMLElement | null) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const style = window.getComputedStyle(element);
      const isHidden =
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0" ||
        style.pointerEvents === "none";
      if (isHidden) return null;
      return rect.top;
    };

    const doc = window.document;
    const composeBar = doc.querySelector<HTMLElement>(".compose-bar");
    const composeBarTop = resolveTop(composeBar);
    
    if (composeBarTop !== null) {
      // Return position 4px above the compose bar
      return composeBarTop - 4;
    }

    // Fallback to viewport bottom if compose bar not found
    return window.innerHeight;
  }, []);
  
  // Initialize markdown parser with proper configuration
  const md = useMemo(() => {
    const parser = new MarkdownIt({ 
      html: true, 
      breaks: true,
      linkify: true
    });
    return parser;
  }, []);
  
  // Convert initial markdown content to HTML for TipTap
  const initialHtml = useMemo(() => {
    if (!content) return '';
    return md.render(content);
  }, [content, md]);
  
  const setPersistentSelectionState = useCallback(
    (range: { from: number; to: number } | null) => {
      setPersistentSelection(range);
      persistentSelectionRef.current = range;
    },
    []
  );
  const updateLastSelectionRange = useCallback((range: { from: number; to: number }) => {
    lastSelectionRef.current = range;
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
    content: initialHtml,
    editable,
    immediatelyRender: false, // Prevent SSR hydration issues
    onUpdate: ({ editor }) => {
      // Mark this as an internal update to prevent cursor reset
      // Keep it set until after onChange completes to prevent content sync loop
      isInternalUpdateRef.current = true;
      lastTypingTimeRef.current = Date.now();
      
      // Notify parent about typing
      if (onTyping) {
        onTyping();
      }
      
      // Clear any pending update timeout
      if (pendingUpdateTimeoutRef.current) {
        clearTimeout(pendingUpdateTimeoutRef.current);
      }
      
      // Small delay to ensure formatting is applied before converting to markdown
      // This prevents race conditions where formatting gets lost
      // Use a debounce to batch rapid updates
      pendingUpdateTimeoutRef.current = setTimeout(() => {
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
              case 's':
              case 'del': return `~~${children}~~`;
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
            .replace(/\n{3,}/g, '\n\n'); // do not trim; preserve trailing newlines/blank lines
        }
        
        const markdown = htmlToMarkdown(html);
        onChange(markdown);
        // Reset the flag after onChange completes, but use a longer delay
        // to ensure any state updates from onChange have been processed and
        // to prevent race conditions when typing quickly
        // Wait longer if user was typing recently
        const timeSinceLastTyping = Date.now() - lastTypingTimeRef.current;
        const delay = timeSinceLastTyping < 100 ? 150 : 50;
        setTimeout(() => {
          isInternalUpdateRef.current = false;
        }, delay);
      }, 0);
    },
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-invert prose-lg max-w-none focus:outline-none",
          "prose-h1:text-white prose-h1:text-[40pt] prose-h1:font-bold prose-h1:mt-8 prose-h1:mb-4 prose-h1:leading-tight",
          "prose-h2:text-white prose-h2:text-[32pt] prose-h2:font-bold prose-h2:mt-6 prose-h2:mb-3 prose-h2:leading-tight",
          "prose-h3:text-white prose-h3:text-[24pt] prose-h3:font-bold prose-h3:mt-4 prose-h3:mb-2 prose-h3:leading-tight",
          "prose-h4:text-white prose-h4:text-lg prose-h4:font-semibold prose-h4:mt-3 prose-h4:mb-2",
          "prose-h5:text-white prose-h5:text-base prose-h5:font-semibold prose-h5:mt-2 prose-h5:mb-1",
          "prose-h6:text-white prose-h6:text-sm prose-h6:font-semibold prose-h6:mt-2 prose-h6:mb-1",
          "prose-p:text-brand-text/90 prose-p:text-[20pt] prose-p:mb-[32px] prose-p:mt-0 prose-p:leading-[32px]",
          "prose-strong:text-white prose-strong:font-semibold",
          "prose-del:text-brand-muted prose-del:line-through",
          "prose-s:text-brand-muted prose-s:line-through",
          "prose-code:text-brand-blue prose-pre:bg-brand-panel prose-pre:text-brand-text",
          "prose-blockquote:border-brand-blue prose-blockquote:text-brand-muted",
          "prose-ul:text-brand-text prose-ul:my-2 prose-ul:pl-6 prose-ul:list-disc",
          "prose-ol:text-brand-text prose-ol:my-2 prose-ol:pl-6 prose-ol:list-decimal",
          "prose-li:text-brand-text prose-li:my-1 prose-li:marker:text-white",
          className
        )
      },
      handleKeyDown: (view, event) => {
        // Handle CMD/CTRL+SHIFT+X for strikethrough
        if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'x') {
          event.preventDefault();
          if (editor) {
            editor.chain().focus().toggleStrike().run();
          }
          return true;
        }
        
        // Allow all other keyboard shortcuts to work natively
        // TipTap handles CMD/CTRL+A, C, V, X by default
        // Return false to let TipTap/browser handle the event
        return false;
      },
      handleDOMEvents: {
        // Explicitly allow context menu (right-click) to work
        contextmenu: (view, event) => {
          // Return false to allow the default context menu behavior
          // This ensures the browser's native context menu appears
          return false;
        },
      },
    }
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    
    // Cleanup timeout on unmount
    return () => {
      if (pendingUpdateTimeoutRef.current) {
        clearTimeout(pendingUpdateTimeoutRef.current);
        pendingUpdateTimeoutRef.current = null;
      }
    };
  }, [editor, showFormattingToolbar]);

  // Notify parent when editor is ready
  useEffect(() => {
    if (editor && onReady) {
      onReady(editor);
    }
  }, [editor, onReady]);
  useEffect(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    lastSelectionRef.current = { from, to };
  }, [editor]);

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

  // Resolve horizontal padding values
  const resolvedMarginLeft = horizontalPadding?.left ?? 180;
  const resolvedMarginRight = horizontalPadding?.right ?? 180;

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
      // Fix the cursor height to 40px to avoid jitter across lines
      const cursorHeight = 40;
      // Use a consistent line height for positioning the cursor
      const lineHeight = 40;

      // Get editor container position
      const editorElement = editor.view.dom;
      const editorContainer = editorElement.closest('.overflow-auto') || editorElement.parentElement;
      const containerRect = editorContainer?.getBoundingClientRect() || { left: 0, top: 0, width: 0 };

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

      // Blink only when editor is focused
      const animation = editor.isFocused ? 'blink 1s infinite' : 'none';

      // Calculate position relative to container using dynamic margins
      let relativeLeft = coords.left - containerRect.left - 2; // shift cursor 2px left
      
      // Constrain cursor to content area (never in margins)
      if (relativeLeft < resolvedMarginLeft) {
        relativeLeft = resolvedMarginLeft;
      } else if (relativeLeft > containerRect.width - resolvedMarginRight) {
        relativeLeft = containerRect.width - resolvedMarginRight;
      }
      
      // Center cursor vertically with a capital X
      // Capital X center is typically around 35-40% down from the top of the line
      // We want to center the cursor on that point
      const capitalXCenter = coords.top + (lineHeight * 0.375); // ~37.5% down for capital X center
      const relativeTop = capitalXCenter - containerRect.top - (cursorHeight / 2) - 6; // lift cursor up 6px

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
    editor.on("focus", handleUpdate);
    editor.on("blur", handleUpdate);
    
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

    // Update on window resize (for when sidebar toggles)
    const handleResize = () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      animationFrame = requestAnimationFrame(updateCursorMarker);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
      editor.off("update", handleUpdate);
      editor.off("focus", handleUpdate);
      editor.off("blur", handleUpdate);
      scrollContainer?.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      if (cursorMarker) {
        cursorMarker.remove();
      }
    };
  }, [editor, resolvedMarginLeft, resolvedMarginRight]);

  // Auto-scroll cursor into view when typing
  useEffect(() => {
    if (!editor) return;

    let scrollAnimationFrame: number | null = null;

    const scrollCursorIntoView = () => {
      // Only scroll if editor is focused
      if (!editor.isFocused) return;

      const { from, to } = editor.state.selection;
      
      // Only scroll if there's no selection (cursor mode)
      if (from !== to) return;

      try {
        // Get cursor position in viewport coordinates
        const coords = editor.view.coordsAtPos(from);
        const editorElement = editor.view.dom;
        const scrollContainer = editorElement.closest('.overflow-auto') as HTMLElement;
        
        if (!scrollContainer) return;

        // Get container bounds in viewport coordinates
        const containerRect = scrollContainer.getBoundingClientRect();
        
        // Determine header height (100px when not scrolled, 60px when scrolled)
        const headerHeight = window.scrollY > 0 ? 60 : 100;
        
        // Check if sticky title bar is visible (it's at top-[60px] = 60px from top of viewport)
        // The sticky title appears when title scrolls out of view
        const stickyTitleHeight = window.scrollY > 0 ? 40 : 0; // Only visible when scrolled
        const effectiveTopOffset = headerHeight + stickyTitleHeight;

        // Cursor position in viewport coordinates
        const cursorTop = coords.top;
        const cursorBottom = coords.bottom;
        
        // Padding from edges
        const padding = 20;
        
        // Calculate visible area of container (accounting for header/sticky title)
        const containerVisibleTop = Math.max(containerRect.top, effectiveTopOffset);
        const containerVisibleBottom = Math.min(containerRect.bottom, window.innerHeight);
        
        // Check if cursor is out of view
        const isAboveVisible = cursorTop < containerVisibleTop;
        const isBelowVisible = cursorBottom > containerVisibleBottom;

        // Only scroll if cursor is actually out of view
        if (!isAboveVisible && !isBelowVisible) {
          return; // Cursor is visible, no need to scroll
        }

        // Calculate scroll delta
        // When we scroll the container down, content moves up in viewport
        // So if cursor is above target, we scroll up (negative delta)
        // If cursor is below target, we scroll down (positive delta)
        let scrollDelta = 0;

        if (isAboveVisible) {
          // Cursor is above visible area - scroll container up to bring cursor down
          // Target: cursor should be at containerVisibleTop + padding
          const targetTop = containerVisibleTop + padding;
          scrollDelta = cursorTop - targetTop;
        } else if (isBelowVisible) {
          // Cursor is below visible area - scroll container down to bring cursor up
          const targetBottom = containerVisibleBottom - padding;
          scrollDelta = cursorBottom - targetBottom;
        }

        // Scroll the container if needed
        if (Math.abs(scrollDelta) > 1) { // Only scroll if delta is significant (> 1px)
          const currentScrollTop = scrollContainer.scrollTop;
          const newScrollTop = currentScrollTop + scrollDelta;
          
          // Use smooth scrolling
          scrollContainer.scrollTo({
            top: Math.max(0, newScrollTop),
            behavior: 'smooth'
          });
        }
      } catch (error) {
        // Silently fail if there's an error getting coordinates
        console.error('Error scrolling cursor into view:', error);
      }
    };

    const handleUpdate = () => {
      if (scrollAnimationFrame) {
        cancelAnimationFrame(scrollAnimationFrame);
      }
      scrollAnimationFrame = requestAnimationFrame(scrollCursorIntoView);
    };

    // Only listen to update events when editor is focused
    const handleFocus = () => {
      editor.on("update", handleUpdate);
    };

    const handleBlur = () => {
      editor.off("update", handleUpdate);
    };

    editor.on("focus", handleFocus);
    editor.on("blur", handleBlur);
    
    // If already focused, start listening
    if (editor.isFocused) {
      editor.on("update", handleUpdate);
    }

    return () => {
      editor.off("focus", handleFocus);
      editor.off("blur", handleBlur);
      editor.off("update", handleUpdate);
      if (scrollAnimationFrame) {
        cancelAnimationFrame(scrollAnimationFrame);
      }
    };
  }, [editor]);

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
      const selectionTop = startCoords.top;
      const selectionLeft = Math.min(startCoords.left, endCoords.left);
      const selectionRight = Math.max(startCoords.right, endCoords.right);
      const selectionCenter = (selectionLeft + selectionRight) / 2;
      const selectionTopRelative = selectionTop - containerRect.top;
      
      const toolbarWidth = toolbarRef.current?.offsetWidth || toolbarSizeRef.current.width;
      const left = selectionCenter - containerRect.left - toolbarWidth / 2;
      const clampedLeft = Math.max(10, Math.min(left, containerRect.width - toolbarWidth - 10));
      const toolbarHeight = toolbarRef.current?.offsetHeight || toolbarSizeRef.current.height || 0;
      let finalTop = selectionTopRelative;
      let isSticky = false;
      if (toolbarHeight > 0) {
        const safeTop = getToolbarSafeTop();
        const safeBottom = getToolbarSafeBottom();
        const projectedViewportTop = containerRect.top + finalTop - toolbarHeight - TOOLBAR_GAP_PX;
        
        // Check if toolbar would be covered at the top
        if (projectedViewportTop < safeTop) {
          isSticky = true;
          finalTop = safeTop + toolbarHeight + TOOLBAR_GAP_PX - containerRect.top;
        }
        // Recalculate bottom position after potentially adjusting for top
        // The toolbar bottom is at: containerRect.top + finalTop
        const projectedViewportBottom = containerRect.top + finalTop;
        // Check if toolbar would be covered by chat overlay or go off-screen at the bottom
        // We want it to be above safeBottom (which is 4px above compose bar)
        if (projectedViewportBottom > safeBottom) {
          isSticky = true;
          // Position toolbar so its bottom is at safeBottom (4px above compose bar)
          finalTop = safeBottom - containerRect.top;
        }
      }
      if (!isSticky) {
        finalTop = Math.max(0, finalTop);
      }
      
      setToolbarPosition({ top: finalTop, left: clampedLeft, isSticky });
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
  }, [editor, getToolbarSafeTop, getToolbarSafeBottom]);

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
        const selectionTopRelative = selectionTop - containerRect.top;
        
        const measuredWidth = toolbarRef.current.offsetWidth || toolbarSizeRef.current.width;
        const measuredHeight = toolbarRef.current.offsetHeight || toolbarSizeRef.current.height;
        toolbarSizeRef.current = { width: measuredWidth, height: measuredHeight };
        const left = selectionCenter - containerRect.left - measuredWidth / 2;
        let finalTop = selectionTopRelative;
        let isSticky = false;
        if (measuredHeight > 0) {
          const safeTop = getToolbarSafeTop();
          const safeBottom = getToolbarSafeBottom();
          const projectedViewportTop = containerRect.top + finalTop - measuredHeight - TOOLBAR_GAP_PX;
          
          // Check if toolbar would be covered at the top
          if (projectedViewportTop < safeTop) {
            isSticky = true;
            finalTop = safeTop + measuredHeight + TOOLBAR_GAP_PX - containerRect.top;
          }
          // Recalculate bottom position after potentially adjusting for top
          // The toolbar bottom is at: containerRect.top + finalTop
          const projectedViewportBottom = containerRect.top + finalTop;
          // Check if toolbar would be covered by chat overlay or go off-screen at the bottom
          // We want it to be above safeBottom (which is 4px above compose bar)
          if (projectedViewportBottom > safeBottom) {
            isSticky = true;
            // Position toolbar so its bottom is at safeBottom (4px above compose bar)
            finalTop = safeBottom - containerRect.top;
          }
        }
        if (!isSticky) {
          finalTop = Math.max(0, finalTop);
        }
        
        setToolbarPosition({ 
          top: finalTop, 
          left: Math.max(10, Math.min(left, containerRect.width - measuredWidth - 10)),
          isSticky
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
  }, [showFormattingToolbar, editor, getToolbarSafeTop, getToolbarSafeBottom]);

  useEffect(() => {
    if (!showFormattingToolbar || !toolbarRef.current) {
      return;
    }
    if (typeof ResizeObserver === "undefined") {
      toolbarSizeRef.current = {
        width: toolbarRef.current.offsetWidth,
        height: toolbarRef.current.offsetHeight
      };
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      toolbarSizeRef.current = {
        width: entry.contentRect.width,
        height: entry.contentRect.height
      };
    });
    observer.observe(toolbarRef.current);
    return () => observer.disconnect();
  }, [showFormattingToolbar]);

  // Close plus menu when formatting toolbar disappears
  useEffect(() => {
    if (!showFormattingToolbar) {
      setShowPlusMenu(false);
      setPlusMenuPosition(null);
    }
  }, [showFormattingToolbar]);

  // Update plus menu position when toolbar position changes or on scroll/resize
  useEffect(() => {
    if (!showPlusMenu || !plusButtonRef.current) {
      return;
    }

    const updatePosition = () => {
      if (!plusButtonRef.current) return;
      
      const buttonRect = plusButtonRef.current.getBoundingClientRect();
      setPlusMenuPosition({
        top: buttonRect.top - 8, // 8px gap above button
        left: buttonRect.left
      });
    };

    // Update immediately
    updatePosition();
    
    // Update on scroll (capture phase to catch all scroll events)
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [showPlusMenu, toolbarPosition.top, toolbarPosition.left, showFormattingToolbar]);

  // Handle clicking outside plus menu to close it
  useEffect(() => {
    if (!showPlusMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        plusButtonRef.current &&
        plusMenuRef.current &&
        !plusButtonRef.current.contains(target) &&
        !plusMenuRef.current.contains(target)
      ) {
        setShowPlusMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPlusMenu]);

  // Handle selection changes and maintain persistent selection
  useEffect(() => {
    if (!editor || !onSelectionChange) return;

    let dragTimeout: NodeJS.Timeout | null = null;
    let dragStartInMargin = false;
    let marginDragStartPos: { x: number; y: number } | null = null;

    const handleMouseDown = (e: MouseEvent) => {
      // Don't hide toolbar if clicking on the toolbar itself
      const target = e.target as HTMLElement | null;
      if (target && toolbarRef.current && toolbarRef.current.contains(target)) {
        return; // Don't hide toolbar or start drag when clicking toolbar buttons
      }
      
      // Also check if clicking on the plus button or menu
      if (target && plusButtonRef.current && plusButtonRef.current.contains(target)) {
        return;
      }
      if (target && plusMenuRef.current && plusMenuRef.current.contains(target)) {
        return;
      }
      
      isSelectionDraggingRef.current = true;
      setShowFormattingToolbar(false);
      
      // Check if mousedown started in margins
      const editorElement = editor.view.dom;
      const editorContainer = editorElement.closest('.overflow-auto');
      if (!editorContainer) return;
      
      const containerRect = editorContainer.getBoundingClientRect();
      const marginLeft = resolvedMarginLeft;
      const marginRight = containerRect.width - resolvedMarginRight;
      
      // Check if click is in left or right margin
      if (e.clientX < containerRect.left + marginLeft || e.clientX > containerRect.left + marginRight) {
        dragStartInMargin = true;
        marginDragStartPos = { x: e.clientX, y: e.clientY };
        // Focus editor
        editor.commands.focus();
        
        // Find the line at the Y position where user clicked
        const clickY = e.clientY;
        const isLeftMargin = e.clientX < containerRect.left + marginLeft;
        
        // Use TipTap's posAtCoords to find the document position at the click point
        // Use different X coordinates for left vs right margin to get accurate line detection
        // For left margin, use a point near the left edge; for right margin, use a point near the right edge
        const contentX = isLeftMargin
          ? containerRect.left + marginLeft + 10  // Small offset from left edge
          : containerRect.left + marginRight - 10; // Small offset from right edge
        
        const pos = editor.view.posAtCoords({ left: contentX, top: clickY });
        
        if (pos !== null) {
          // Find the start and end of the line/block containing this position
          const $pos = editor.state.doc.resolve(pos.pos);
          
          // Find the block node (paragraph, heading, etc.) that contains this position
          let blockStart = pos.pos;
          let blockEnd = pos.pos;
          
          // Walk up the document structure to find the block boundaries
          for (let depth = $pos.depth; depth >= 0; depth--) {
            const node = $pos.node(depth);
            if (node.type.isBlock) {
              blockStart = $pos.start(depth);
              blockEnd = $pos.end(depth);
              break;
            }
          }
          
          // For inline content, find the actual line boundaries within the block
          // Get the text content of the block and find line breaks
          const blockText = editor.state.doc.textBetween(blockStart, blockEnd, "\n");
          const relativePos = pos.pos - blockStart;
          
          // Find the start of the current line within the block
          const textBefore = blockText.substring(0, relativePos);
          const lastNewline = textBefore.lastIndexOf('\n');
          const lineStartInBlock = lastNewline === -1 ? 0 : lastNewline + 1;
          
          // Find the end of the current line within the block
          const textAfter = blockText.substring(relativePos);
          const nextNewline = textAfter.indexOf('\n');
          // lineEndInBlock is relative to blockStart, so we need to add relativePos to get the offset from blockStart
          const lineEndInBlock = nextNewline === -1 ? blockText.length : relativePos + nextNewline;
          
          // Calculate absolute positions
          const absoluteLineStart = blockStart + lineStartInBlock;
          const absoluteLineEnd = blockStart + lineEndInBlock;
          
          // Set cursor to start or end of line based on which margin was clicked
          if (isLeftMargin) {
            editor.commands.setTextSelection(absoluteLineStart);
          } else {
            // For right margin, make sure we're at the end of the line, not before a newline
            // If the line ends with a newline, position before it; otherwise at the end
            const finalPos = absoluteLineEnd;
            editor.commands.setTextSelection(finalPos);
          }
        }
      } else {
        dragStartInMargin = false;
        marginDragStartPos = null;
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isSelectionDraggingRef.current || !dragStartInMargin || !marginDragStartPos) return;
      
      const editorElement = editor.view.dom;
      const editorContainer = editorElement.closest('.overflow-auto');
      if (!editorContainer) return;
      
      const containerRect = editorContainer.getBoundingClientRect();
      const marginLeft = resolvedMarginLeft;
      const marginRight = containerRect.width - resolvedMarginRight;
      
      // If still in margin, don't update selection
      if (e.clientX < containerRect.left + marginLeft || e.clientX > containerRect.left + marginRight) {
        return;
      }
      
      // Now in content area - allow normal selection
      dragStartInMargin = false;
    };

    const handleMouseUp = () => {
      // Small delay to ensure selection is finalized
      if (dragTimeout) clearTimeout(dragTimeout);
      dragTimeout = setTimeout(() => {
        isSelectionDraggingRef.current = false;
        const { from, to } = editor.state.selection;
        
        // Normalize selection (handle right-to-left selections)
        const selectionStart = Math.min(from, to);
        const selectionEnd = Math.max(from, to);
        
        if (selectionStart !== selectionEnd) {
          // Store persistent selection (always use normalized order)
          const normalizedRange = { from: selectionStart, to: selectionEnd };
          updateLastSelectionRange(normalizedRange);
          setPersistentSelectionState(normalizedRange);
          // Get HTML to preserve <br> tags from soft returns and <p> tags from hard returns, then convert to text
          const slice = editor.state.doc.slice(selectionStart, selectionEnd);
          const fragment = editor.view.state.schema.cached.domSerializer?.serializeFragment(slice.content, { document: window.document }) || document.createDocumentFragment();
          const tempDiv = document.createElement('div');
          tempDiv.appendChild(fragment.cloneNode(true));
          // Convert <p> tags to newlines (hard returns/paragraphs) - replace closing </p> with newline
          tempDiv.innerHTML = tempDiv.innerHTML.replace(/<\/p>/gi, '\n</p>');
          // Convert <br> tags to newlines (soft returns)
          tempDiv.querySelectorAll('br').forEach(br => {
            br.replaceWith('\n');
          });
          // Get plain text (newlines from both <p> and <br> tags are now preserved)
          const selectedText = tempDiv.textContent || '';
          onSelectionChange(selectedText);
          // Debounce toolbar position update to prevent freezing - increased delay
          setTimeout(() => {
            try {
              updateToolbarPosition();
            } catch (error) {
              console.error("Error updating toolbar position in handleMouseUp:", error);
            }
          }, 100);
        } else {
          // Always track the most recent caret position
          updateLastSelectionRange({ from: selectionStart, to: selectionEnd });
          // Only clear if user explicitly cleared (clicked in editor without selecting)
          const editorElement = editor.view.dom;
          if (window.document.activeElement === editorElement) {
            setPersistentSelectionState(null);
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
        const normalizedRange = { from: selectionStart, to: selectionEnd };
        updateLastSelectionRange(normalizedRange);
        setPersistentSelectionState(normalizedRange);
        // Get HTML to preserve <br> tags from soft returns and <p> tags from hard returns, then convert to text
        const slice = editor.state.doc.slice(selectionStart, selectionEnd);
        const fragment = editor.view.state.schema.cached.domSerializer?.serializeFragment(slice.content, { document: window.document }) || document.createDocumentFragment();
        const tempDiv = document.createElement('div');
        tempDiv.appendChild(fragment.cloneNode(true));
        // Convert <p> tags to newlines (hard returns/paragraphs) - replace closing </p> with newline
        tempDiv.innerHTML = tempDiv.innerHTML.replace(/<\/p>/gi, '\n</p>');
        // Convert <br> tags to newlines (soft returns)
        tempDiv.querySelectorAll('br').forEach(br => {
          br.replaceWith('\n');
        });
        // Get plain text (newlines from both <p> and <br> tags are now preserved)
        const selectedText = tempDiv.textContent || '';
        onSelectionChange(selectedText);
        // Debounce toolbar position update to prevent freezing - increased delay
        setTimeout(() => {
          try {
            if (isSelectionDraggingRef.current) {
              setShowFormattingToolbar(false);
              return;
            }
            updateToolbarPosition();
          } catch (error) {
            console.error("Error updating toolbar position in handleSelectionUpdate:", error);
          }
        }, 100);
      } else {
        // Only clear persistent selection if user clicked directly in editor
        // Don't clear if focus was lost due to clicking input field
        const editorElement = editor.view.dom;
        const activeElement = window.document.activeElement;
        const isInputFocused = activeElement instanceof HTMLTextAreaElement && 
                               activeElement.closest('.compose-bar');
        
        // Only clear if editor has focus (user clicked in editor) and not if input is focused
          updateLastSelectionRange({ from: selectionStart, to: selectionEnd });
        if (window.document.activeElement === editorElement && !isInputFocused) {
          setPersistentSelectionState(null);
          onSelectionChange(null);
          setShowFormattingToolbar(false);
        }
        // If input is focused, keep the persistent selection
      }
    };

    const handleBlur = () => {
      // When editor loses focus, maintain the selection visually
      // The selection state is already stored in persistentSelection
      // Check if there's a current selection and preserve it if input is being focused
      const { from, to } = editor.state.selection;
      if (from !== to) {
        // There's still a selection when blurring - preserve it
        const selectionStart = Math.min(from, to);
        const selectionEnd = Math.max(from, to);
        const normalizedRange = { from: selectionStart, to: selectionEnd };
        const activeElement = window.document.activeElement;
        const isInputFocused = activeElement instanceof HTMLTextAreaElement && 
                               activeElement.closest('.compose-bar');
        
        // If input is being focused, preserve the selection
        if (isInputFocused) {
          updateLastSelectionRange(normalizedRange);
          setPersistentSelectionState(normalizedRange);
          
          // Get selected text and notify parent
          const slice = editor.state.doc.slice(selectionStart, selectionEnd);
          const fragment = editor.view.state.schema.cached.domSerializer?.serializeFragment(slice.content, { document: window.document }) || document.createDocumentFragment();
          const tempDiv = document.createElement('div');
          tempDiv.appendChild(fragment.cloneNode(true));
          tempDiv.innerHTML = tempDiv.innerHTML.replace(/<\/p>/gi, '\n</p>');
          tempDiv.querySelectorAll('br').forEach(br => {
            br.replaceWith('\n');
          });
          const selectedText = tempDiv.textContent || '';
          onSelectionChange(selectedText);
        }
      }
    };
    
    // Add global keyboard shortcut handler - only handle shortcuts when editor is focused
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      try {
        if (!editor) return;
        // Avoid handling if editor is destroyed/unavailable
        if ((editor as any)?.isDestroyed) return;
      } catch {
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) {
        return;
      }
      
      // Only handle shortcuts if the editor is focused or the target is within the editor
      const target = e.target as HTMLElement | null;
      const isEditorFocused =
        Boolean(editor?.isFocused) ||
        Boolean(target && editorContainerRef.current && editorContainerRef.current.contains(target));
      
      // If editor is not focused and target is a text input (like compose bar), let browser handle it
      if (!isEditorFocused) {
        const isTextInput =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          Boolean(target?.isContentEditable);
        
        if (isTextInput) {
          return; // Let browser handle shortcuts in text inputs when editor is not focused
        }
      }
      
      const action =
        SHORTCUT_CODE_MAP[e.code as keyof typeof SHORTCUT_CODE_MAP] ||
        SHORTCUT_KEY_MAP[e.key.toLowerCase() as keyof typeof SHORTCUT_KEY_MAP];
      if (!action) {
        return;
      }

      const persistentRange = persistentSelectionRef.current;
      const lastRange = lastSelectionRef.current;

      if ((action === "copy" || action === "cut") && !persistentRange) {
        return;
      }
      if (action === "paste" && !lastRange) {
        return;
      }

      // If target is not in editor, don't handle (let browser handle it)
      if (target && !(editorContainerRef.current && editorContainerRef.current.contains(target))) {
        return;
      }

      const ensureEditorFocus = () => {
        if (!editor.isFocused) {
          editor.commands.focus();
        }
      };

      if (action === "selectAll") {
        ensureEditorFocus();
        // Explicitly call selectAll to ensure it happens
        editor.commands.selectAll();
        // After TipTap selects all, capture the selection and make it persistent
        // Use setTimeout to let TipTap's selectAll complete first
        setTimeout(() => {
          const { from, to } = editor.state.selection;
          if (from !== to) {
            const selectionStart = Math.min(from, to);
            const selectionEnd = Math.max(from, to);
            const normalizedRange = { from: selectionStart, to: selectionEnd };
            updateLastSelectionRange(normalizedRange);
            setPersistentSelectionState(normalizedRange);
            
            // Also get the selected text and notify parent
            const slice = editor.state.doc.slice(selectionStart, selectionEnd);
            const fragment = editor.view.state.schema.cached.domSerializer?.serializeFragment(slice.content, { document: window.document }) || document.createDocumentFragment();
            const tempDiv = document.createElement('div');
            tempDiv.appendChild(fragment.cloneNode(true));
            tempDiv.innerHTML = tempDiv.innerHTML.replace(/<\/p>/gi, '\n</p>');
            tempDiv.querySelectorAll('br').forEach(br => {
              br.replaceWith('\n');
            });
            const selectedText = tempDiv.textContent || '';
            onSelectionChange(selectedText);
          }
        }, 10);
        // Prevent default to avoid double selection
        e.preventDefault();
        return;
      }

      ensureEditorFocus();

      if ((action === "copy" || action === "cut") && persistentRange) {
        editor.commands.setTextSelection(persistentRange);
      } else if (action === "paste") {
        const rangeToRestore = persistentRange || lastRange;
        if (rangeToRestore) {
          editor.commands.setTextSelection(rangeToRestore);
        }
      }
      // Let the browser perform the actual clipboard operation after we've restored focus/selection
    };
    
    // Intercept copy/cut events to ensure plaintext is copied (without markdown formatting)
    const handleClipboard = (e: ClipboardEvent) => {
      // Only handle clipboard events from the editor
      const target = e.target as Node | null;
      const editorDom = editor.view.dom;
      if (!target || !editorDom.contains(target)) {
        return;
      }

      const { from, to } = editor.state.selection;
      if (from === to) {
        // No selection, let browser handle it
        return;
      }

      // Get plaintext from selection (same logic as getSelectedText)
      const slice = editor.state.doc.slice(from, to);
      const fragment = editor.view.state.schema.cached.domSerializer?.serializeFragment(slice.content, { document: window.document }) || document.createDocumentFragment();
      const tempDiv = document.createElement('div');
      tempDiv.appendChild(fragment.cloneNode(true));
      // Convert <p> tags to newlines (hard returns/paragraphs)
      tempDiv.innerHTML = tempDiv.innerHTML.replace(/<\/p>/gi, '\n</p>');
      // Convert <br> tags to newlines (soft returns)
      tempDiv.querySelectorAll('br').forEach(br => {
        br.replaceWith('\n');
      });
      // Get plain text (newlines from both <p> and <br> tags are preserved)
      const plainText = tempDiv.textContent || '';

      if (plainText) {
        e.preventDefault();
        e.clipboardData?.setData('text/plain', plainText);
        
        // If this is a cut event, delete the selected text
        if (e.type === 'cut') {
          editor.commands.deleteSelection();
        }
      }
    };

    const handlePasteEvent = (e: ClipboardEvent) => {
      const target = e.target as Node | null;
      const editorDom = editor.view.dom;
      if (!target || !editorDom.contains(target)) {
        return;
      }
      const html = e.clipboardData?.getData("text/html");
      if (!html || !/<a[\s>]/i.test(html)) {
        return;
      }
      e.preventDefault();
      const { sanitized } = stripLinksFromHtml(html);
      const fallbackText = e.clipboardData?.getData("text/plain") ?? "";
      const contentToInsert = sanitized || fallbackText;
      if (!contentToInsert) {
        return;
      }
      editor
        .chain()
        .focus()
        .insertContent(contentToInsert)
        .run();
    };
    
    window.document.addEventListener('keydown', handleGlobalKeyDown, true);
    window.document.addEventListener('copy', handleClipboard, true);
    window.document.addEventListener('cut', handleClipboard, true);
    window.document.addEventListener('paste', handlePasteEvent, true);

    editor.on("selectionUpdate", handleSelectionUpdate);
    const editorElement = editor.view.dom as HTMLElement;
    const editorContainer = editorElement.closest('.overflow-auto') as HTMLElement | null;
    
    // Listen on container to catch margin clicks
    if (editorContainer) {
      editorContainer.addEventListener("mousedown", handleMouseDown);
      editorContainer.addEventListener("mousemove", handleMouseMove);
      editorContainer.addEventListener("mouseup", handleMouseUp);
    }
    editorElement.addEventListener("mousedown", handleMouseDown);
    editorElement.addEventListener("mouseup", handleMouseUp);
    editorElement.addEventListener("blur", handleBlur);

    // Update toolbar on scroll (debounced to prevent freezing)
    const scrollContainer = editorElement.closest('.overflow-auto') as HTMLElement | null;
    let scrollTimeout: NodeJS.Timeout | null = null;
    const handleScroll = () => {
      try {
        const { from, to } = editor.state.selection;
        if (from !== to && showFormattingToolbar) {
          if (scrollTimeout) clearTimeout(scrollTimeout);
          scrollTimeout = setTimeout(() => {
            try {
              // Always recalculate toolbar position on scroll to ensure it's not covered
              updateToolbarPosition();
            } catch (error) {
              console.error("Error updating toolbar position on scroll:", error);
            }
          }, 16); // Reduced debounce for smoother updates during scroll
        }
      } catch (error) {
        console.error("Error in scroll handler:", error);
      }
    };
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    }
    // Also listen to window scroll for cases where the page itself scrolls
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
      if (editorContainer) {
        editorContainer.removeEventListener("mousedown", handleMouseDown);
        editorContainer.removeEventListener("mousemove", handleMouseMove);
        editorContainer.removeEventListener("mouseup", handleMouseUp);
      }
      editorElement.removeEventListener("mousedown", handleMouseDown);
      editorElement.removeEventListener("mouseup", handleMouseUp);
      editorElement.removeEventListener("blur", handleBlur);
      window.document.removeEventListener('keydown', handleGlobalKeyDown, true);
      window.document.removeEventListener('copy', handleClipboard, true);
      window.document.removeEventListener('cut', handleClipboard, true);
      window.document.removeEventListener('paste', handlePasteEvent, true);
      scrollContainer?.removeEventListener('scroll', handleScroll);
      window.removeEventListener('scroll', handleScroll);
      if (dragTimeout) clearTimeout(dragTimeout);
      if (scrollTimeout) clearTimeout(scrollTimeout);
    };
  }, [
    editor,
    onSelectionChange,
    setPersistentSelectionState,
    updateLastSelectionRange,
    updateToolbarPosition,
    showFormattingToolbar,
    resolvedMarginLeft,
    resolvedMarginRight
  ]);

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
        // Validate selection positions are within document bounds
        const docSize = editor.state.doc.content.size;
        const validFrom = Math.max(0, Math.min(from, docSize));
        const validTo = Math.max(0, Math.min(to, docSize));
        
        // If selection is invalid or empty, clear overlays and return
        if (validFrom >= validTo || validFrom < 0 || validTo > docSize) {
          return;
        }

        // Get editor container for relative positioning
        const editorElement = editor.view.dom;
        const editorContainer = editorElement.closest('.overflow-auto') || editorElement.parentElement;
        if (!editorContainer) {
          return;
        }
        const containerRect = editorContainer.getBoundingClientRect();
        const containerWidth = containerRect.width;
        const containerLeft = containerRect.left;
        const containerTop = containerRect.top;
        const marginLeft = resolvedMarginLeft;
        const marginRight = resolvedMarginRight;
        const contentLeft = marginLeft;
        const contentRight = containerWidth - marginRight;
        const contentWidth = Math.max(0, contentRight - contentLeft);
        if (contentWidth <= 0) {
          return;
        }

        // Get coordinates for start and end of selection using validated positions
        const startCoords = editor.view.coordsAtPos(validFrom);
        const endCoords = editor.view.coordsAtPos(validTo);

        const selectionTop = Math.min(startCoords.top, endCoords.top);
        const selectionBottom = Math.max(startCoords.bottom ?? startCoords.top, endCoords.bottom ?? endCoords.top);
        const viewportTop = containerRect.top;
        const viewportBottom = containerRect.bottom;
        const renderTop = Math.max(selectionTop, viewportTop);
        const renderBottom = Math.min(selectionBottom, viewportBottom);
        if (renderBottom <= renderTop) {
          return;
        }

        const toRelativeX = (value: number) => {
          const clamped = Math.min(
            Math.max(value, containerLeft + contentLeft),
            containerLeft + contentRight
          );
          return clamped - containerLeft;
        };

        const createOverlay = (left: number, top: number, width: number, height: number) => {
          if (width <= 0 || height <= 0) {
            return;
          }
          const overlay = document.createElement("div");
          overlay.className = "custom-selection-overlay";
          overlay.style.cssText = `
            position: absolute;
            left: ${left}px;
            top: ${top}px;
            width: ${width}px;
            height: ${height}px;
            background-color: #00f;
            pointer-events: none;
            z-index: 0;
          `;
          editorContainer.appendChild(overlay);
          selectionOverlays.push(overlay);
        };

        const isSingleLine = Math.abs(startCoords.top - endCoords.top) < 5;

        if (isSingleLine) {
          const visibleTop = Math.max(startCoords.top, viewportTop);
          const visibleBottom = Math.min(startCoords.bottom ?? startCoords.top, viewportBottom);
          const relativeTop = visibleTop - containerTop;
          const height = Math.max(1, visibleBottom - visibleTop);
          const relativeLeft = toRelativeX(Math.min(startCoords.left, endCoords.left));
          const relativeRight = toRelativeX(
            Math.max(
              typeof startCoords.right === "number" ? startCoords.right : startCoords.left,
              typeof endCoords.right === "number" ? endCoords.right : endCoords.left
            )
          );
          createOverlay(relativeLeft, relativeTop, Math.max(1, relativeRight - relativeLeft), height);
          return;
        }

        const startVisible = (startCoords.bottom ?? startCoords.top) > viewportTop && startCoords.top < viewportBottom;
        const endVisible = (endCoords.bottom ?? endCoords.top) > viewportTop && endCoords.top < viewportBottom;

        let currentTop = renderTop;

        if (startVisible) {
          const visibleStartTop = Math.max(startCoords.top, viewportTop);
          const visibleStartBottom = Math.min(startCoords.bottom ?? startCoords.top, viewportBottom);
          const relativeTop = visibleStartTop - containerTop;
          const height = Math.max(1, visibleStartBottom - visibleStartTop);
          const relativeLeft = toRelativeX(startCoords.left);
          const width = Math.max(1, contentRight - relativeLeft);
          createOverlay(relativeLeft, relativeTop, width, height);
          currentTop = Math.max(currentTop, visibleStartBottom);
        }

        const endBoundaryTop = endVisible ? Math.max(endCoords.top, viewportTop) : renderBottom;
        if (endBoundaryTop - currentTop > 1) {
          const relativeTop = currentTop - containerTop;
          const height = Math.max(1, endBoundaryTop - currentTop);
          createOverlay(
            contentLeft,
            relativeTop,
            Math.max(1, contentRight - contentLeft),
            height
          );
          currentTop = endBoundaryTop;
        }

        if (endVisible) {
          const visibleEndTop = Math.max(endCoords.top, viewportTop);
          const visibleEndBottom = Math.min(endCoords.bottom ?? endCoords.top, viewportBottom);
          if (visibleEndBottom > visibleEndTop) {
            const relativeTop = visibleEndTop - containerTop;
            const height = Math.max(1, visibleEndBottom - visibleEndTop);
            const relativeRight = toRelativeX(endCoords.left);
            createOverlay(
              contentLeft,
              relativeTop,
              Math.max(1, relativeRight - contentLeft),
              height
            );
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

    // Update on window resize (for when sidebar toggles)
    const handleResize = () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      animationFrame = requestAnimationFrame(updateSelectionOverlay);
    };
    window.addEventListener('resize', handleResize);

    // Initial update
    updateSelectionOverlay();

    return () => {
      editor.off("update", handleUpdate);
      scrollContainer?.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      selectionOverlays.forEach(overlay => overlay.remove());
    };
  }, [editor, persistentSelection, resolvedMarginLeft, resolvedMarginRight]);

  // Sync content from parent - convert markdown to HTML for TipTap
  useEffect(() => {
    if (!editor) return;
    
    // Skip if this update came from the editor itself (user typing)
    // Also skip if user was typing recently (within last 200ms) to prevent race conditions
    const timeSinceLastTyping = Date.now() - lastTypingTimeRef.current;
    if (isInternalUpdateRef.current || timeSinceLastTyping < 200) {
      return;
    }
    
    // Convert markdown to HTML for TipTap
    // Use markdown-it to parse markdown syntax like **bold** into HTML
    const markdownContent = content || '';
    
    // Always convert markdown to HTML, even if content appears to be HTML already
    // This ensures markdown syntax like **bold** gets properly rendered
    const html = md.render(markdownContent);
    
    // Get current HTML and text for comparison
    const currentHtml = editor.getHTML();
    const currentText = editor.getText();
    
    // Normalize HTML for comparison (remove extra whitespace/newlines)
    const normalizeHtml = (html: string) => html.replace(/\s+/g, ' ').trim();
    const normalizedHtml = normalizeHtml(html);
    const normalizedCurrentHtml = normalizeHtml(currentHtml);
    
    // Also compare plain text content to catch cases where HTML structure differs
    // but content is the same (e.g., different paragraph wrapping)
    const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim();
    const normalizedText = normalizeText(markdownContent);
    const normalizedCurrentText = normalizeText(currentText);
    
    // Only update if content actually changed (avoid infinite loops)
    // Also check if the raw markdown content changed, not just the HTML
    const lastMarkdown = (editor as any).__lastMarkdownContent;
    const markdownChanged = markdownContent !== lastMarkdown;
    
    // If text content is the same, don't update even if HTML structure differs
    // This prevents unnecessary updates that can cause cursor jumps
    const textContentSame = normalizedText === normalizedCurrentText;
    
    // Handle empty content - always reset if content is empty and editor has content
    if (markdownContent === '') {
      if (currentHtml !== '<p></p>' && normalizedCurrentHtml !== '') {
        editor.commands.setContent('', { emitUpdate: false });
        (editor as any).__lastMarkdownContent = '';
      }
      return;
    }
    
    // Handle non-empty content - update if content changed
    // Only update if both HTML structure AND text content differ (or markdown changed)
    // This prevents unnecessary updates when only HTML structure differs but content is the same
    if ((normalizedHtml !== normalizedCurrentHtml && !textContentSame) || markdownChanged) {
      // Store the markdown content for comparison
      (editor as any).__lastMarkdownContent = markdownContent;
      
      // Preserve cursor position and selection when syncing from parent
      const { from, to } = editor.state.selection;
      const hasSelection = from !== to;
      
      // Store text before cursor and selection BEFORE calling setContent
      // This helps maintain cursor position even if HTML structure changes slightly
      const oldDocSize = editor.state.doc.content.size;
      
      // Get text content with proper line breaks to match positions accurately
      // Use textBetween with '\n' to preserve line structure
      const textBeforeCursor = editor.state.doc.textBetween(0, from, '\n');
      const textAfterCursor = editor.state.doc.textBetween(from, oldDocSize, '\n');
      const selectedText = hasSelection ? editor.state.doc.textBetween(from, to, '\n') : '';
      
      editor.commands.setContent(html, { emitUpdate: false }); // don't emit update event
      
      // Restore cursor position after content update
      // Use text-based position restoration for better accuracy
      try {
        const docSize = editor.state.doc.content.size;
        const fullDocText = editor.state.doc.textBetween(0, docSize, '\n');
        
        if (hasSelection && selectedText) {
          // If there was a selection, try to restore it using text matching
          // Find the selection text in the new document
          const searchText = textBeforeCursor + selectedText;
          const newFromIndex = fullDocText.indexOf(searchText);
          if (newFromIndex !== -1) {
            // Calculate position accurately: cursor is AFTER textBeforeCursor
            const newFrom = newFromIndex + textBeforeCursor.length;
            const newTo = newFrom + selectedText.length;
            if (newTo <= docSize) {
              editor.commands.setTextSelection({ from: newFrom, to: newTo });
              return;
            }
          }
          
          // Fallback to simple position restoration
          const newFrom = Math.min(from, docSize);
          const newTo = Math.min(to, docSize);
          if (newFrom < newTo) {
            editor.commands.setTextSelection({ from: newFrom, to: newTo });
          } else {
            editor.commands.setTextSelection(newFrom);
          }
        } else {
          // For cursor position, use a more accurate method
          // Find the exact position where textBeforeCursor ends and textAfterCursor begins
          let newPos = -1;
          
          if (textBeforeCursor.length > 0) {
            // Search for textBeforeCursor and verify textAfterCursor follows immediately
            // This ensures we find the correct occurrence
            const searchPattern = textBeforeCursor + (textAfterCursor.length > 0 ? textAfterCursor.slice(0, Math.min(50, textAfterCursor.length)) : '');
            const patternIndex = fullDocText.indexOf(searchPattern);
            
            if (patternIndex !== -1) {
              // Found the pattern - cursor is right after textBeforeCursor
              newPos = patternIndex + textBeforeCursor.length;
            } else {
              // Pattern not found, try searching from the end (most likely near cursor)
              // Use lastIndexOf to find the most recent occurrence
              const searchStart = Math.max(0, fullDocText.length - Math.min(200, fullDocText.length));
              const lastIndex = fullDocText.lastIndexOf(textBeforeCursor, searchStart + textBeforeCursor.length);
              
              if (lastIndex !== -1) {
                // Verify textAfterCursor follows (or document ends)
                const verifyStart = lastIndex + textBeforeCursor.length;
                const verifyText = fullDocText.slice(verifyStart, verifyStart + Math.min(textAfterCursor.length || 50, 50));
                
                // If textAfterCursor matches or is empty, this is likely the right position
                if (textAfterCursor.length === 0 || verifyText === textAfterCursor.slice(0, verifyText.length)) {
                  newPos = lastIndex + textBeforeCursor.length;
                }
              }
            }
          }
          
          if (newPos !== -1 && newPos >= 0 && newPos <= docSize) {
            // Found accurate position - cursor is AFTER textBeforeCursor
            editor.commands.setTextSelection(newPos);
          } else {
            // Fallback: try to maintain relative position
            const relativePos = oldDocSize > 0 ? from / oldDocSize : 0;
            const newPosFallback = Math.min(Math.floor(relativePos * docSize), docSize);
            editor.commands.setTextSelection(newPosFallback);
          }
        }
      } catch (error) {
        // If cursor position is invalid, just set to end
        console.error("Error restoring cursor position:", error);
        try {
          const docSize = editor.state.doc.content.size;
          editor.commands.setTextSelection(docSize);
        } catch {
          // Ignore errors in fallback
        }
      }
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
    if (!editor || !onReady) {
      return;
    }
    const editorAny = editor as any;

    const assign = (key: string, value: unknown) => {
      Reflect.set(editorAny, key, value);
    };

    assign("setMarkdown", setMarkdownContent);
    assign("getMarkdown", () => editor.getText());
    assign("insertText", (text: string) => {
      // Convert markdown to HTML before inserting (e.g., **bold** -> <strong>bold</strong>)
      const html = md.render(text);
      editor.commands.insertContent(html, {
        parseOptions: {
          preserveWhitespace: "full"
        }
      });
    });
    assign("replaceSelection", (text: string, selectionRange?: { from: number; to: number }) => {
      const range = selectionRange || editor.state.selection;
      const { from, to } = range;
      editor.commands.setTextSelection({ from, to });
      if (from !== to) {
        editor.commands.deleteSelection();
      }
      // Convert markdown to HTML before inserting (e.g., **bold** -> <strong>bold</strong>)
      const html = md.render(text);
      editor.commands.insertContent(html, {
        parseOptions: {
          preserveWhitespace: "full"
        }
      });
    });
    assign("getSelectionRange", () => {
      const { from, to } = editor.state.selection;
      return { from, to };
    });
    assign("getSelectedText", () => {
      const { from, to } = editor.state.selection;
      // Get HTML to preserve <br> tags from soft returns and <p> tags from hard returns, then convert to text
      const slice = editor.state.doc.slice(from, to);
      const fragment = editor.view.state.schema.cached.domSerializer?.serializeFragment(slice.content, { document: window.document }) || document.createDocumentFragment();
      const tempDiv = document.createElement('div');
      tempDiv.appendChild(fragment.cloneNode(true));
      // Convert <p> tags to newlines (hard returns/paragraphs) - replace closing </p> with newline
      tempDiv.innerHTML = tempDiv.innerHTML.replace(/<\/p>/gi, '\n</p>');
      // Convert <br> tags to newlines (soft returns)
      tempDiv.querySelectorAll('br').forEach(br => {
        br.replaceWith('\n');
      });
      // Get plain text (newlines from both <p> and <br> tags are now preserved)
      return tempDiv.textContent || '';
    });
    assign("getPlainText", () => {
      // Get plaintext from entire editor content (same logic as getSelectedText but for entire document)
      const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
      const fragment = editor.view.state.schema.cached.domSerializer?.serializeFragment(slice.content, { document: window.document }) || document.createDocumentFragment();
      const tempDiv = document.createElement('div');
      tempDiv.appendChild(fragment.cloneNode(true));
      // Convert <p> tags to newlines (hard returns/paragraphs)
      tempDiv.innerHTML = tempDiv.innerHTML.replace(/<\/p>/gi, '\n</p>');
      // Convert <br> tags to newlines (soft returns)
      tempDiv.querySelectorAll('br').forEach(br => {
        br.replaceWith('\n');
      });
      // Get plain text (newlines from both <p> and <br> tags are preserved)
      return tempDiv.textContent || '';
    });

    return () => {
      ["setMarkdown", "getMarkdown", "insertText", "replaceSelection", "getSelectionRange", "getSelectedText", "getPlainText"].forEach(
        (key) => {
          Reflect.deleteProperty(editorAny, key);
        }
      );
    };
  }, [editor, setMarkdownContent, onReady, md]);

  // Formatting button handlers
  const handleFormat = useCallback((command: () => boolean, meta?: { action?: string }) => {
    if (!editor) return false;
    try {
      // Preserve selection before applying formatting
      const { from, to } = editor.state.selection;
      const hasSelection = from !== to;
      
      // Ensure editor has focus before applying formatting
      editor.commands.focus();
      
      // If there's a selection, ensure it's still selected
      if (hasSelection) {
        editor.commands.setTextSelection({ from, to });
      }
      
      const result = command();
      
      // Restore selection after formatting if it was lost
      if (hasSelection) {
        setTimeout(() => {
          try {
            const currentSelection = editor.state.selection;
            if (currentSelection.from === currentSelection.to) {
              // Selection was lost, restore it
              editor.commands.setTextSelection({ from, to });
            }
            updateToolbarPosition();
          } catch (error) {
            console.error("Error updating toolbar after format:", error);
          }
        }, 10);
      } else {
        // Keep toolbar position updated
        setTimeout(() => {
          try {
            updateToolbarPosition();
          } catch (error) {
            console.error("Error updating toolbar after format:", error);
          }
        }, 50);
      }
      
      return result;
    } catch (error) {
      console.error("Error in handleFormat:", error);
      return false;
    }
  }, [editor, updateToolbarPosition]);

  // Handle adding selected text to persona key messaging
  const handleAddToPersona = useCallback(async () => {
    if (!editor || addingToPersona) return;
    
    try {
      const selectedText = (editor as any).getSelectedText?.();
      if (!selectedText || !selectedText.trim()) {
        return;
      }

      setAddingToPersona(true);
      
      const requestBody: { text: string; brandId?: string } = {
        text: selectedText.trim()
      };
      if (activePersonaId) {
        requestBody.brandId = activePersonaId;
      }

      const response = await fetch("/api/persona/key-messaging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to add to persona" }));
        console.error("Failed to add to persona:", {
          error: errorData.error,
          details: errorData.details,
          code: errorData.code,
          fullError: errorData
        });
        // Could show a toast notification here
        return;
      }

      // Success - could show a toast notification here
      // Dispatch a custom event to notify parent components with personaId
      window.dispatchEvent(new CustomEvent("persona-key-messaging-added", { 
        detail: { brandId: activePersonaId } 
      }));
    } catch (error) {
      console.error("Error adding to persona:", error);
    } finally {
      setAddingToPersona(false);
    }
  }, [editor, addingToPersona, activePersonaId]);

  // Don't render editor until ready
  if (!editor) {
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
          className="absolute z-50 flex items-center gap-1 rounded-full border border-brand-stroke/60 px-2 py-1 shadow-lg"
          style={{
            top: `${toolbarPosition.top}px`,
            left: `${toolbarPosition.left}px`,
            transform: `translateY(calc(-100% - ${TOOLBAR_GAP_PX}px))`,
            backgroundColor: '#141414',
          }}
        >
          {/* Bold */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault(); // Prevent losing focus/selection
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleFormat(() => editor.chain().toggleBold().run(), { action: "bold" });
            }}
            className={cn(
              "rounded-full p-2 transition hover:opacity-70",
              editor.isActive('bold') ? "bg-white text-black" : "text-brand-muted"
            )}
            title="Bold"
          >
            <BoldIcon className="h-4 w-4" />
          </button>

          {/* Italic */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault(); // Prevent losing focus/selection
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleFormat(() => editor.chain().toggleItalic().run(), { action: "italic" });
            }}
            className={cn(
              "rounded-full p-2 transition hover:opacity-70",
              editor.isActive('italic') ? "bg-white text-black" : "text-brand-muted"
            )}
            title="Italic"
          >
            <ItalicIcon className="h-4 w-4" />
          </button>

          {/* Strikethrough */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault(); // Prevent losing focus/selection
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleFormat(() => editor.chain().toggleStrike().run(), { action: "strike" });
            }}
            className={cn(
              "rounded-full p-2 transition hover:opacity-70",
              editor.isActive('strike') ? "bg-white text-black" : "text-brand-muted"
            )}
            title="Strikethrough"
          >
            <StrikethroughIcon className="h-4 w-4" />
          </button>

          {/* Divider */}
          <div className="mx-1 h-6 w-px bg-brand-stroke/40" />

          {/* Headings */}
          {[1, 2, 3].map((level) => (
            <button
              key={level}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const isActive = editor.isActive('heading', { level: level as 1 | 2 | 3 });
                if (isActive) {
                  // If already this heading level, toggle it off (convert to paragraph)
                  editor.chain().focus().setParagraph().run();
                } else {
                  // Set to this heading level
                  editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 }).run();
                }
                // Update toolbar position after a delay
                setTimeout(() => {
                  try {
                    updateToolbarPosition();
                  } catch (error) {
                    console.error("Error updating toolbar after heading change:", error);
                  }
                }, 50);
              }}
              className={cn(
                "rounded-full px-2 py-1 text-xs font-semibold transition hover:opacity-70",
                editor.isActive('heading', { level: level as 1 | 2 | 3 }) 
                  ? "bg-white text-black" 
                  : "text-brand-muted"
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
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // If ordered list is active, toggle it off first
              if (editor.isActive('orderedList')) {
                editor.chain().focus().toggleOrderedList().run();
              }
              // Then toggle bullet list
              editor.chain().focus().toggleBulletList().run();
              setTimeout(() => {
                try {
                  updateToolbarPosition();
                } catch (error) {
                  console.error("Error updating toolbar after bullet list:", error);
                }
              }, 50);
            }}
            className={cn(
              "rounded-full p-2 transition hover:opacity-70",
              editor.isActive('bulletList') ? "bg-white text-black" : "text-brand-muted"
            )}
            title="Bullet List"
          >
            <ListBulletIcon className="h-4 w-4" />
          </button>

          {/* Ordered List */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // If bullet list is active, toggle it off first
              if (editor.isActive('bulletList')) {
                editor.chain().focus().toggleBulletList().run();
              }
              // Then toggle ordered list
              editor.chain().focus().toggleOrderedList().run();
              setTimeout(() => {
                try {
                  updateToolbarPosition();
                } catch (error) {
                  console.error("Error updating toolbar after ordered list:", error);
                }
              }, 50);
            }}
            className={cn(
              "rounded-full px-2 py-1 text-xs font-semibold transition hover:opacity-70",
              editor.isActive('orderedList') ? "bg-white text-black" : "text-brand-muted"
            )}
            title="Numbered List"
          >
            123
          </button>

          {/* Divider */}
          <div className="mx-1 h-6 w-px bg-brand-stroke/40" />

          {/* Plus Button */}
          <div className="relative">
            <button
              ref={plusButtonRef}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (plusButtonRef.current) {
                  const buttonRect = plusButtonRef.current.getBoundingClientRect();
                  setPlusMenuPosition({
                    top: buttonRect.top - 8,
                    left: buttonRect.left
                  });
                }
                setShowPlusMenu((prev) => !prev);
              }}
              className="rounded-full bg-brand-blue p-2 text-white transition hover:bg-brand-blue/80"
              title="More options"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Plus Menu Dropdown - Rendered in Portal to avoid clipping */}
      {showPlusMenu && plusMenuPosition && typeof window !== "undefined" && createPortal(
        <div
          ref={plusMenuRef}
          className="fixed z-[60] w-48 rounded-xl border border-brand-stroke/60 bg-brand-panel shadow-[0_20px_60px_rgba(0,0,0,0.45)] overflow-hidden"
          style={{
            top: `${plusMenuPosition.top}px`,
            left: `${plusMenuPosition.left}px`,
            transform: 'translateY(-100%)'
          }}
        >
          {hasPersona && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowPlusMenu(false);
                handleAddToPersona();
              }}
              disabled={addingToPersona}
              className={cn(
                "w-full px-4 py-2.5 text-left text-sm text-white transition hover:bg-white/10",
                addingToPersona && "opacity-60 cursor-not-allowed"
              )}
            >
              {addingToPersona ? "Adding..." : "Add to Persona"}
            </button>
          )}
          {onSaveStyle && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowPlusMenu(false);
                onSaveStyle();
              }}
              className={cn(
                "w-full px-4 py-2.5 text-left text-sm text-white transition hover:bg-white/10",
                hasPersona && "border-t border-brand-stroke/40"
              )}
            >
              Save Writing Style
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

