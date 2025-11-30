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
  onEdit: (output: WriterOutput) => void;
  canSaveStyle?: boolean;
};

export default function OutputPanel({ outputs, onCopy, onDownload, onSaveStyle, onEdit, canSaveStyle = true }: OutputPanelProps) {
  if (!outputs.length) {
    return (
      <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-brand-stroke/60 bg-brand-panel/60 p-8 text-center text-brand-muted">
        Your drafts will land here with instant copy, download, and style saves.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {outputs.map((output) => (
        <div key={output.id} className="space-y-4">
          <div className="flex justify-end">
            <div className="max-w-xl rounded-3xl border border-brand-stroke/60 bg-brand-panel/80 px-4 py-3 text-sm text-brand-text shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.3em] text-brand-muted">You</p>
                {output.prompt && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-brand-blue hover:text-brand-blueHover"
                    onClick={() => onEdit(output)}
                  >
                    Edit &amp; resend
                  </button>
                )}
              </div>
              <p className="text-brand-text/90">{output.prompt || "Prompt unavailable for this draft."}</p>
            </div>
          </div>
          <article className="max-w-3xl rounded-3xl border border-brand-stroke/60 bg-brand-panel/90 p-6 text-brand-text shadow-[0_25px_80px_rgba(0,0,0,0.35)]">
            <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-brand-muted">Forgetaboutit</p>
                <h2 className="font-display text-2xl text-brand-text">{output.title}</h2>
              </div>
              <p className="text-sm text-brand-muted">{formatTimestamp(output.createdAt)}</p>
            </header>
            <div className="space-y-3 text-base leading-relaxed text-brand-text/90">
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
        </div>
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
      className="inline-flex items-center gap-2 rounded-full border border-brand-stroke/70 px-4 py-2 text-sm font-semibold text-brand-text transition hover:border-brand-blue hover:text-brand-blue disabled:cursor-not-allowed disabled:border-brand-stroke disabled:text-brand-muted"
    >
      {icon}
      {label}
    </button>
  );
}

