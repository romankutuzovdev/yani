import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function sqliteUrl(raw: string | undefined) {
  const url = raw || "file:./data/yani.db";
  if (!url.startsWith("file:")) return url;
  const parts = [url];
  if (!url.includes("socket_timeout=")) {
    parts[0] = `${parts[0]}${parts[0].includes("?") ? "&" : "?"}socket_timeout=30`;
  }
  return parts[0];
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: sqliteUrl(process.env.DATABASE_URL) } },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

void prisma
  .$queryRawUnsafe("PRAGMA journal_mode=WAL")
  .then(() => prisma.$queryRawUnsafe("PRAGMA busy_timeout=30000"))
  .then(() => prisma.$queryRawUnsafe("PRAGMA synchronous=NORMAL"))
  .then(() => prisma.$queryRawUnsafe("PRAGMA cache_size=-64000"))
  .catch(() => undefined);
