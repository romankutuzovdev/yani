import { prisma } from "@/lib/db";

export const CHAT_HISTORY_MS = 7 * 24 * 60 * 60 * 1000;

let lastPurgeAt = 0;

/** Drop chat rows older than 7 days. At most once per hour per process. */
export async function purgeExpiredChatMessages() {
  const now = Date.now();
  if (now - lastPurgeAt < 60 * 60 * 1000) return;
  lastPurgeAt = now;
  await prisma.chatMessage.deleteMany({
    where: { createdAt: { lt: new Date(now - CHAT_HISTORY_MS) } },
  });
}

export async function deleteChatSessions(agentId: string, sessionIds: string[]) {
  const ids = [...new Set(sessionIds.map((id) => id.trim()).filter(Boolean))].slice(0, 50);
  if (!ids.length) return 0;
  const result = await prisma.chatMessage.deleteMany({
    where: { agentId, sessionId: { in: ids } },
  });
  return result.count;
}
