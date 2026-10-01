import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { generateApiKey, asStringArray } from "@/lib/utils";

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scopes: true,
      rateLimit: true,
      agentId: true,
      revokedAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });
  return json({
    keys: keys.map((k) => ({ ...k, scopes: asStringArray(k.scopes) })),
  });
}

const createSchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  rateLimit: z.number().int().positive().optional(),
  agentId: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  try {
    const body = createSchema.parse(await req.json());
    const generated = generateApiKey();
    const key = await prisma.apiKey.create({
      data: {
        name: body.name,
        keyHash: generated.hash,
        keyPrefix: generated.prefix,
        scopes: JSON.stringify(body.scopes ?? ["chat", "tasks", "status"]),
        rateLimit: body.rateLimit ?? 60,
        agentId: body.agentId ?? null,
        userId: admin.id,
      },
    });
    await writeLog({
      type: "api_key",
      message: `Created API key ${key.name}`,
      userId: admin.id,
    });
    return json({
      key: {
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        scopes: asStringArray(key.scopes),
        rateLimit: key.rateLimit,
        agentId: key.agentId,
        createdAt: key.createdAt,
      },
      rawKey: generated.raw,
    }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Failed", 500);
  }
}
