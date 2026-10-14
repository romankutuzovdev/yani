import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { issueOrgAccess, saveOrgProfile } from "@/lib/orgAccess";

type Params = { params: Promise<{ id: string }> };

const profileSchema = z.object({
  orgName: z.string().trim().max(200).optional(),
  orgUnp: z.string().trim().max(32).optional(),
  planName: z.string().trim().max(120).optional(),
  planMonthlyPrice: z.number().min(0).max(1_000_000_000).optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  const body = profileSchema.parse(await req.json().catch(() => ({})));

  const issued = await issueOrgAccess(id, body);
  if (!issued) return error("Агент не найден", 404);

  await writeLog({
    type: "agent",
    message: `Issued organization access ${issued.email}`,
    agentId: id,
    userId: admin.id,
  });

  return json(issued);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  try {
    const body = profileSchema.parse(await req.json());
    const saved = await saveOrgProfile(id, body);
    if (!saved) return error("Сначала сгенерируйте доступ", 404);
    return json(saved);
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Некорректные данные");
    return error("Не удалось сохранить", 500);
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  const user = await prisma.user.findFirst({
    where: { orgAgentId: id, role: "ORG" },
    select: { email: true, orgName: true, orgUnp: true, planName: true, planMonthlyPrice: true },
  });
  return json({
    email: user?.email ?? "",
    orgName: user?.orgName ?? "",
    orgUnp: user?.orgUnp ?? "",
    planName: user?.planName ?? "",
    planMonthlyPrice: user?.planMonthlyPrice ?? 0,
  });
}
