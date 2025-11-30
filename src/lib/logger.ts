"use client";

export function logEvent(message: string, data?: unknown) {
  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.info("[auth-log]", message, data ?? "");
  }
}


