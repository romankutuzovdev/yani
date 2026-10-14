import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAgentStaff, writeLog } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

const widgetSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().min(1).optional(),
  greeting: z.string().optional(),
  position: z.enum(["bottom-right", "bottom-left"]).optional(),
  theme: z.enum(["light", "dark"]).optional(),
  primaryColor: z.string().optional(),
  buttonLabel: z.string().optional(),
  size: z.number().int().min(44).max(140).optional(),
  offsetBottom: z.number().min(0).max(40).optional(),
  offsetSide: z.number().min(0).max(40).optional(),
});

function parseConfig(raw: string | null | undefined) {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function defaults(agent: { name: string; greeting: string }) {
  return {
    greeting: agent.greeting || "Привет! Чем могу помочь?",
    position: "bottom-right",
    theme: "light",
    primaryColor: "#8b6fd4",
    buttonLabel: "Чат",
    size: 68,
    offsetBottom: 2,
    offsetSide: 2,
  };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const staff = await requireAgentStaff(id);
  if (staff instanceof Response) return staff;

  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { id: true, slug: true, name: true, greeting: true, asideText: true },
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
        config: JSON.stringify(defaults(agent)),
      },
    });
  }

  const config = { ...defaults(agent), ...parseConfig(widget.config) };
  return json({
    widget: {
      id: widget.id,
      name: widget.name,
      enabled: widget.enabled,
      config,
      agent: {
        id: agent.id,
        slug: agent.slug,
        name: agent.name,
        asideText: agent.asideText,
      },
    },
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const staff = await requireAgentStaff(id);
  if (staff instanceof Response) return staff;

  try {
    const body = widgetSchema.parse(await req.json());
    const agent = await prisma.agent.findUnique({
      where: { id },
      select: { id: true, slug: true, name: true, greeting: true, asideText: true },
    });
    if (!agent) return error("Agent not found", 404);

    let widget = await prisma.widget.findFirst({
      where: { agentId: id },
      orderBy: { createdAt: "asc" },
    });

    const prev = { ...defaults(agent), ...parseConfig(widget?.config) };
    const nextConfig = {
      ...prev,
      ...(body.greeting !== undefined ? { greeting: body.greeting } : {}),
      ...(body.position !== undefined ? { position: body.position } : {}),
      ...(body.theme !== undefined ? { theme: body.theme } : {}),
      ...(body.primaryColor !== undefined ? { primaryColor: body.primaryColor } : {}),
      ...(body.buttonLabel !== undefined ? { buttonLabel: body.buttonLabel } : {}),
      ...(body.size !== undefined ? { size: body.size } : {}),
      ...(body.offsetBottom !== undefined ? { offsetBottom: body.offsetBottom } : {}),
      ...(body.offsetSide !== undefined ? { offsetSide: body.offsetSide } : {}),
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
      userId: staff.id,
    });

    return json({
      widget: {
        id: widget.id,
        name: widget.name,
        enabled: widget.enabled,
        config: nextConfig,
        agent: {
          id: agent.id,
          slug: agent.slug,
          name: agent.name,
          asideText: agent.asideText,
        },
      },
    });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Update failed", 500);
  }
}
