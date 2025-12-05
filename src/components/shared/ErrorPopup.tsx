"use client";

import { MinusSmallIcon } from "@heroicons/react/24/outline";

export type ErrorDetails = {
  message: string;
  status?: number;
  statusText?: string;
  details?: string | unknown;
  fullError?: unknown;
};

export function ErrorPopup({ error, onClose }: { error: ErrorDetails | null; onClose: () => void }) {
  if (!error) return null;

  const getDetailsText = (): string => {
    if (!error.details) return "";
    if (typeof error.details === "string") return error.details;
    try {
      return JSON.stringify(error.details, null, 2);
    } catch {
      return String(error.details);
    }
  };

  const formatFullError = (): string => {
    const parts: string[] = [];
    
    if (error.status) {
      parts.push(`Status: ${error.status}`);
    }
    if (error.statusText) {
      parts.push(`Status Text: ${error.statusText}`);
    }
    if (error.message) {
      parts.push(`Message: ${error.message}`);
    }
    if (error.details) {
      if (typeof error.details === "string") {
        parts.push(`Details: ${error.details}`);
      } else {
        parts.push(`Details: ${JSON.stringify(error.details, null, 2)}`);
      }
    }
    if (error.fullError) {
      try {
        parts.push(`Full Error: ${JSON.stringify(error.fullError, null, 2)}`);
      } catch {
        parts.push(`Full Error: ${String(error.fullError)}`);
      }
    }
    
    return parts.join("\n\n");
  };

  const handleCopy = async () => {
    const fullErrorText = formatFullError();
    try {
      await navigator.clipboard.writeText(fullErrorText);
      // You could add a brief toast here if desired
    } catch (err) {
      console.error("Failed to copy error", err);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-2xl rounded-2xl border border-brand-stroke/60 bg-brand-panel p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-xl text-red-400">Error</h3>
          <button
            onClick={onClose}
            className="rounded-full border border-brand-stroke/70 p-2 text-brand-text hover:text-brand-blue transition"
            aria-label="Close"
          >
            <MinusSmallIcon className="h-5 w-5" />
          </button>
        </div>
        
        <div className="mb-4 space-y-2">
          <p className="text-sm font-semibold text-brand-text">{error.message}</p>
          
          {error.status && (
            <p className="text-xs text-brand-muted">
              HTTP {error.status} {error.statusText || ""}
            </p>
          )}
          
          {error.details ? (
            <div className="mt-3 rounded-lg border border-brand-stroke/40 bg-brand-background/40 p-3">
              <p className="text-xs font-semibold text-brand-muted mb-1">Details:</p>
              <pre className="text-xs text-brand-text whitespace-pre-wrap break-words font-mono">
                {getDetailsText()}
              </pre>
            </div>
          ) : null}
        </div>
        
        <div className="flex justify-end gap-2">
          <button
            onClick={handleCopy}
            className="rounded-full border border-brand-stroke/70 bg-brand-ink px-4 py-2 text-sm font-semibold text-brand-text transition hover:border-brand-blue hover:text-brand-blue"
          >
            Copy Error
          </button>
          <button
            onClick={onClose}
            className="rounded-full bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue/80"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

