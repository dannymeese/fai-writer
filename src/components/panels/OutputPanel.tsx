"use client";

import { formatTimestamp } from "@/lib/utils";
import { WriterOutput } from "@/types/writer";
import { ClipboardDocumentIcon, ArrowDownTrayIcon, BookmarkIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";

type OutputPanelProps = {
  outputs: WriterOutput[];
  onCopy: (output: WriterOutput) => void;
  onDownload: (output: WriterOutput) => Promise<void>;
  onSaveStyle: (output: WriterOutput) => Promise<void>;
  canSaveStyle?: boolean;
};

export default function OutputPanel({ outputs, onCopy, onDownload, onSaveStyle, canSaveStyle = true }: OutputPanelProps) {
  if (!outputs.length) {
    return (
      <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
        Your drafts will land here with instant copy, download, and style saves.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {outputs.map((output) => (
        <article key={output.id} className="rounded-3xl bg-white p-6 shadow-sm shadow-slate-200/60">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Conversation output</p>
              <h2 className="font-display text-2xl text-charcoal">{output.title}</h2>
            </div>
            <p className="text-sm text-slate-500">{formatTimestamp(output.createdAt)}</p>
          </header>
          <div className="space-y-3 text-base leading-relaxed text-slate-800">
            {output.content.split("\n").map((line, idx) => (
              <p key={idx}>{line}</p>
            ))}
          </div>
          <footer className="mt-6 flex flex-wrap items-center gap-3">
            <ActionButton icon={<ClipboardDocumentIcon className="h-4 w-4" />} label="Copy to Clipboard" onClick={() => onCopy(output)} />
            <ActionButton
              icon={<ArrowDownTrayIcon className="h-4 w-4" />}
              label="Download .docx"
              onClick={() => onDownload(output)}
            />
            <ActionButton
              icon={<BookmarkIcon className="h-4 w-4" />}
              label="Save Writing Style"
              disabled={!canSaveStyle}
              onClick={() => onSaveStyle(output)}
            />
          </footer>
        </article>
      ))}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-brandblue hover:text-brandblue disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
    >
      {icon}
      {label}
    </button>
  );
}

