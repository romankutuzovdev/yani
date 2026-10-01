import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

const widgetSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().min(1).optional(),
  greeting: z.string().optional(),
  position: z.enum(["bottom-right", "bottom-left"]).optional(),
  theme: z.enum(["light", "dark"]).optional(),
  primaryColor: z.string().optional(),
  buttonLabel: z.string().optional(),
});

function parseConfig(raw: string | null | undefined) {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;

  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { id: true, slug: true, name: true, greeting: true },
  });
  if (!agent) return error("Agent not found", 404);

  let widget = await prisma.widget.findFirst({
    where: { agentId: id },
    orderBy: { createdAt: "asc" },
  });

  if (!widget) {
    widget = await prisma.widget.create({
      data: {
        agentId: id,
        name: `${agent.name} Widget`,
        enabled: true,
        config: JSON.stringify({
          greeting: agent.greeting || "Привет! Чем могу помочь?",
          position: "bottom-right",
          theme: "light",
          primaryColor: "#0284c7",
          buttonLabel: "Чат",
        }),
      },
    });
  }

  const config = parseConfig(widget.config);
  return json({
    widget: {
      id: widget.id,
      name: widget.name,
      enabled: widget.enabled,
      config,
      agent: { id: agent.id, slug: agent.slug, name: agent.name },
    },
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;

  try {
    const body = widgetSchema.parse(await req.json());
    const agent = await prisma.agent.findUnique({
      where: { id },
      select: { id: true, slug: true, name: true, greeting: true },
    });
    if (!agent) return error("Agent not found", 404);

    let widget = await prisma.widget.findFirst({
      where: { agentId: id },
      orderBy: { createdAt: "asc" },
    });

    const prev = parseConfig(widget?.config);
    const nextConfig = {
      ...prev,
      ...(body.greeting !== undefined ? { greeting: body.greeting } : {}),
      ...(body.position !== undefined ? { position: body.position } : {}),
      ...(body.theme !== undefined ? { theme: body.theme } : {}),
      ...(body.primaryColor !== undefined ? { primaryColor: body.primaryColor } : {}),
      ...(body.buttonLabel !== undefined ? { buttonLabel: body.buttonLabel } : {}),
    };

    if (!widget) {
      widget = await prisma.widget.create({
        data: {
          agentId: id,
          name: body.name || `${agent.name} Widget`,
          enabled: body.enabled ?? true,
          config: JSON.stringify(nextConfig),
        },
      });
    } else {
      widget = await prisma.widget.update({
        where: { id: widget.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          config: JSON.stringify(nextConfig),
        },
      });
    }

    await writeLog({
      type: "widget",
      message: `Updated widget for agent ${agent.name}`,
      agentId: agent.id,
      userId: admin.id,
    });

    return json({
      widget: {
        id: widget.id,
        name: widget.name,
        enabled: widget.enabled,
        config: parseConfig(widget.config),
        agent: { id: agent.id, slug: agent.slug, name: agent.name },
      },
    });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Update failed", 500);
  }
}
