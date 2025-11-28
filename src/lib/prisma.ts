import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const hasDatabase = Boolean(process.env.DATABASE_URL);

const client =
  hasDatabase &&
  (globalForPrisma.prisma ??
    new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"]
    }));

if (hasDatabase && client && process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = client;
}

export const prisma = client ?? null;

