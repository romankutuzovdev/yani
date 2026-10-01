import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, requireAdmin } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;

  const agent = await prisma.agent.findUnique({ where: { id }, select: { id: true } });
  if (!agent) return error("Agent not found", 404);

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
          where: { id },
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
      }, 1500);

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
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
