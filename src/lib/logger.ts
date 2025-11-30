type Payload = Record<string, unknown>;

function normalizeData(data?: unknown): Payload | undefined {
  if (data === undefined || data === null) return undefined;
  if (typeof data === "object") {
    return data as Payload;
  }
  return { data };
}

export function logEvent(message: string | Error, data?: unknown) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  if (message instanceof Error) {
    const payload: Payload = {
      error: message.message,
      stack: message.stack
    };
    const extra = normalizeData(data);
    console.info("[auth-log]", message.message, extra ? { ...payload, ...extra } : payload);
  } else {
    const payload = normalizeData(data);
    console.info("[auth-log]", message, payload ?? "");
  }
}


