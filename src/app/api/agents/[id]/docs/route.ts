import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { extractDocxText, extractPlainText } from "@/lib/docx";
import { saveUploadedTextFile } from "@/lib/uploads";

type Params = { params: Promise<{ id: string }> };

const docView = {
  id: true,
  title: true,
  fileName: true,
  url: true,
  openMode: true,
  sortOrder: true,
  createdAt: true,
} as const;

function openModeOf(value: FormDataEntryValue | null) {
  return value === "direct" ? "direct" : "preview";
}

function titleFromFile(name: string) {
  const base = name.replace(/\.(txt|md|markdown|docx|pdf)$/i, "").trim();
  return (base || name).slice(0, 120);
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const staff = await requireAdmin();
  if (staff instanceof Response) return staff;
  const agent = await prisma.agent.findUnique({ where: { id }, select: { id: true } });
  if (!agent) return error("Агент не найден", 404);
  const docs = await prisma.agentDoc.findMany({
    where: { agentId: id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: docView,
  });
  return json({ docs });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const staff = await requireAdmin();
  if (staff instanceof Response) return staff;
  const agent = await prisma.agent.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!agent) return error("Агент не найден", 404);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return error("Нужен файл");

  try {
    const saved = await saveUploadedTextFile(file);
    const lower = saved.originalName.toLowerCase();
    const text = lower.endsWith(".pdf")
      ? ""
      : lower.endsWith(".docx")
        ? await extractDocxText(saved.buffer)
        : extractPlainText(saved.buffer);
    const last = await prisma.agentDoc.findFirst({
      where: { agentId: id },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const doc = await prisma.agentDoc.create({
      data: {
        agentId: id,
        title: titleFromFile(saved.originalName),
        fileName: saved.originalName.slice(0, 180),
        url: saved.url,
        mimeType: saved.mimeType,
        openMode: openModeOf(form.get("openMode")),
        text,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
      select: docView,
    });
    await writeLog({
      type: "agent",
      message: `Added document ${doc.title} to ${agent.name}`,
      agentId: id,
      userId: staff.id,
    });
    return json({ doc });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Не удалось загрузить", 400);
  }
}
