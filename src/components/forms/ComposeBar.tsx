"use client";

import { ArrowUpIcon } from "@heroicons/react/24/outline";
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
};

export default function ComposeBar({
  value,
  onChange,
  onSubmit,
  disabled,
  onToggleSettings,
  inputRef,
  compact = false
}: ComposeBarProps) {
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? internalTextareaRef;
  const placeholderExamples = useMemo(
    () => [
      "Draft a VC pitch for an organic dog food brand.",
      "Rewrite the retention email below for premium spa guests:",
      "Draft a college admissions essay about robotics.",
      "Outline a medical paper on gene therapies.",
      "Compose a heartfelt toast for a founder's retirement gala.",
      "I need a keynote opener for a sustainability summit.",
      "Turn these bullet points into a press release for a launch:",
      "Explain quantum computing to luxury retail executives.",
      "Revise a product update note for boutique hotel partners."
    ],
    []
  );
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % placeholderExamples.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [placeholderExamples.length]);

  useEffect(() => {
    const textarea = textareaRef.current;
    const button = settingsButtonRef.current;
    if (!textarea) return;
    const lineHeight = 24;
    const maxHeight = lineHeight * 10;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    
    // Sync button height with textarea height
    if (button) {
      button.style.height = `${nextHeight}px`;
    }
  }, [value]);

  // Set initial height on mount
  useEffect(() => {
    const textarea = textareaRef.current;
    const button = settingsButtonRef.current;
    if (textarea && button) {
      const height = textarea.offsetHeight || 48; // fallback to 48px (h-12)
      button.style.height = `${height}px`;
    }
  }, []);

  const content = (
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-full items-stretch gap-1">
        <button
          type="button"
          aria-label="Open settings"
          ref={settingsButtonRef}
          onClick={() => onToggleSettings(settingsButtonRef.current?.getBoundingClientRect() ?? null)}
          className="flex w-12 items-center justify-center rounded-l-full border-l border-t border-b border-brand-stroke/80 bg-brand-ink text-brand-muted transition hover:text-brand-blue"
        >
          <WrenchIcon className="h-6 w-6" />
        </button>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholderExamples[placeholderIndex]}
          className="flex-1 resize-none rounded-r-full rounded-l-none border-r border-t border-b border-brand-stroke/80 bg-brand-ink px-4 py-3 text-base text-brand-text placeholder:text-brand-muted placeholder:opacity-30 focus:border-brand-blue focus:outline-none"
          rows={1}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          className={cn(
            "flex min-w-[120px] items-center justify-center self-end rounded-full bg-white px-4 text-black transition hover:bg-gray-100",
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
    <div className="fixed bottom-0 left-0 right-0 border-t border-brand-stroke/60 bg-brand-panel/90 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-5xl px-4 py-4">{content}</div>
    </div>
  );
}

