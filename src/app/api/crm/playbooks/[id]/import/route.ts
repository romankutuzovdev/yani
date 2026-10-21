import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, writeLog } from "@/lib/api";
import { crmPlaybookForAgent, leadIdentities } from "@/lib/crm";
import { buildImportPreview, parseImportFile, type CrmImportPreviewRow } from "@/lib/crmImport";
import { writeCrmAudit } from "@/lib/crmAudit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const confirmSchema = z.object({
  agentId: z.string().optional(),
  jobId: z.string().min(1),
});

async function readUpload(req: NextRequest) {
  const form = await req.formData();
  const agentId = String(form.get("agentId") ?? "").trim() || undefined;
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("Прикрепите CSV или XLSX файл");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!buffer.length) throw new Error("Файл пустой");
  if (buffer.length > 5 * 1024 * 1024) throw new Error("Файл больше 5 МБ");
  return { agentId, fileName: file.name || "import.csv", buffer };
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const playbook = await crmPlaybookForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (playbook instanceof Response) return playbook;
  const jobs = await prisma.crmImportJob.findMany({
    where: { playbookId: id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return json({ jobs });
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const body = confirmSchema.parse(await req.json());
      const playbook = await crmPlaybookForAgent(id, body.agentId);
      if (playbook instanceof Response) return playbook;

      const job = await prisma.crmImportJob.findFirst({
        where: { id: body.jobId, playbookId: playbook.id },
      });
      if (!job) return error("Импорт не найден", 404);
      if (job.status === "IMPORTED") return error("Этот импорт уже применён", 409);

      const report = JSON.parse(job.reportJson) as { rows?: CrmImportPreviewRow[] };
      const rows = (report.rows ?? []).filter((row) => row.status === "OK");
      let createdCount = 0;
      const createdLeadIds: string[] = [];

      await prisma.$transaction(async (tx) => {
        for (const row of rows) {
          const identities = leadIdentities(row);
          if (!identities.length) continue;
          const duplicate = await tx.leadIdentity.findFirst({
            where: {
              playbookId: playbook.id,
              OR: identities.map((identity) => ({
                type: identity.type,
                value: identity.value,
              })),
            },
          });
          if (duplicate) continue;

          const lead = await tx.salesLead.create({
            data: {
              playbookId: playbook.id,
              displayName: row.displayName,
              company: row.company,
              email: row.email,
              phone: row.phone,
              telegram: row.telegram,
              notes: row.notes,
              stage: "NEW",
            },
          });
          await tx.leadIdentity.createMany({
            data: identities.map((identity) => ({
              playbookId: playbook.id,
              leadId: lead.id,
              ...identity,
            })),
          });
          createdLeadIds.push(lead.id);
          createdCount += 1;
        }

        await tx.crmImportJob.update({
          where: { id: job.id },
          data: {
            status: "IMPORTED",
            createdCount,
            completedAt: new Date(),
            reportJson: JSON.stringify({
              ...report,
              createdLeadIds,
            }),
          },
        });
      });

      await writeLog({
        level: "INFO",
        type: "crm.import",
        message: "CRM import applied",
        agentId: playbook.agentId,
        meta: { playbookId: playbook.id, jobId: job.id, createdCount },
      });
      await writeCrmAudit({
        playbookId: playbook.id,
        agentId: playbook.agentId,
        action: "import.applied",
        entityType: "CrmImportJob",
        entityId: job.id,
        summary: `Импорт ${job.fileName}: создано ${createdCount}`,
        meta: { createdCount },
      });

      return json({
        job: await prisma.crmImportJob.findUnique({ where: { id: job.id } }),
        createdCount,
        createdLeadIds,
      });
    }

    const upload = await readUpload(req);
    const playbook = await crmPlaybookForAgent(id, upload.agentId);
    if (playbook instanceof Response) return playbook;

    const parsed = parseImportFile(upload.buffer, upload.fileName);
    const existing = await prisma.leadIdentity.findMany({
      where: { playbookId: playbook.id },
      select: { type: true, value: true },
    });
    const rows = buildImportPreview(parsed, existing);
    const validRows = rows.filter((row) => row.status === "OK").length;
    const duplicateCount = rows.filter((row) => row.status === "DUPLICATE").length;
    const skippedCount = rows.filter((row) => row.status === "SKIPPED").length;

    const job = await prisma.crmImportJob.create({
      data: {
        playbookId: playbook.id,
        fileName: upload.fileName,
        status: "PREVIEW",
        totalRows: rows.length,
        validRows,
        duplicateCount,
        skippedCount,
        reportJson: JSON.stringify({
          rows: rows.slice(0, 500),
          truncated: rows.length > 500,
        }),
      },
    });

    return json({ job, rows: rows.slice(0, 100) }, { status: 201 });
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Проверьте запрос");
    return error(cause instanceof Error ? cause.message : "Не удалось обработать импорт", 400);
  }
}
