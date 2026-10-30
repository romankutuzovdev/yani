import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, writeLog } from "@/lib/api";
import { crmPlaybookForAgent } from "@/lib/crm";
import { encryptCrmSecret } from "@/lib/crmSecrets";
import { instagramGetMe, instagramVerifyToken, instagramWebhookUrl, normalizeInstagramToken } from "@/lib/instagram";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  agentId: z.string().optional(),
  token: z.string().trim().min(20, "Вставьте токен Instagram"),
});

function publicConnection(connection: {
  id: string;
  status: string;
  config: string;
  lastError: string;
  updatedAt: Date;
} | null) {
  if (!connection) return null;
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(connection.config);
  } catch {
    config = {};
  }
  return {
    id: connection.id,
    status: connection.status,
    username: String(config.username ?? ""),
    igUserId: String(config.igUserId ?? ""),
    lastError: connection.lastError,
    updatedAt: connection.updatedAt,
    webhookUrl: instagramWebhookUrl(),
    verifyToken: instagramVerifyToken(),
  };
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const playbook = await crmPlaybookForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (playbook instanceof Response) return playbook;
  const connection = await prisma.crmChannelConnection.findUnique({
    where: { playbookId_type: { playbookId: id, type: "INSTAGRAM" } },
  });
  return json({
    connection: publicConnection(connection),
    webhookUrl: instagramWebhookUrl(),
    verifyToken: instagramVerifyToken(),
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = schema.parse(await req.json());
    const playbook = await crmPlaybookForAgent(id, body.agentId);
    if (playbook instanceof Response) return playbook;
    const token = normalizeInstagramToken(body.token);
    if (token === instagramVerifyToken()) {
      return error("Это маркер вебхука, не токен аккаунта. В Meta откройте сценарий Instagram и сгенерируйте токен доступа.");
    }
    const profile = await instagramGetMe(token);
    const connection = await prisma.crmChannelConnection.upsert({
      where: { playbookId_type: { playbookId: id, type: "INSTAGRAM" } },
      create: {
        playbookId: id,
        type: "INSTAGRAM",
        encryptedSecret: encryptCrmSecret(
          JSON.stringify({ accessToken: profile.accessToken, igUserId: profile.userId, host: profile.host }),
        ),
        config: JSON.stringify({
          username: profile.username,
          igUserId: profile.userId,
          igScopedId: profile.id,
          host: profile.host,
        }),
      },
      update: {
        status: "CONNECTED",
        encryptedSecret: encryptCrmSecret(
          JSON.stringify({ accessToken: profile.accessToken, igUserId: profile.userId, host: profile.host }),
        ),
        config: JSON.stringify({
          username: profile.username,
          igUserId: profile.userId,
          igScopedId: profile.id,
          host: profile.host,
        }),
        lastError: "",
      },
    });
    await writeLog({
      type: "crm_channel",
      message: `К навыку «${playbook.name}» подключён Instagram @${profile.username || profile.userId}`,
      agentId: playbook.agentId,
      meta: { playbookId: id, connectionId: connection.id },
    });
    return json({ connection: publicConnection(connection) });
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Проверьте токен");
    return error(cause instanceof Error ? cause.message : "Не удалось подключить Instagram", 400);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const playbook = await crmPlaybookForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (playbook instanceof Response) return playbook;
  await prisma.crmChannelConnection.deleteMany({ where: { playbookId: id, type: "INSTAGRAM" } });
  await writeLog({
    type: "crm_channel",
    message: `От навыка «${playbook.name}» отключён Instagram`,
    agentId: playbook.agentId,
    meta: { playbookId: id },
  });
  return json({ ok: true });
}
