"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import MarkdownEditor from "./MarkdownEditor";
import { cn, generateDownloadFilename } from "@/lib/utils";
import MarkdownIt from "markdown-it";
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
  onTogglePin?: () => void;
  onRequestAddToFolder?: () => void;
  canOrganizeDocuments?: boolean;
  documentPinned?: boolean;
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
  onTogglePin,
  onRequestAddToFolder,
  canOrganizeDocuments = false,
  documentPinned = false
}: DocumentEditorProps) {
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [pendingDownload, setPendingDownload] = useState<"docx" | "txt" | "pdf" | null>(null);
  const [downloadMenuPosition, setDownloadMenuPosition] = useState<{ left: number; top: number; height: number; isSticky?: boolean } | null>(null);
  const copyButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(() => document?.title ?? "");
  const [isTitleSticky, setIsTitleSticky] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [downloadStatus, setDownloadStatus] = useState<"idle" | "loading" | "success">("idle");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  const [documentMenuOpen, setDocumentMenuOpen] = useState(false);
  const [documentMenuPosition, setDocumentMenuPosition] = useState<{ left: number; top: number; height: number; variant: "default" | "sticky" } | null>(null);
  const documentMenuRef = useRef<HTMLDivElement>(null);
  const documentMenuOpenRef = useRef(documentMenuOpen);
  const documentMenuVariantRef = useRef<"default" | "sticky" | null>(null);

  const resolvedHorizontalPadding = {
    left: horizontalPadding?.left ?? 180,
    right: horizontalPadding?.right ?? 180
  };
  const documentActionsAvailable = Boolean(onTogglePin || onRequestAddToFolder);
  const hasContent = useMemo(() => {
    return !!(document?.content?.trim());
  }, [document?.content]);

  const sharedHorizontalPaddingStyle = {
    paddingLeft: resolvedHorizontalPadding.left,
    paddingRight: resolvedHorizontalPadding.right
  };
  const resolvedBottomPadding = Math.max(resolvedHorizontalPadding.left, resolvedHorizontalPadding.right);

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
    
    const isUntitled = !title || title.trim() === "" || title.toLowerCase() === "untitled doc" || title.toLowerCase() === "untitled document";
    const filename = generateDownloadFilename(title, content, format);

    if (format === "pdf") {
      // Generate PDF client-side with markdown parsing
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 20;
      const maxWidth = pageWidth - 2 * margin;
      
      // Parse markdown
      // Preprocess strikethrough: convert ~~text~~ to <s>text</s> for markdown-it parsing
      const preprocessedContent = content.replace(/~~([^~]+)~~/g, '<s>$1</s>');
      
      const md = new MarkdownIt({ html: true }); // Enable HTML parsing for <s> tags
      const tokens = md.parse(preprocessedContent, {});
      
      // Helper to extract plain text from tokens
      const getTextFromTokens = (tokens: any[]): string => {
        let text = "";
        for (const token of tokens) {
          if (token.type === "text") {
            text += token.content;
          } else if (token.children) {
            text += getTextFromTokens(token.children);
          }
        }
        return text;
      };
      
      // Add title only if not untitled (strip markdown from title)
      let yPosition = margin;
      if (!isUntitled) {
        const plainTitle = markdownToPlainText(title);
        pdf.setFontSize(18);
        pdf.setFont("helvetica", "bold");
        const titleLines = pdf.splitTextToSize(plainTitle, maxWidth);
        pdf.text(titleLines, margin, margin + 10);
        yPosition = margin + 20;
      }
      
      // Process markdown tokens and render with formatting
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "normal");
      
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        
        if (yPosition > pdf.internal.pageSize.getHeight() - margin - 10) {
          pdf.addPage();
          yPosition = margin;
        }
        
        if (token.type === "heading_open") {
          const level = parseInt(token.tag.substring(1));
          i++; // Skip to content
          const headingText = getTextFromTokens(tokens[i].children || []);
          i++; // Skip content
          i++; // Skip closing tag
          
          // Set heading font size based on level
          const headingSizes = [20, 18, 16, 14, 12, 12];
          pdf.setFontSize(headingSizes[Math.min(level - 1, 5)]);
          pdf.setFont("helvetica", "bold");
          
          const headingLines = pdf.splitTextToSize(headingText, maxWidth);
          headingLines.forEach((line: string) => {
            if (yPosition > pdf.internal.pageSize.getHeight() - margin - 10) {
              pdf.addPage();
              yPosition = margin;
            }
            pdf.text(line, margin, yPosition);
            yPosition += 8;
          });
          yPosition += 5; // Extra spacing after heading
          pdf.setFontSize(12);
          pdf.setFont("helvetica", "normal");
        } else if (token.type === "paragraph_open") {
          i++; // Skip to content
          const paraTokens = tokens[i].children || [];
          
          // Process paragraph with inline formatting - render segments as we go
          let currentText = "";
          let isBold = false;
          let isItalic = false;
          let isStrike = false;
          let currentX = margin;
          let currentY = yPosition;
          
          // Helper to render accumulated text with current formatting
          const renderTextSegment = (text: string, bold: boolean, italic: boolean, strike: boolean) => {
            if (!text.trim()) return;
            
            pdf.setFont("helvetica", bold ? "bold" : italic ? "italic" : "normal");
            const textWidth = pdf.getTextWidth(text);
            const lines = pdf.splitTextToSize(text, maxWidth - (currentX - margin));
            
            lines.forEach((line: string, lineIndex: number) => {
              if (currentY > pdf.internal.pageSize.getHeight() - margin - 10) {
                pdf.addPage();
                currentY = margin;
                currentX = margin;
              }
              
              const lineWidth = pdf.getTextWidth(line);
              pdf.text(line, currentX, currentY);
              
              // Draw strikethrough line if needed
              if (strike) {
                const lineHeight = 7;
                const strikeY = currentY - (lineHeight * 0.3); // Position line through middle of text
                pdf.setDrawColor(0, 0, 0);
                pdf.setLineWidth(0.5);
                pdf.line(currentX, strikeY, currentX + lineWidth, strikeY);
              }
              
              if (lineIndex < lines.length - 1) {
                currentY += 7;
                currentX = margin;
              } else {
                currentX += lineWidth;
              }
            });
          };
          
          for (const paraToken of paraTokens) {
            if (paraToken.type === "text") {
              currentText += paraToken.content;
            } else if (paraToken.type === "strong_open") {
              if (currentText) {
                renderTextSegment(currentText, isBold, isItalic, isStrike);
                currentText = "";
              }
              isBold = true;
            } else if (paraToken.type === "strong_close") {
              if (currentText) {
                renderTextSegment(currentText, isBold, isItalic, isStrike);
                currentText = "";
              }
              isBold = false;
            } else if (paraToken.type === "em_open") {
              if (currentText) {
                renderTextSegment(currentText, isBold, isItalic, isStrike);
                currentText = "";
              }
              isItalic = true;
            } else if (paraToken.type === "em_close") {
              if (currentText) {
                renderTextSegment(currentText, isBold, isItalic, isStrike);
                currentText = "";
              }
              isItalic = false;
            } else if (paraToken.type === "s_open" || paraToken.type === "del_open") {
              if (currentText) {
                renderTextSegment(currentText, isBold, isItalic, isStrike);
                currentText = "";
              }
              isStrike = true;
            } else if (paraToken.type === "s_close" || paraToken.type === "del_close") {
              if (currentText) {
                renderTextSegment(currentText, isBold, isItalic, isStrike);
                currentText = "";
              }
              isStrike = false;
            } else if (paraToken.type === "html_inline") {
              // Handle HTML tags like <s>text</s> or <del>text</del>
              const htmlContent = paraToken.content || "";
              if (htmlContent.match(/^<s[>\s]|^<del[>\s]/i)) {
                // Opening strikethrough tag
                if (currentText) {
                  renderTextSegment(currentText, isBold, isItalic, isStrike);
                  currentText = "";
                }
                isStrike = true;
              } else if (htmlContent.match(/^<\/s>|^<\/del>/i)) {
                // Closing strikethrough tag
                if (currentText) {
                  renderTextSegment(currentText, isBold, isItalic, isStrike);
                  currentText = "";
                }
                isStrike = false;
              } else {
                // Extract text from HTML tag
                const textMatch = htmlContent.match(/>([^<]+)</);
                if (textMatch) {
                  currentText += textMatch[1];
                }
              }
            } else if (paraToken.children) {
              currentText += getTextFromTokens(paraToken.children);
            }
          }
          
          // Render any remaining text
          if (currentText.trim()) {
            renderTextSegment(currentText, isBold, isItalic, isStrike);
          }
          
          // Update yPosition and reset formatting
          yPosition = currentY + 7;
          pdf.setFont("helvetica", "normal");
          
          i++; // Skip content token
          i++; // Skip closing tag
        } else if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
          const isOrdered = token.type === "ordered_list_open";
          let listIndex = 1;
          i++; // Process list items
          
          while (i < tokens.length && tokens[i].type !== (isOrdered ? "ordered_list_close" : "bullet_list_close")) {
            if (tokens[i].type === "list_item_open") {
              i++; // Skip list_item_open
              
              // List items may contain paragraph_open, so we need to extract text from all children
              let itemText = "";
              while (i < tokens.length && tokens[i].type !== "list_item_close") {
                if (tokens[i].type === "paragraph_open") {
                  i++; // Skip paragraph_open
                  // Extract text from paragraph content
                  if (tokens[i] && tokens[i].children) {
                    itemText += getTextFromTokens(tokens[i].children);
                  }
                  i++; // Skip paragraph content token
                  i++; // Skip paragraph_close
                } else if (tokens[i].type === "text") {
                  itemText += tokens[i].content || "";
                  i++;
                } else if (tokens[i].children) {
                  itemText += getTextFromTokens(tokens[i].children);
                  i++;
                } else {
                  i++;
                }
              }
              i++; // Skip list_item_close
              
              const prefix = isOrdered ? `${listIndex}. ` : "• ";
              const prefixWidth = pdf.getTextWidth(prefix);
              const indentWidth = prefixWidth + 5; // Add small gap after bullet
              
              // Split only the item text (without prefix) to get proper wrapping
              const itemLines = pdf.splitTextToSize(itemText, maxWidth - indentWidth);
              
              itemLines.forEach((line: string, lineIndex: number) => {
                if (yPosition > pdf.internal.pageSize.getHeight() - margin - 10) {
                  pdf.addPage();
                  yPosition = margin;
                }
                
                // First line includes the bullet prefix, subsequent lines are indented
                if (lineIndex === 0) {
                  pdf.text(prefix + line, margin + 10, yPosition);
                } else {
                  pdf.text(line, margin + 10 + indentWidth, yPosition);
                }
                yPosition += 7;
              });
              
              if (isOrdered) listIndex++;
            } else {
              i++;
            }
          }
          i++; // Skip closing tag
        } else if (token.type === "blockquote_open") {
          i++; // Skip to content
          const quoteText = getTextFromTokens(tokens[i].children || []);
          i++; // Skip content
          i++; // Skip closing tag
          
          pdf.setFont("helvetica", "italic");
          const quoteLines = pdf.splitTextToSize(quoteText, maxWidth - 20);
          quoteLines.forEach((line: string) => {
            if (yPosition > pdf.internal.pageSize.getHeight() - margin - 10) {
              pdf.addPage();
              yPosition = margin;
            }
            pdf.text(line, margin + 10, yPosition);
            yPosition += 7;
          });
          pdf.setFont("helvetica", "normal");
        } else if (token.type === "code_block" || token.type === "fence") {
          const codeText = token.content || "";
          pdf.setFont("courier", "normal");
          const codeLines = pdf.splitTextToSize(codeText, maxWidth);
          codeLines.forEach((line: string) => {
            if (yPosition > pdf.internal.pageSize.getHeight() - margin - 10) {
              pdf.addPage();
              yPosition = margin;
            }
            pdf.text(line, margin, yPosition);
            yPosition += 7;
          });
          pdf.setFont("helvetica", "normal");
          i++;
        } else {
          i++;
        }
      }
      
      pdf.save(filename);
      return;
    }

    if (format === "txt") {
      // Strip markdown formatting for plain text
      const plainContent = markdownToPlainText(content);
      const textContent = isUntitled ? plainContent : `${markdownToPlainText(title)}\n\n${plainContent}`;
      const blob = new Blob([textContent], { type: "text/plain" });
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = filename;
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
      link.download = filename;
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
          title: isUntitled ? "Untitled Document" : title,
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
      link.download = filename;
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

    // Set loading state
    setDownloadStatus("loading");
    window.dispatchEvent(new CustomEvent("close-download-menu"));
    
    // Perform download with the content
    await performDownloadWithContent(format, contentToDownload, titleToUse);
    setDownloadStatus("success");
  }, [document, performDownloadWithContent]);

  async function handleConfirmDownload() {
    if (pendingDownload) {
      setDownloadStatus("loading");
      await performDownload(pendingDownload);
      setDownloadStatus("success");
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
      // Don't select all - allow normal cursor positioning
      const length = titleInputRef.current?.value.length || 0;
      titleInputRef.current?.setSelectionRange(length, length);
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
  }, [titleValue, document, onTitleChange]);

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
  }, [document]);

  // Update title value when document changes (but not while editing)
  useEffect(() => {
    if (!isEditingTitle) {
      const newTitle = document?.title ?? "";
      if (newTitle === titleValue) {
        return;
      }
      const timeout = window.setTimeout(() => {
        setTitleValue(newTitle);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
  }, [document?.id, document?.title, isEditingTitle, titleValue]);

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
      let plainText = "";
      if (document) {
        // Get markdown content and convert to plaintext
        const markdownContent = resolveOutputContent(document);
        plainText = markdownToPlainText(markdownContent);
      } else if (editorRef.current) {
        const editor = editorRef.current as any;
        // Get plaintext directly from editor (without markdown formatting)
        if (typeof editor.getPlainText === "function") {
          plainText = editor.getPlainText();
        } else if (typeof editor.getSelectedText === "function") {
          // Fallback: get selected text if available, otherwise get all text
          const { from, to } = editor.getSelectionRange?.() || { from: 0, to: 0 };
          if (from !== to) {
            plainText = editor.getSelectedText();
          } else {
            plainText = editor.getText?.() || "";
          }
        } else if (typeof editor.getText === "function") {
          plainText = editor.getText();
        }
      }

      if (!plainText || !plainText.trim()) {
        console.warn("copy document skipped: no content");
        return;
      }
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(plainText.trim());
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

  useEffect(() => {
    if (downloadStatus === "idle") return;
    const timeout = window.setTimeout(() => setDownloadStatus("idle"), 2000);
    return () => window.clearTimeout(timeout);
  }, [downloadStatus]);

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

  const closeDocumentMenu = useCallback(() => {
    setDocumentMenuOpen(false);
    documentMenuVariantRef.current = null;
  }, []);

  const handleDocumentMenuToggle = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, variant: "default" | "sticky") => {
      if (!documentActionsAvailable) {
        return;
      }
      event.stopPropagation();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      if (documentMenuOpen && documentMenuVariantRef.current === variant) {
        closeDocumentMenu();
        return;
      }
      documentMenuVariantRef.current = variant;
      setDocumentMenuPosition({
        left: rect.left + rect.width / 2,
        top: rect.top,
        height: rect.height,
        variant
      });
      setDocumentMenuOpen(true);
    },
    [closeDocumentMenu, documentActionsAvailable, documentMenuOpen]
  );

  const handleDocumentMenuAction = useCallback(
    (action?: () => void) => {
      if (!action) {
        return;
      }
      closeDocumentMenu();
      action();
    },
    [closeDocumentMenu]
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (documentMenuRef.current && !documentMenuRef.current.contains(event.target as Node)) {
        closeDocumentMenu();
      }
    }
    if (documentMenuOpen) {
      window.document.addEventListener("mousedown", handleClickOutside);
      return () => window.document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [closeDocumentMenu, documentMenuOpen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDocumentMenu();
      }
    }
    if (documentMenuOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [closeDocumentMenu, documentMenuOpen]);

  useEffect(() => {
    documentMenuOpenRef.current = documentMenuOpen;
  }, [documentMenuOpen]);

  useEffect(() => {
    if (!documentMenuOpenRef.current) {
      return;
    }
    const timeout = window.setTimeout(() => {
      closeDocumentMenu();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [closeDocumentMenu, document?.id, documentActionsAvailable]);

  const downloadMenu =
    showDownloadMenu && downloadMenuPosition && typeof window !== "undefined" && !!window.document?.body
      ? createPortal(
          <div
            ref={downloadMenuRef}
            className="fixed z-[1000] w-56 rounded-2xl border border-brand-stroke/60 bg-brand-panel/95 p-2 text-left shadow-[0_25px_80px_rgba(0,0,0,0.65)]"
            style={{
              left: downloadMenuPosition.left,
              top: downloadMenuPosition.isSticky 
                ? downloadMenuPosition.top + downloadMenuPosition.height + 12
                : downloadMenuPosition.top + downloadMenuPosition.height + window.scrollY + 12,
              transform: "translateX(-50%)"
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
          window.document.body
        )
      : null;

  const documentMenu =
    documentMenuOpen &&
    documentMenuPosition &&
    typeof window !== "undefined" &&
    !!window.document?.body &&
    documentActionsAvailable
      ? createPortal(
          <div
            ref={documentMenuRef}
            className="fixed z-[1000] w-64 rounded-2xl border border-brand-stroke/60 bg-brand-panel/95 p-2 text-left shadow-[0_25px_80px_rgba(0,0,0,0.65)]"
            style={{
              left: documentMenuPosition.left,
              top:
                documentMenuPosition.variant === "sticky"
                  ? documentMenuPosition.top + documentMenuPosition.height + 12
                  : documentMenuPosition.top + documentMenuPosition.height + window.scrollY + 12,
              transform: "translateX(-50%)"
            }}
          >
            {onTogglePin && (
              <button
                type="button"
                onClick={() => handleDocumentMenuAction(onTogglePin)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-white transition hover:bg-white/10"
              >
                <span className="material-symbols-outlined text-base leading-none">
                  {documentPinned ? "push_pin" : "push_pin"}
                </span>
                <div>
                  <p className="font-semibold">{documentPinned ? "Unpin Document" : "Pin Document"}</p>
                  <p className="text-xs text-white/60">Keep this doc at the top</p>
                </div>
              </button>
            )}
            {onRequestAddToFolder && (
              <button
                type="button"
                onClick={() => handleDocumentMenuAction(onRequestAddToFolder)}
                className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-white transition hover:bg-white/10"
              >
                <span className="material-symbols-outlined text-base leading-none">drive_folder_upload</span>
                <div>
                  <p className="font-semibold">Add to Folder</p>
                  <p className="text-xs text-white/60">Organize this doc</p>
                </div>
              </button>
            )}
          </div>,
          window.document.body
        )
      : null;

  return (
    <div className={cn("relative flex h-full flex-col", className)}>
      {/* Sticky Title Bar - appears when title scrolls out of view */}
      <div
        data-document-sticky-title
        className={cn(
          "sticky top-[60px] w-full transition-all duration-300 ease-in-out",
          isTitleSticky
            ? "translate-y-0 opacity-100"
            : "-translate-y-full opacity-0 pointer-events-none"
        )}
        style={{ zIndex: 1100 }}
      >
        <div
          onClick={() => {
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="w-full py-1 bg-brand-background/60 backdrop-blur-[10px] cursor-pointer"
        >
          <div className="flex w-full items-center justify-between gap-4">
            <div className="flex-1">
              <div className="max-w-[680px]">
                <h1 className="font-semibold text-white/50" style={{ fontSize: '12px' }}>
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
                downloadStatus={downloadStatus}
                onToggleDownload={handleDownloadButtonClick}
                hasContent={hasContent}
                onToggleDocumentMenu={documentActionsAvailable ? handleDocumentMenuToggle : undefined}
                menuVariant="sticky"
                documentActionsAvailable={documentActionsAvailable}
                documentPinned={documentPinned}
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
      <div 
        ref={titleRef} 
        className={cn(
          "mb-[22.5px] transition-opacity",
          isTitleSticky 
            ? "opacity-0 pointer-events-none duration-0" 
            : "opacity-100 duration-300 delay-300"
        )}
      >
        <div className="flex w-full items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="max-w-[680px]">
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={handleTitleKeyDown}
              className="w-full bg-transparent text-base leading-[32px] font-semibold text-white outline-none placeholder:text-white/50"
              style={{ fontSize: '16px' }}
              placeholder="Untitled doc"
            />
        ) : (
          <h1
            onClick={handleTitleClick}
            className="cursor-text font-semibold text-white/50 hover:text-white/70 transition-colors"
            style={{ fontSize: '16px', lineHeight: '32px' }}
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
              downloadStatus={downloadStatus}
              onToggleDownload={handleDownloadButtonClick}
              hasContent={hasContent}
            onToggleDocumentMenu={documentActionsAvailable ? handleDocumentMenuToggle : undefined}
            menuVariant="default"
            documentActionsAvailable={documentActionsAvailable}
            documentPinned={documentPinned}
            />
          </div>
        </div>
      </div>

      {/* Editor Container - 7px corner radius and standard doc margins */}
      <div className="relative flex-1 overflow-auto rounded-[7px] border border-brand-stroke/60 bg-brand-panel/50 shadow-[0_25px_80px_rgba(0,0,0,0.35)]">
        <div
          className="py-[90px]"
          style={{
            ...sharedHorizontalPaddingStyle,
            paddingBottom: resolvedBottomPadding
          }}
        >
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
                key={displayDocument.id}
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
      {documentMenu}
    </div>
  );
}

function CopyConfirmationTooltip({ buttonRef }: { buttonRef: React.RefObject<HTMLButtonElement> }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        left: rect.left + rect.width / 2,
        top: rect.top - 8
      });
    }
  }, [buttonRef]);

  if (!position) return null;

  return (
    <div 
      className="fixed whitespace-nowrap pointer-events-none"
      style={{ 
        fontSize: '12px',
        fontWeight: 'bold',
        color: '#00f',
        zIndex: 9999,
        left: `${position.left}px`,
        top: `${position.top}px`,
        transform: 'translate(-50%, -100%)'
      }}
    >
      Copied to Clipboard
    </div>
  );
}

type TitleActionButtonsProps = {
  compact?: boolean;
  onCopy: () => void;
  copyStatus?: "idle" | "copied" | "error";
  downloadStatus?: "idle" | "loading" | "success";
  onToggleDownload?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  hasContent?: boolean;
  onToggleDocumentMenu?: (event: React.MouseEvent<HTMLButtonElement>, variant: "default" | "sticky") => void;
  menuVariant?: "default" | "sticky";
  documentActionsAvailable?: boolean;
  documentPinned?: boolean;
};

function TitleActionButtons({
  compact = false,
  onCopy,
  copyStatus = "idle",
  downloadStatus = "idle",
  onToggleDownload,
  hasContent = true,
  onToggleDocumentMenu,
  menuVariant = "default",
  documentActionsAvailable = false,
  documentPinned = false
}: TitleActionButtonsProps) {
  const copyButtonRef = useRef<HTMLButtonElement | null>(null);
  const baseButtonClass = cn(
    "rounded-full border border-brand-stroke/60 bg-brand-ink/40 text-brand-text transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/60 flex items-center justify-center relative",
    compact ? "h-9 w-9 text-base" : "h-11 w-11 text-xl",
    hasContent
      ? "hover:border-brand-blue hover:text-brand-blue"
      : "opacity-[0.33] cursor-not-allowed"
  );

  const handleCopyClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onCopy();
  };

  const showDocumentMenuButton = documentActionsAvailable && Boolean(onToggleDocumentMenu);
  const documentMenuDisabled = !hasContent;

  return (
    <div className="flex items-center gap-2">
      {showDocumentMenuButton && (
        <button
          type="button"
          className={cn(
            "transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/60",
            compact ? "text-lg" : "text-xl",
            documentMenuDisabled
              ? "text-white/30 cursor-not-allowed opacity-60"
              : "text-white/60 hover:text-white"
          )}
          aria-label="Document options"
          disabled={documentMenuDisabled}
          onClick={(event) => {
            if (documentMenuDisabled) {
              return;
            }
            onToggleDocumentMenu?.(event, menuVariant);
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <span className="material-symbols-outlined leading-none">
            {documentPinned ? "more_horiz" : "more_horiz"}
          </span>
        </button>
      )}
      <div className="relative">
        <button
          type="button"
          className={cn(
            baseButtonClass,
            downloadStatus === "loading" && "animate-pulse"
          )}
          aria-haspopup="menu"
          aria-label="Download document"
          title="Download document"
          disabled={!hasContent || downloadStatus === "loading"}
          onClick={(event) => {
            if (hasContent && downloadStatus !== "loading") {
              onToggleDownload?.(event);
            }
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {downloadStatus === "success" ? (
            <span className="material-symbols-outlined leading-none">check</span>
          ) : (
            <span className="material-symbols-outlined leading-none">download</span>
          )}
        </button>
      </div>
      <div className="relative">
        <button
          ref={copyButtonRef}
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
            <span className="material-symbols-outlined leading-none">check</span>
          ) : (
            <span className="material-symbols-outlined leading-none">content_copy</span>
          )}
        </button>
        {copyStatus === "copied" && typeof window !== "undefined" && createPortal(
          <CopyConfirmationTooltip buttonRef={copyButtonRef} />,
          document.body
        )}
      </div>
    </div>
  );
}

