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
};

export default function ComposeBar({
  value,
  onChange,
  onSubmit,
  disabled,
  onToggleSettings,
  inputRef,
  compact = false,
  hasCustomOptions = false,
  activeStyle = null,
  onClearStyle,
  hasSelection = false
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
  
  const [rewritePlaceholderIndex, setRewritePlaceholderIndex] = useState(0);

  useEffect(() => {
    if (hasSelection) {
      const interval = setInterval(() => {
        setRewritePlaceholderIndex((prev) => (prev + 1) % rewriteExamples.length);
      }, 4000);
      return () => clearInterval(interval);
    }
  }, [hasSelection, rewriteExamples.length]);

  useEffect(() => {
    const textarea = textareaRef.current;
    const sendButton = sendButtonRef.current;
    if (!textarea) return;
    const lineHeight = 24;
    const maxHeight = lineHeight * 10;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    
    // Sync send button height with textarea height
    if (sendButton) {
      sendButton.style.height = `${nextHeight}px`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Set initial height on mount
  useEffect(() => {
    const textarea = textareaRef.current;
    const sendButton = sendButtonRef.current;
    if (textarea && sendButton) {
      const height = textarea.offsetHeight || 48; // fallback to 48px (h-12)
      sendButton.style.height = `${height}px`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const content = (
    <div className="flex w-full flex-col gap-2">
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
        <p className="text-center text-xl font-semibold text-brand-blue">
          How should I rewrite the selection?
        </p>
      ) : (
        <p className="text-center text-xl font-semibold text-white">
          What should I write?
        </p>
      )}
      <div className="flex w-full items-stretch gap-1">
        <div className={cn(
          "flex flex-1 items-stretch overflow-hidden rounded-full border bg-brand-ink transition-all",
          hasSelection
            ? "border-brand-blue/60 shadow-[0_0_20px_rgba(59,130,246,0.4)] focus-within:border-brand-blue focus-within:shadow-[0_0_25px_rgba(59,130,246,0.5)]"
            : "border-brand-stroke/80 focus-within:border-brand-blue"
        )}>
          <button
            type="button"
            aria-label="Open settings"
            ref={settingsButtonRef}
            onClick={() => onToggleSettings(settingsButtonRef.current?.getBoundingClientRect() ?? null)}
            className="relative flex w-12 items-center justify-center border-r border-brand-stroke/80 text-brand-muted transition hover:text-brand-blue"
          >
            <WrenchIcon className="h-6 w-6" />
            {hasCustomOptions && (
              <span className="absolute top-1 right-1 h-1 w-1 rounded-full bg-[#00f]" />
            )}
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
            placeholder={hasSelection ? rewriteExamples[rewritePlaceholderIndex] : ""}
            className="flex-1 resize-none border-none bg-transparent px-4 py-3 text-base text-brand-text placeholder:text-brand-muted placeholder:opacity-30 focus:outline-none"
            rows={1}
          />
        </div>
        <button
          type="button"
          ref={sendButtonRef}
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          className={cn(
            "flex min-w-[120px] items-center justify-center rounded-full bg-white px-4 text-black transition hover:bg-gray-100",
            {
              "opacity-60": disabled || !value.trim()
            }
          )}
        >
          <ArrowUpIcon className="h-8 w-8 stroke-[3] text-black" />
        </button>
      </div>
    </div>
  );

  if (compact) {
    return <div className="w-full">{content}</div>;
  }

  return (
    <div className="compose-bar fixed bottom-0 left-0 right-0 border-t border-brand-stroke/60 bg-brand-panel/90 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-5xl px-4 py-4">{content}</div>
    </div>
  );
}

