"use server";

import fs from "node:fs";
import path from "node:path";

const logDir = path.join(process.cwd(), "tmp");
const logFile = path.join(logDir, "auth.log");

export function logEvent(message: string, data?: unknown) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const line = `[${new Date().toISOString()}] ${message}${data ? " " + JSON.stringify(data) : ""}\n`;
    fs.appendFileSync(logFile, line);
  } catch (error) {
    console.error("logEvent error", error);
  }
}


