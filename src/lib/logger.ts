export function logEvent(message: string, data?: unknown) {
  if (process.env.NODE_ENV === "development") {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.info("[auth-log]", message, data ?? "");
    } else {
      // eslint-disable-next-line no-console
      console.info("[auth-log]", message, data ?? "");
    }
  }
}


