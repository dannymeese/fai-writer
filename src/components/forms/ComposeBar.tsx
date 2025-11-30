"use client";

import { ArrowUpIcon, WrenchIcon } from "@heroicons/react/24/solid";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

type ComposeBarProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  onToggleSettings: (anchorRect: DOMRect | null) => void;
  showPromptLabel?: boolean;
};

export default function ComposeBar({ value, onChange, onSubmit, disabled, onToggleSettings, showPromptLabel = false }: ComposeBarProps) {
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const lineHeight = 24;
    const maxHeight = lineHeight * 10;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value]);

  return (
    <div className="fixed bottom-0 left-0 right-0 border-t border-brand-stroke/60 bg-brand-panel/90 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-4">
        {showPromptLabel && <p className="text-base font-semibold text-white">What should I write?</p>}
        <div className="flex w-full items-end gap-3">
        <button
          type="button"
          aria-label="Open settings"
          ref={settingsButtonRef}
          onClick={() => onToggleSettings(settingsButtonRef.current?.getBoundingClientRect() ?? null)}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-brand-stroke/70 bg-transparent text-brand-muted transition hover:text-brand-blue self-end"
        >
          <WrenchIcon className="h-6 w-6" />
        </button>
        <div className="flex flex-1 flex-col gap-2">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="What should I write or revise?"
            className="w-full resize-none rounded-2xl border border-brand-stroke/80 bg-brand-ink px-4 py-3 text-base text-brand-text placeholder:text-brand-muted placeholder:opacity-30 focus:border-brand-blue focus:outline-none"
            rows={1}
          />
        </div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          className={cn(
            "flex h-12 min-w-[120px] items-center justify-center self-end rounded-full bg-brand-blue px-4 font-semibold text-white transition hover:bg-brand-blueHover",
            {
            "opacity-60": disabled || !value.trim()
            }
          )}
        >
          <ArrowUpIcon className="mr-2 h-4 w-4" />
          Send
        </button>
        </div>
      </div>
    </div>
  );
}

