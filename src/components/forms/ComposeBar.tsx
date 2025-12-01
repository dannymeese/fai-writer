"use client";

import { ArrowUpIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { WrenchIcon } from "@heroicons/react/24/solid";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";

type ComposeBarProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  loading?: boolean;
  onToggleSettings: (anchorRect: DOMRect | null) => void;
  inputRef?: React.RefObject<HTMLTextAreaElement>;
  compact?: boolean;
  hasCustomOptions?: boolean;
  activeStyle?: {
    id: string;
    name: string;
  } | null;
  onClearStyle?: () => void;
  hasSelection?: boolean;
  selectedText?: string | null;
};

export default function ComposeBar({
  value,
  onChange,
  onSubmit,
  disabled,
  loading = false,
  onToggleSettings,
  inputRef,
  compact = false,
  hasCustomOptions = false,
  activeStyle = null,
  onClearStyle,
  hasSelection = false,
  selectedText = null
}: ComposeBarProps) {
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const sendButtonRef = useRef<HTMLButtonElement>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? internalTextareaRef;
  
  const rewriteExamples = useMemo(
    () => [
      "Make it more concise",
      "Add more detail and examples",
      "Change tone to formal",
      "Make it more conversational",
      "Simplify the language"
    ],
    []
  );

  const writeExamples = useMemo(
    () => [
      "Write a blog post about...",
      "Create a product description for...",
      "Draft an email about...",
      "Write a social media post about...",
      "Create content about..."
    ],
    []
  );
  
  const [rewritePlaceholderIndex, setRewritePlaceholderIndex] = useState(0);
  const [writePlaceholderIndex, setWritePlaceholderIndex] = useState(0);
  const [typingChar, setTypingChar] = useState("1");

  useEffect(() => {
    if (hasSelection) {
      const interval = setInterval(() => {
        setRewritePlaceholderIndex((prev) => (prev + 1) % rewriteExamples.length);
      }, 4000);
      return () => clearInterval(interval);
    } else {
      const interval = setInterval(() => {
        setWritePlaceholderIndex((prev) => (prev + 1) % writeExamples.length);
      }, 4000);
      return () => clearInterval(interval);
    }
  }, [hasSelection, rewriteExamples.length, writeExamples.length]);

  // Typing cursor animation when loading
  useEffect(() => {
    if (loading) {
      const interval = setInterval(() => {
        setTypingChar((prev) => (prev === "1" ? "0" : "1"));
      }, 200);
      return () => clearInterval(interval);
    } else {
      setTypingChar("1");
    }
  }, [loading]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const lineHeight = 24;
    const maxHeight = lineHeight * 10;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Set initial height on mount
  useEffect(() => {
    // Send button height is fixed, no need to sync
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const content = (
    <div className="flex w-full flex-col gap-2 mt-[3px]">
      {activeStyle && (
        <div className="inline-flex items-center gap-3 self-start rounded-full border border-white/40 bg-white/5 px-3 py-1 text-xs font-semibold uppercase text-white">
          <span>{activeStyle.name}</span>
          {onClearStyle && (
            <button type="button" onClick={onClearStyle} aria-label="Remove selected style" className="text-white/80 hover:text-white">
              <XMarkIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {hasSelection ? (
        <>
          <p className="text-center text-xl font-semibold text-brand-blue">
            How should I rewrite the selection?
          </p>
          {selectedText && (() => {
            const characters = selectedText.length;
            
            // Word count: split on any whitespace character (spaces, tabs, newlines, etc.)
            // First normalize all whitespace sequences to single spaces, then split
            const normalized = selectedText
              .replace(/[\s\u00A0\u2000-\u200B\u2028\u2029\u3000\uFEFF]+/g, ' ')
              .trim();
            
            const words = normalized 
              ? normalized.split(' ').filter(word => word.length > 0).length 
              : 0;
            
            return (
              <p className="text-center text-sm text-brand-muted/50">
                Selected {characters} character{characters !== 1 ? 's' : ''}, {words} word{words !== 1 ? 's' : ''}
              </p>
            );
          })()}
        </>
      ) : (
        <p className="text-center text-xl font-semibold text-white">
          What should I write?
        </p>
      )}
      <div className="flex w-full items-end gap-1 mt-[6px]">
        <div className={cn(
          "flex flex-1 items-stretch overflow-hidden border bg-brand-ink transition-all",
          "rounded-[24px]",
          hasSelection
            ? "border-brand-blue/60 shadow-[0_0_20px_rgba(59,130,246,0.4)] focus-within:border-brand-blue focus-within:shadow-[0_0_25px_rgba(59,130,246,0.5)]"
            : "border-brand-stroke/80 focus-within:border-brand-blue",
          loading && "shimmer-loading"
        )}>
          <button
            type="button"
            aria-label="Open settings"
            ref={settingsButtonRef}
            onClick={() => onToggleSettings(settingsButtonRef.current?.getBoundingClientRect() ?? null)}
            className={cn(
              "relative flex w-12 items-end justify-center border-r border-brand-stroke/80 text-brand-muted transition hover:text-brand-blue self-stretch pb-3",
              loading && "shimmer-loading"
            )}
          >
            <div className="relative">
              <WrenchIcon className="h-6 w-6" />
              {hasCustomOptions && (
                <span className="absolute -top-[4px] -right-[5px] h-2 w-2 rounded-full bg-[#00f]" />
              )}
            </div>
          </button>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Shift+Enter: allow new line (default behavior)
                if (e.shiftKey && !e.metaKey && !e.ctrlKey) {
                  return;
                }
                // Enter alone, Cmd+Enter, or Ctrl+Enter: submit
                e.preventDefault();
                if (!disabled && value.trim()) {
                  onSubmit();
                }
              }
            }}
            placeholder={hasSelection ? rewriteExamples[rewritePlaceholderIndex] : writeExamples[writePlaceholderIndex]}
            className={cn(
              "flex-1 resize-none border-none bg-transparent px-4 py-3 text-base text-brand-text placeholder:text-brand-muted placeholder:opacity-30 focus:outline-none",
              loading && "shimmer-loading"
            )}
            rows={1}
          />
        </div>
        <button
          type="button"
          ref={sendButtonRef}
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          className={cn(
            "flex min-w-[120px] items-center justify-center rounded-full bg-white px-4 py-2 text-black transition hover:bg-gray-100 h-12",
            {
              "opacity-60": disabled || !value.trim(),
              "shimmer-loading": loading
            }
          )}
        >
          {loading ? (
            <span className="text-2xl font-mono text-black">{typingChar}</span>
          ) : (
            <ArrowUpIcon className="h-8 w-8 stroke-[3] text-black" />
          )}
        </button>
      </div>
    </div>
  );

  if (compact) {
    return <div className="w-full">{content}</div>;
  }

  return (
    <div className="compose-bar rounded-[32px] border border-brand-stroke/60 bg-[#0a0a0a]/90 backdrop-blur-[10px] p-3">
      {content}
    </div>
  );
}

