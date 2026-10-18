import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import {
  createSessionToken,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";

const bodySchema = z.object({
  email: z.string().trim().email("Укажите корректный email").max(120),
  currentPassword: z.string().min(1, "Введите текущий пароль"),
  newPassword: z.string().max(72).optional(),
});

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const user = await prisma.user.findUnique({
    where: { id: admin.id },
    select: { email: true, name: true },
  });
  if (!user) return error("Пользователь не найден", 404);
  return json({ email: user.email, name: user.name });
}

export async function PUT(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  try {
    const body = bodySchema.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { id: admin.id } });
    if (!user || user.role !== "ADMIN") return error("Пользователь не найден", 404);

    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      return error("Неверный текущий пароль", 400);
    }

    const email = body.email.trim().toLowerCase();
    if (email !== user.email.toLowerCase()) {
      const taken = await prisma.user.findUnique({ where: { email } });
      if (taken && taken.id !== user.id) {
        return error("Этот email уже занят", 400);
      }
    }

    const nextPassword = body.newPassword?.trim() || "";
    if (nextPassword && nextPassword.length < 8) {
      return error("Новый пароль — минимум 8 символов", 400);
    }
    const data: { email: string; passwordHash?: string } = { email };
    if (nextPassword) {
      data.passwordHash = await hashPassword(nextPassword);
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
      select: { id: true, email: true, name: true, role: true },
    });

    const token = await createSessionToken({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
    });
    await setSessionCookie(token);

    await writeLog({
      level: "INFO",
      type: "admin_account",
      message: nextPassword
        ? `Админ сменил email и пароль (${updated.email})`
        : `Админ сменил email (${updated.email})`,
      userId: updated.id,
    });

    return json({
      email: updated.email,
      passwordChanged: Boolean(nextPassword),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return error(err.issues[0]?.message ?? "Проверьте поля", 400);
    }
    throw err;
  }
}
