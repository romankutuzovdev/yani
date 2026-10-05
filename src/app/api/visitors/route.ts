import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin } from "@/lib/api";
import { clearVisitorHits } from "@/lib/visitorGuard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const ip = req.nextUrl.searchParams.get("ip")?.trim() ?? "";
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [requests, blocks, ipCounts] = await Promise.all([
    prisma.visitorRequest.findMany({
      where: ip ? { ip } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.ipBlock.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.visitorRequest.groupBy({
      by: ["ip"],
      where: { createdAt: { gte: since } },
      _count: { ip: true },
      orderBy: { _count: { ip: "desc" } },
      take: 12,
    }),
  ]);

  const now = Date.now();
  return json({
    requests: requests.map((row) => ({
      id: row.id,
      ip: row.ip,
      agentName: row.agentName,
      message: row.message,
      createdAt: row.createdAt.toISOString(),
    })),
    blocks: blocks
      .filter((row) => !row.blockedUntil || row.blockedUntil.getTime() > now)
      .map((row) => ({
        ip: row.ip,
        reason: row.reason,
        source: row.source,
        blockedUntil: row.blockedUntil?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    ips: ipCounts.map((row) => ({ ip: row.ip, count: row._count.ip })),
  });
}

const blockSchema = z.object({
  ip: z.string().trim().min(1).max(80),
  reason: z.string().trim().max(200).optional(),
});

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  try {
    const body = blockSchema.parse(await req.json());
    clearVisitorHits(body.ip);
    const block = await prisma.ipBlock.upsert({
      where: { ip: body.ip },
      create: {
        ip: body.ip,
        source: "manual",
        reason: body.reason || "Заблокирован в админке",
        blockedUntil: null,
      },
      update: {
        source: "manual",
        reason: body.reason || "Заблокирован в админке",
        blockedUntil: null,
      },
    });
    return json({ ok: true, ip: block.ip });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Некорректный IP");
    return error(e instanceof Error ? e.message : "Не удалось заблокировать", 500);
  }
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  try {
    const body = blockSchema.pick({ ip: true }).parse(await req.json());
    clearVisitorHits(body.ip);
    await prisma.ipBlock.deleteMany({ where: { ip: body.ip } });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Некорректный IP");
    return error(e instanceof Error ? e.message : "Не удалось снять блок", 500);
  }
}
