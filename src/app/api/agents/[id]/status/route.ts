import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireAgentStaff } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const staff = await requireAgentStaff(id);
  if (staff instanceof Response) return staff;

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
