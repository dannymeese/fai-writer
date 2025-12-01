import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: (string | undefined | null | Record<string, boolean>)[]) {
  return twMerge(clsx(inputs));
}

export function smartTitleFromPrompt(prompt: string) {
  const base = prompt.split(/[.!?]/)[0]?.trim() || "Untitled Doc";
  return base.length > 60 ? `${base.slice(0, 57)}...` : base;
}

export function deriveTitleFromContent(content?: string | null, fallbackTitle?: string | null, maxLength = 80) {
  const normalize = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();
  const normalizedContent = normalize(content);
  const normalizedFallback = normalize(fallbackTitle);
  const base = normalizedContent || normalizedFallback || "Untitled doc";
  if (base.length <= maxLength) {
    return base;
  }
  return `${base.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function formatTimestamp(date: Date | string) {
  const dt = typeof date === "string" ? new Date(date) : date;
  return dt.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  });
}

