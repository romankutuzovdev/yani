import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json, requireAdmin } from "@/lib/api";
import type { LogLevel } from "@prisma/client";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const sp = req.nextUrl.searchParams;
  const level = sp.get("level") as LogLevel | null;
  const type = sp.get("type");
  const agentId = sp.get("agentId");
  const taskId = sp.get("taskId");

  const logs = await prisma.systemLog.findMany({
    where: {
      ...(level ? { level } : {}),
      ...(type ? { type } : {}),
      ...(agentId ? { agentId } : {}),
      ...(taskId ? { taskId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return json({ logs });
}
