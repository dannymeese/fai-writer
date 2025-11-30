"use client";

import { PaperAirplaneIcon, WrenchIcon } from "@heroicons/react/24/solid";
import { cn } from "@/lib/utils";
import { useRef } from "react";

type ComposeBarProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  onToggleSettings: (anchorRect: DOMRect | null) => void;
};

export default function ComposeBar({ value, onChange, onSubmit, disabled, onToggleSettings }: ComposeBarProps) {
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="fixed bottom-0 left-0 right-0 border-t border-brand-stroke/60 bg-brand-panel/90 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-4">
        <button
          type="button"
          aria-label="Open settings"
          ref={settingsButtonRef}
          onClick={() => onToggleSettings(settingsButtonRef.current?.getBoundingClientRect() ?? null)}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-brand-stroke/70 bg-transparent text-brand-muted transition hover:text-brand-blue"
        >
          <WrenchIcon className="h-6 w-6" />
        </button>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="What should I write or revise?"
          className="h-12 flex-1 resize-none rounded-2xl border border-brand-stroke/80 bg-brand-ink px-4 py-3 text-base text-brand-text placeholder:text-brand-muted focus:border-brand-blue focus:outline-none"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          className={cn("flex h-12 min-w-[120px] items-center justify-center rounded-full bg-brand-blue px-4 font-semibold text-white transition hover:bg-brand-blueHover", {
            "opacity-60": disabled || !value.trim()
          })}
        >
          <PaperAirplaneIcon className="mr-2 h-4 w-4" />
          Send
        </button>
      </div>
    </div>
  );
}

