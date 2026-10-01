import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, type SessionUser } from "@/lib/auth";
import { hashApiKey } from "@/lib/utils";
import type { LogLevel } from "@prisma/client";

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function error(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function requireAuth(): Promise<SessionUser | NextResponse> {
  const session = await getSession();
  if (!session) return error("Unauthorized", 401);
  return session;
}

export async function requireAdmin(): Promise<SessionUser | NextResponse> {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;
  if (session.role !== "ADMIN") return error("Forbidden", 403);
  return session;
}

export async function resolveApiKey(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const raw = authHeader.slice(7).trim();
  if (!raw.startsWith("sk_agent_")) return null;
  const keyHash = hashApiKey(raw);
  const key = await prisma.apiKey.findFirst({
    where: { keyHash, revokedAt: null },
    include: { agent: true, user: true },
  });
  if (!key) return null;
  await prisma.apiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() },
  });
  return key;
}

export async function writeLog(opts: {
  level?: LogLevel;
  type: string;
  message: string;
  agentId?: string;
  taskId?: string;
  userId?: string;
  meta?: Record<string, unknown>;
}) {
  try {
    await prisma.systemLog.create({
      data: {
        level: opts.level ?? "INFO",
        type: opts.type,
        message: opts.message,
        agentId: opts.agentId,
        taskId: opts.taskId,
        userId: opts.userId,
        meta: JSON.stringify(opts.meta ?? {}),
      },
    });
  } catch {
    // never break request path on logging failure
  }
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limitPerMinute: number) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return { allowed: true, remaining: limitPerMinute - 1 };
  }
  if (bucket.count >= limitPerMinute) {
    return { allowed: false, remaining: 0, retryAfterMs: bucket.resetAt - now };
  }
  bucket.count += 1;
  return { allowed: true, remaining: limitPerMinute - bucket.count };
}
