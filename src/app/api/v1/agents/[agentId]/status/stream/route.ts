import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error } from "@/lib/api";

type Params = { params: Promise<{ agentId: string }> };

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
  const { agentId } = await params;
  const origin = req.headers.get("origin");

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, enabled: true },
  });
  if (!agent || !agent.enabled) return error("Агент не найден", 404);

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const tick = async () => {
        const current = await prisma.agent.findUnique({
          where: { id: agentId },
          select: {
            status: true,
            statusMessage: true,
            updatedAt: true,
            character: { include: { assets: true } },
          },
        });
        if (current) send(current);
      };

      await tick();
      const interval = setInterval(() => {
        void tick();
      }, 1000);

      const abort = () => {
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      };

      req.signal.addEventListener("abort", abort);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      ...cors(origin),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
