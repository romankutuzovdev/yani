import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { json, requireAdmin, writeLog } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  const key = await prisma.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  await writeLog({
    type: "api_key",
    message: `Revoked API key ${key.name}`,
    userId: admin.id,
  });
  return json({ ok: true });
}
