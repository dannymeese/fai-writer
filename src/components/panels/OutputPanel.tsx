"use client";

import { cn, formatTimestamp } from "@/lib/utils";
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
  showEmptyState?: boolean;
};

type PendingAction = {
  outputId: string;
  type: "copy" | "download";
};

function hasPendingPlaceholders(output: WriterOutput): boolean {
  const meta = output.placeholderMeta ?? [];
  if (!meta.length) return false;
  return meta.some((placeholder) => {
    const value = output.placeholderValues?.[placeholder.id];
    return !value || !value.trim();
  });
}

export default function OutputPanel({
  outputs,
  onCopy,
  onDownload,
  onSaveStyle,
  onEdit,
  canSaveStyle = true,
  onPlaceholderUpdate,
  showEmptyState = true
}: OutputPanelProps) {
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  if (!outputs.length) {
    return showEmptyState ? (
      <div className="flex min-h-[60vh] w-full items-center justify-center text-center">
        <p className="text-8xl font-normal text-white">What should I write?</p>
      </div>
    ) : null;
  }

  return (
    <div className="space-y-6">
      {[...outputs].reverse().map((output) => (
        <div key={output.id} className="space-y-4">
          <p className="text-center text-xs text-brand-muted">{formatTimestamp(output.createdAt)}</p>
          <div className="flex flex-col items-end gap-1">
            <p className="text-[9px] font-semibold uppercase text-brand-muted">YOU</p>
            <div className="max-w-xl rounded-3xl border border-brand-stroke/60 bg-brand-panel/80 px-4 py-3 text-sm text-brand-text shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
              <p className="text-brand-text/90">{output.prompt || "Prompt unavailable for this draft."}</p>
              {output.prompt && (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border border-brand-stroke/70 px-3 py-1.5 text-xs font-semibold text-brand-text transition hover:border-brand-blue hover:text-brand-blue"
                    onClick={() => onEdit(output)}
                  >
                    Edit &amp; resend
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[9px] font-semibold uppercase text-brand-muted">FORGETABOUTIT WRITER PRO</p>
            <article
              className={cn(
                "max-w-3xl rounded-3xl border border-brand-stroke/60 p-6 text-brand-text shadow-[0_25px_80px_rgba(0,0,0,0.35)]",
                output.isPending ? "bg-brand-blue/10 animate-pulse" : "bg-brand-panel/90"
              )}
            >
              {output.isPending ? (
                <div className="flex h-32 items-center justify-center">
                  <div className="h-4 w-1/2 rounded-full bg-brand-blue/40" />
                </div>
              ) : (
                <div className="space-y-3 text-base leading-relaxed text-brand-text/90">
                  <OutputContent output={output} onPlaceholderUpdate={onPlaceholderUpdate} />
                </div>
              )}
              <footer className="mt-6 flex flex-wrap items-center gap-3">
                <ActionButton
                  icon={<ClipboardDocumentIcon className="h-4 w-4" />}
                  label="Copy to Clipboard"
                  onClick={() => handleAction("copy", output)}
                  disabled={output.isPending}
                />
                <ActionButton
                  icon={<ArrowDownTrayIcon className="h-4 w-4" />}
                  label="Download .docx"
                  onClick={() => handleAction("download", output)}
                  disabled={output.isPending}
                />
                <ActionButton
                  icon={<BookmarkIcon className="h-4 w-4" />}
                  label="Save Writing Style"
                  disabled={!canSaveStyle || output.isPending}
                  onClick={() => onSaveStyle(output)}
                />
              </footer>
              {pendingAction?.outputId === output.id && (
                <InlineConfirm action={pendingAction.type} onConfirm={() => confirmPending(output)} onCancel={() => setPendingAction(null)} />
              )}
            </article>
          </div>
        </div>
      ))}
    </div>
  );

  function handleAction(type: PendingAction["type"], output: WriterOutput) {
    if (output.isPending) {
      return;
    }
    if (hasPendingPlaceholders(output)) {
      setPendingAction({ outputId: output.id, type });
      return;
    }
    triggerAction(type, output);
  }

  function confirmPending(output: WriterOutput) {
    if (!pendingAction) return;
    triggerAction(pendingAction.type, output);
    setPendingAction(null);
  }

  function triggerAction(type: PendingAction["type"], output: WriterOutput) {
    if (type === "copy") {
      onCopy(output);
    } else {
      void onDownload(output);
    }
  }
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

function InlineConfirm({
  action,
  onConfirm,
  onCancel
}: {
  action: PendingAction["type"];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const actionLabel = action === "copy" ? "Copy anyway" : "Download anyway";
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-brand-stroke/60 bg-brand-panel/70 px-4 py-3 text-sm text-brand-text">
      <p className="flex-1 text-sm text-brand-muted">There are still placeholders in your text.</p>
      <button
        type="button"
        className="rounded-full bg-brand-blue px-3 py-1 text-xs font-semibold text-white transition hover:bg-brand-blue/80"
        onClick={onConfirm}
      >
        {actionLabel}
      </button>
      <button
        type="button"
        className="rounded-full border border-brand-stroke/60 px-3 py-1 text-xs font-semibold text-brand-text hover:border-brand-blue hover:text-brand-blue"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
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

  const displayLabel = value || `Enter ${label}`;

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
      <span className="relative inline-flex items-center gap-2 text-sm font-semibold text-white">
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          className="w-40 border-none bg-transparent text-white placeholder:text-white/50 focus:outline-none"
          placeholder={label}
        />
        <span
          className="pointer-events-none absolute left-0 right-0"
          style={{ bottom: "-4px", height: "3px", backgroundColor: draft.trim() ? "#0f0" : "#0000ff" }}
        />
        <button type="button" className="text-xs font-semibold text-white/80 hover:text-white" onClick={handleSubmit}>
          Done
        </button>
      </span>
    );
  }

  const underlineColor = value ? "#0f0" : "#0000ff";

  return (
    <button type="button" onClick={openEditor} className="relative inline-flex items-center gap-2 text-sm font-semibold text-white">
      <span className="text-base normal-case">{displayLabel}</span>
      {value ? (
        <span className="text-[11px] font-bold text-white">EDIT</span>
      ) : (
        <span className="text-2xl font-bold leading-none text-brand-blue">+</span>
      )}
      <span
        className="pointer-events-none absolute left-0 right-0"
        style={{ bottom: "-4px", height: "3px", backgroundColor: underlineColor }}
      />
    </button>
  );
}

