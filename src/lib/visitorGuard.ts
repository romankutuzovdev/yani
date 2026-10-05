import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export const VISITOR_HISTORY_MS = 90 * 24 * 60 * 60 * 1000;
const BOT_HITS = 5;
const BOT_WINDOW_MS = 5_000;
const BOT_BLOCK_MS = 30 * 60 * 1000;

const recentHits = new Map<string, number[]>();
let lastPurgeAt = 0;

export function clearVisitorHits(ip: string) {
  recentHits.delete(ip);
}

export function clientIp(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded.slice(0, 80);
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 80);
  return "";
}

function trackHit(ip: string) {
  const now = Date.now();
  const hits = (recentHits.get(ip) ?? []).filter((at) => now - at <= BOT_WINDOW_MS);
  hits.push(now);
  if (hits.length >= BOT_HITS) {
    recentHits.delete(ip);
    return true;
  }
  recentHits.set(ip, hits);
  return false;
}

export async function purgeVisitorHistory() {
  const now = Date.now();
  if (now - lastPurgeAt < 60 * 60 * 1000) return;
  lastPurgeAt = now;
  await prisma.visitorRequest.deleteMany({
    where: { createdAt: { lt: new Date(now - VISITOR_HISTORY_MS) } },
  });
  await prisma.ipBlock.deleteMany({
    where: { blockedUntil: { lt: new Date(now) } },
  });
}

async function activeBlock(ip: string) {
  const block = await prisma.ipBlock.findUnique({ where: { ip } });
  if (!block) return null;
  if (block.blockedUntil && block.blockedUntil.getTime() <= Date.now()) {
    await prisma.ipBlock.delete({ where: { ip } }).catch(() => undefined);
    return null;
  }
  return block;
}

/** Refuse a chat when the IP is blocked or is sending a request every second. */
export async function guardChatIp(ip: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!ip) return { ok: true };
  const block = await activeBlock(ip);
  if (block) {
    const until = block.blockedUntil
      ? ` до ${block.blockedUntil.toLocaleString("ru-RU")}`
      : "";
    return { ok: false, message: `Доступ с этого IP закрыт${until}.` };
  }
  if (!trackHit(ip)) return { ok: true };

  const until = new Date(Date.now() + BOT_BLOCK_MS);
  await prisma.ipBlock.upsert({
    where: { ip },
    create: {
      ip,
      source: "bot",
      reason: "Запросы каждую секунду",
      blockedUntil: until,
    },
    update: {
      source: "bot",
      reason: "Запросы каждую секунду",
      blockedUntil: until,
    },
  });
  return { ok: false, message: "Слишком частые запросы. Доступ закрыт на 30 минут." };
}

export async function logVisitorRequest(input: {
  ip: string;
  agentId: string;
  agentName: string;
  sessionId: string;
  message: string;
}) {
  const message = input.message.trim().slice(0, 2000);
  if (!message) return;
  await prisma.visitorRequest.create({
    data: {
      ip: input.ip || "неизвестно",
      agentId: input.agentId,
      agentName: input.agentName,
      sessionId: input.sessionId.slice(0, 80),
      message,
    },
  });
  await purgeVisitorHistory().catch(() => undefined);
}
