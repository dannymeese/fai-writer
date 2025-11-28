import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: (string | undefined | null | Record<string, boolean>)[]) {
  return twMerge(clsx(inputs));
}

export function smartTitleFromPrompt(prompt: string) {
  const base = prompt.split(/[.!?]/)[0]?.trim() || "Untitled Draft";
  return base.length > 60 ? `${base.slice(0, 57)}...` : base;
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

