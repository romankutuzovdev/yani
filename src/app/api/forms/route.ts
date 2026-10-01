import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { asStringArray, slugify } from "@/lib/utils";

const fieldSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  name: z.string().min(1).optional(),
  type: z.enum(["TEXT", "TEXTAREA", "EMAIL", "PHONE", "NUMBER", "SELECT", "CHECKBOX", "DATE"]),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
  sortOrder: z.number().int().optional(),
});

const createSchema = z.object({
  title: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  successText: z.string().optional(),
  fields: z.array(fieldSchema).optional(),
});

function fieldNameFromLabel(label: string, fallback: string) {
  const base = slugify(label).replace(/-/g, "_") || fallback;
  return base.slice(0, 40);
}

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const forms = await prisma.form.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { fields: true, submissions: true } },
    },
  });

  return json({ forms });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  try {
    const body = createSchema.parse(await req.json());
    let slug = (body.slug?.trim() || slugify(body.title) || `form-${Date.now()}`).slice(0, 60);
    const exists = await prisma.form.findUnique({ where: { slug } });
    if (exists) slug = `${slug}-${Date.now().toString(36)}`;

    const form = await prisma.form.create({
      data: {
        title: body.title,
        slug,
        description: body.description ?? "",
        enabled: body.enabled ?? true,
        successText: body.successText ?? "Спасибо! Ответ отправлен.",
        ownerId: admin.id,
        fields: body.fields?.length
          ? {
              create: body.fields.map((f, i) => ({
                label: f.label,
                name: f.name?.trim() || fieldNameFromLabel(f.label, `field_${i + 1}`),
                type: f.type,
                required: f.required ?? false,
                placeholder: f.placeholder ?? "",
                options: JSON.stringify(f.options ?? []),
                sortOrder: f.sortOrder ?? i,
              })),
            }
          : undefined,
      },
      include: { fields: { orderBy: { sortOrder: "asc" } } },
    });

    await writeLog({
      type: "form",
      message: `Created form ${form.title}`,
      userId: admin.id,
    });

    return json(
      {
        form: {
          ...form,
          fields: form.fields.map((f) => ({
            ...f,
            options: asStringArray(f.options),
          })),
        },
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Failed", 500);
  }
}
