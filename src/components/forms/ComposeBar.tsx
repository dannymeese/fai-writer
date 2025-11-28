"use client";

import { PaperAirplaneIcon, Cog6ToothIcon } from "@heroicons/react/24/solid";
import { cn } from "@/lib/utils";

type ComposeBarProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  onOpenSettings: () => void;
};

export default function ComposeBar({ value, onChange, onSubmit, disabled, onOpenSettings }: ComposeBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-4">
        <button
          type="button"
          aria-label="Open settings"
          onClick={onOpenSettings}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200"
        >
          <Cog6ToothIcon className="h-6 w-6" />
        </button>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="What should I write or revise?"
          className="h-12 flex-1 resize-none rounded-2xl border border-slate-200 px-4 py-3 text-base focus:border-brandblue focus:outline-none"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          className={cn("flex h-12 min-w-[96px] items-center justify-center rounded-full bg-brandblue px-4 font-semibold text-white transition", {
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

