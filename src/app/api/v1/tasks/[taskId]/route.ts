import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, resolveApiKey } from "@/lib/api";

type Params = { params: Promise<{ taskId: string }> };

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function GET(req: NextRequest, { params }: Params) {
  const { taskId } = await params;
  const origin = req.headers.get("origin");
  const key = await resolveApiKey(req.headers.get("authorization"));
  if (!key) return error("Invalid API key", 401);

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      executions: {
        orderBy: { startedAt: "desc" },
        take: 1,
        include: { events: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!task) return error("Task not found", 404);
  if (key.agentId && key.agentId !== task.agentId) return error("Forbidden", 403);

  return json({ task }, { headers: cors(origin) });
}
