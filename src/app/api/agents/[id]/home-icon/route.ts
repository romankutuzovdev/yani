import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { error, json, requireAgentStaff, writeLog } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const staff = await requireAgentStaff(id);
  if (staff instanceof Response) return staff;

  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return error("Агент не найден", 404);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return error("Нужна картинка");
  if (!file.type.startsWith("image/")) return error("Нужна картинка PNG, JPG или WebP");
  if (file.size > 5_242_880) return error("Файл больше 5 МБ");

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const dir = path.join(process.cwd(), process.env.UPLOAD_DIR ?? "uploads", "icons");
    await mkdir(dir, { recursive: true });
    const stamp = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    const base = sharp(buffer).rotate();
    await writeFile(
      path.join(dir, `${stamp}-512.png`),
      await base.clone().resize(512, 512, { fit: "cover" }).png().toBuffer(),
    );
    await writeFile(
      path.join(dir, `${stamp}-192.png`),
      await base.clone().resize(192, 192, { fit: "cover" }).png().toBuffer(),
    );
    const homeIconUrl = `/uploads/icons/${stamp}-512.png`;
    await prisma.agent.update({ where: { id }, data: { homeIconUrl } });
    await writeLog({
      type: "agent",
      message: `Uploaded home screen icon for ${agent.name}`,
      agentId: id,
      userId: staff.id,
    });
    return json({ homeIconUrl });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Не удалось сохранить иконку", 400);
  }
}
