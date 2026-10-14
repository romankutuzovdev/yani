import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireOrg } from "@/lib/api";
import { clearVisitorHits } from "@/lib/visitorGuard";
import { clampPage, readListQuery, wordsWhere } from "@/lib/paging";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const org = await requireOrg();
  if (org instanceof Response) return org;

  const { page, q } = readListQuery(req.nextUrl);
  const where = {
    agentId: org.orgAgentId,
    ...wordsWhere(["ip", "message", "agentName"], q),
  };
  const [total, blocks] = await Promise.all([
    prisma.visitorRequest.count({ where }),
    prisma.agentIpBlock.findMany({
      where: { agentId: org.orgAgentId },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const meta = clampPage(page, total);
  const requests = await prisma.visitorRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (meta.page - 1) * meta.pageSize,
    take: meta.pageSize,
  });

  return json({
    requests: requests.map((row) => ({
      id: row.id,
      ip: row.ip,
      message: row.message,
      createdAt: row.createdAt.toISOString(),
    })),
    blocks: blocks.map((row) => ({
      ip: row.ip,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    })),
    ...meta,
  });
}

const ipSchema = z.object({
  ip: z.string().trim().min(1).max(80),
});

export async function POST(req: NextRequest) {
  const org = await requireOrg();
  if (org instanceof Response) return org;
  try {
    const body = ipSchema.parse(await req.json());
    clearVisitorHits(body.ip);
    await prisma.agentIpBlock.upsert({
      where: { agentId_ip: { agentId: org.orgAgentId, ip: body.ip } },
      create: { agentId: org.orgAgentId, ip: body.ip, reason: "Закрыто организацией" },
      update: { reason: "Закрыто организацией" },
    });
    return json({ ok: true, ip: body.ip });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Некорректный IP");
    return error("Не удалось заблокировать", 500);
  }
}

export async function DELETE(req: NextRequest) {
  const org = await requireOrg();
  if (org instanceof Response) return org;
  try {
    const body = ipSchema.parse(await req.json());
    clearVisitorHits(body.ip);
    await prisma.agentIpBlock.deleteMany({
      where: { agentId: org.orgAgentId, ip: body.ip },
    });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Некорректный IP");
    return error("Не удалось снять блок", 500);
  }
}
