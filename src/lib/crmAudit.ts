import { prisma } from "@/lib/db";
import { writeLog } from "@/lib/api";

export async function writeCrmAudit(input: {
  playbookId?: string | null;
  agentId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  summary: string;
  meta?: Record<string, unknown>;
}) {
  try {
    await prisma.crmAuditEvent.create({
      data: {
        playbookId: input.playbookId ?? null,
        agentId: input.agentId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType ?? "",
        entityId: input.entityId ?? "",
        summary: input.summary.slice(0, 500),
        meta: JSON.stringify(input.meta ?? {}),
      },
    });
  } catch (cause) {
    console.error("[crm-audit]", cause instanceof Error ? cause.message : cause);
  }

  await writeLog({
    level: "INFO",
    type: `crm.audit.${input.action}`,
    message: input.summary,
    agentId: input.agentId ?? undefined,
    userId: input.userId ?? undefined,
    meta: {
      playbookId: input.playbookId,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(input.meta ?? {}),
    },
  });
}
