import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;

  const agent = await prisma.agent.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      statusMessage: true,
      enabled: true,
      updatedAt: true,
      character: { include: { assets: true } },
    },
  });
  if (!agent) return error("Agent not found", 404);
  return json({ agent });
}
