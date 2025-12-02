import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: (string | undefined | null | Record<string, boolean>)[]) {
  return twMerge(clsx(inputs));
}

/**
 * Strips markdown formatting from a title string.
 * Removes markdown syntax like **bold**, *italic*, # headings, etc.
 * This should only be used for AI-generated titles, not user-typed titles.
 */
export function stripMarkdownFromTitle(title: string): string {
  if (!title) return title;
  
  let cleaned = title;
  
  // Remove heading markers at the start (# ## ### etc.)
  cleaned = cleaned.replace(/^#+\s+/, '');
  
  // Remove bold (**text** or __text__) - process multiple times to handle nested cases
  while (cleaned.includes('**')) {
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  }
  while (cleaned.includes('__')) {
    cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
  }
  
  // Remove italic (*text* or _text_) - only if there's content between markers
  // Use a simpler approach: remove single asterisks/underscores that wrap text
  cleaned = cleaned.replace(/\*([^*\n]+?)\*/g, '$1');
  cleaned = cleaned.replace(/_([^_\n]+?)_/g, '$1');
  
  // Remove strikethrough (~text~)
  cleaned = cleaned.replace(/~([^~]+)~/g, '$1');
  
  // Remove inline code (`text`)
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
  
  // Remove links [text](url) -> text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Remove link references [text] -> text (but only if not already processed above)
  cleaned = cleaned.replace(/\[([^\]]+)\]/g, '$1');
  
  // Clean up extra whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

export function smartTitleFromPrompt(prompt: string) {
  const base = prompt.split(/[.!?]/)[0]?.trim() || "Untitled Doc";
  const cleaned = stripMarkdownFromTitle(base);
  return cleaned.length > 60 ? cleaned.slice(0, 60) : cleaned;
}

export function deriveTitleFromContent(content?: string | null, fallbackTitle?: string | null, maxLength = 80) {
  const normalize = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();
  const normalizedContent = normalize(content);
  const normalizedFallback = normalize(fallbackTitle);
  const base = normalizedContent || normalizedFallback || "Untitled doc";
  // Strip markdown from content-derived titles, but preserve user-provided fallback titles as-is
  const cleaned = normalizedContent ? stripMarkdownFromTitle(base) : base;
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return cleaned.slice(0, maxLength);
}

export function formatTimestamp(date: Date | string, includeYear?: boolean) {
  const dt = typeof date === "string" ? new Date(date) : date;
  const currentYear = new Date().getFullYear();
  const dateYear = dt.getFullYear();
  const shouldIncludeYear = includeYear !== undefined ? includeYear : dateYear !== currentYear;
  
  return dt.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
    ...(shouldIncludeYear && { year: "numeric" })
  });
}

export function generateDownloadFilename(title: string | null | undefined, content: string, extension: string): string {
  const isUntitled = !title || title.trim() === "" || title.toLowerCase() === "untitled doc" || title.toLowerCase() === "untitled document";
  
  let baseName: string;
  if (isUntitled) {
    // Use first 15 chars of body content (keep alphanumeric and spaces, then remove spaces)
    const contentPreview = content.trim().substring(0, 15).replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "");
    baseName = contentPreview || "Untitled";
  } else {
    // Use first 15 chars of title (keep alphanumeric and spaces, then remove spaces)
    const titlePreview = title.trim().substring(0, 15).replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "");
    baseName = titlePreview || "Untitled";
  }
  
  // Ensure baseName is not empty and limit to 15 chars
  if (!baseName || baseName.length === 0) {
    baseName = "Untitled";
  } else if (baseName.length > 15) {
    baseName = baseName.substring(0, 15);
  }
  
  return `${baseName}_Forgetaboutit_Writer.${extension}`;
}

const PROMPT_HISTORY_KEY = "forgetaboutit_writer_prompt_history_v1";
const MAX_PROMPT_HISTORY = 50;

export type PromptHistoryEntry = {
  prompt: string;
  timestamp: string;
};

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function addPromptToHistory(prompt: string): void {
  if (!canUseLocalStorage() || !prompt || !prompt.trim()) {
    return;
  }
  
  try {
    const trimmedPrompt = prompt.trim();
    const existing = getPromptHistory();
    
    // Remove duplicates (case-insensitive) and add new one at the beginning
    const filtered = existing.filter(
      (entry) => entry.prompt.toLowerCase() !== trimmedPrompt.toLowerCase()
    );
    
    const newEntry: PromptHistoryEntry = {
      prompt: trimmedPrompt,
      timestamp: new Date().toISOString()
    };
    
    const updated = [newEntry, ...filtered].slice(0, MAX_PROMPT_HISTORY);
    window.localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("Failed to save prompt to history", error);
  }
}

export function getPromptHistory(): PromptHistoryEntry[] {
  if (!canUseLocalStorage()) {
    return [];
  }
  
  try {
    const raw = window.localStorage.getItem(PROMPT_HISTORY_KEY);
    if (!raw) {
      return [];
    }
    
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    
    // Validate and filter entries
    const validEntries: PromptHistoryEntry[] = [];
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof entry.prompt === "string" &&
        entry.prompt.trim() &&
        typeof entry.timestamp === "string"
      ) {
        validEntries.push({
          prompt: entry.prompt.trim(),
          timestamp: entry.timestamp
        });
      }
    }
    
    // Sort by timestamp (most recent first)
    return validEntries.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeB - timeA;
    });
  } catch (error) {
    console.error("Failed to read prompt history", error);
    return [];
  }
}

export function clearPromptHistory(): void {
  if (!canUseLocalStorage()) {
    return;
  }
  
  try {
    window.localStorage.removeItem(PROMPT_HISTORY_KEY);
  } catch (error) {
    console.error("Failed to clear prompt history", error);
  }
}

