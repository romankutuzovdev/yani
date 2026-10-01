import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  createSessionToken,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { error, json, writeLog } from "@/lib/api";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function POST(req: NextRequest) {
  try {
    const body = loginSchema.parse(await req.json());
    let user = await prisma.user.findUnique({ where: { email: body.email } });

    // Bootstrap admin if DB empty
    if (!user && body.email === (process.env.ADMIN_EMAIL ?? "admin@yani.local")) {
      const count = await prisma.user.count();
      if (count === 0) {
        user = await prisma.user.create({
          data: {
            email: body.email,
            name: "Admin",
            role: "ADMIN",
            passwordHash: await hashPassword(body.password),
          },
        });
      }
    }

    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return error("Invalid credentials", 401);
    }

    const token = await createSessionToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
    await setSessionCookie(token);
    await writeLog({
      type: "auth",
      message: `User logged in: ${user.email}`,
      userId: user.id,
    });

    return json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Login failed", 500);
  }
}
