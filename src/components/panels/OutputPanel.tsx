"use client";

import { formatTimestamp } from "@/lib/utils";
import { WriterOutput } from "@/types/writer";
import { ClipboardDocumentIcon, ArrowDownTrayIcon, BookmarkIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

type OutputPanelProps = {
  outputs: WriterOutput[];
  onCopy: (output: WriterOutput) => void;
  onDownload: (output: WriterOutput) => Promise<void>;
  onSaveStyle: (output: WriterOutput) => Promise<void>;
  onEdit: (output: WriterOutput) => void;
  canSaveStyle?: boolean;
  onPlaceholderUpdate: (outputId: string, placeholderId: string, value: string | null) => void;
};

export default function OutputPanel({
  outputs,
  onCopy,
  onDownload,
  onSaveStyle,
  onEdit,
  canSaveStyle = true,
  onPlaceholderUpdate
}: OutputPanelProps) {
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
          <p className="text-center text-xs uppercase tracking-[0.2em] text-brand-muted">{formatTimestamp(output.createdAt)}</p>
          <div className="flex justify-end">
            <div className="max-w-xl rounded-3xl border border-brand-stroke/60 bg-brand-panel/80 px-4 py-3 text-sm text-brand-text shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
              <div className="mb-2 flex justify-end">
                {output.prompt && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-brand-blue hover:opacity-80"
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
            <header className="mb-4">
              <h2 className="font-display text-2xl text-brand-text">{output.title}</h2>
            </header>
            <div className="space-y-3 text-base leading-relaxed text-brand-text/90">
              <OutputContent
                output={output}
                onPlaceholderUpdate={onPlaceholderUpdate}
              />
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

type OutputContentProps = {
  output: WriterOutput;
  onPlaceholderUpdate: (outputId: string, placeholderId: string, value: string | null) => void;
};

function OutputContent({ output, onPlaceholderUpdate }: OutputContentProps) {
  const lines = output.content.split("\n");
  const placeholderMeta = output.placeholderMeta ?? [];
  const values = output.placeholderValues ?? {};
  let cursor = 0;

  return (
    <>
      {lines.map((line, idx) => {
        const { nodes, nextCursor } = buildLineSegments({
          line,
          outputId: output.id,
          placeholderMeta,
          cursor,
          values,
          onPlaceholderUpdate
        });
        cursor = nextCursor;
        return <p key={idx}>{nodes}</p>;
      })}
    </>
  );
}

type BuildSegmentsArgs = {
  line: string;
  outputId: string;
  placeholderMeta: WriterOutput["placeholderMeta"];
  cursor: number;
  values: Record<string, string>;
  onPlaceholderUpdate: (outputId: string, placeholderId: string, value: string | null) => void;
};

function buildLineSegments({
  line,
  outputId,
  placeholderMeta,
  cursor,
  values,
  onPlaceholderUpdate
}: BuildSegmentsArgs): { nodes: ReactNode[]; nextCursor: number } {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let localCursor = cursor;
  const regex = /\[([^\]]+)]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<span key={`${outputId}-text-${localCursor}-${match.index}`}>{line.slice(lastIndex, match.index)}</span>);
    }
    const meta = placeholderMeta?.[localCursor];
    const label = meta?.label ?? (match[1]?.trim() || "missing info");
    const placeholderId = meta?.id ?? `ph-${localCursor}`;
    nodes.push(
      <PlaceholderField
        key={`${outputId}-${placeholderId}-${localCursor}`}
        outputId={outputId}
        placeholderId={placeholderId}
        label={label}
        value={values[placeholderId] ?? ""}
        onUpdate={onPlaceholderUpdate}
      />
    );
    lastIndex = match.index + match[0].length;
    localCursor++;
  }

  if (lastIndex < line.length) {
    nodes.push(<span key={`${outputId}-text-tail-${localCursor}-${lastIndex}`}>{line.slice(lastIndex)}</span>);
  }

  return { nodes, nextCursor: localCursor };
}

type PlaceholderFieldProps = {
  outputId: string;
  placeholderId: string;
  label: string;
  value: string;
  onUpdate: (outputId: string, placeholderId: string, value: string | null) => void;
};

function PlaceholderField({ outputId, placeholderId, label, value, onUpdate }: PlaceholderFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
    if (!value) {
      setEditing(false);
    }
  }, [value]);

  const displayLabel = value || `Enter ${label} +`;

  function handleSubmit() {
    const trimmed = draft.trim();
    onUpdate(outputId, placeholderId, trimmed || null);
    setEditing(false);
  }

function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSubmit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(value);
      if (!value) {
        setEditing(false);
      }
    }
  }

  function openEditor() {
    setDraft(value);
    setEditing(true);
  }

  if (editing) {
    return (
      <span className="ml-2 inline-flex items-center gap-2 rounded-full border-[3px] border-white px-3 py-1 text-xs font-semibold text-white">
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          className="w-32 border-none bg-transparent text-white placeholder:text-white/50 focus:outline-none"
          placeholder={label}
        />
        <button type="button" className="text-white/70 hover:text-white" onClick={handleSubmit}>
          Done
        </button>
      </span>
    );
  }

  if (value) {
    return (
      <span className="ml-2 inline-flex items-center gap-2 rounded-full border-[3px] border-white px-3 py-1 text-xs font-semibold text-white">
        <span>{value}</span>
        <button type="button" className="text-white/70 hover:text-white" onClick={openEditor}>
          Edit
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={openEditor}
      className="ml-2 inline-flex items-center rounded-full border-[3px] border-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-white/10"
    >
      {displayLabel}
    </button>
  );
}

