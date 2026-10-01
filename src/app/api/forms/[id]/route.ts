import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { asStringArray, slugify } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

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

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  successText: z.string().optional(),
  fields: z.array(fieldSchema).optional(),
});

function fieldNameFromLabel(label: string, fallback: string) {
  const base = slugify(label).replace(/-/g, "_") || fallback;
  return base.slice(0, 40);
}

function serializeForm<T extends { fields: Array<{ options: string }> }>(form: T) {
  return {
    ...form,
    fields: form.fields.map((f) => ({
      ...f,
      options: asStringArray(f.options),
    })),
  };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;

  const form = await prisma.form.findUnique({
    where: { id },
    include: {
      fields: { orderBy: { sortOrder: "asc" } },
      submissions: { orderBy: { createdAt: "desc" }, take: 100 },
      _count: { select: { submissions: true } },
    },
  });
  if (!form) return error("Form not found", 404);

  return json({
    form: {
      ...serializeForm(form),
      submissions: form.submissions.map((s) => ({
        ...s,
        answers: (() => {
          try {
            return JSON.parse(s.answers) as Record<string, unknown>;
          } catch {
            return {};
          }
        })(),
      })),
    },
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;

  try {
    const body = updateSchema.parse(await req.json());
    const existing = await prisma.form.findUnique({ where: { id } });
    if (!existing) return error("Form not found", 404);

    if (body.slug && body.slug !== existing.slug) {
      const clash = await prisma.form.findUnique({ where: { slug: body.slug } });
      if (clash) return error("Slug already taken");
    }

    if (body.fields) {
      await prisma.formField.deleteMany({ where: { formId: id } });
      await prisma.formField.createMany({
        data: body.fields.map((f, i) => ({
          formId: id,
          label: f.label,
          name: f.name?.trim() || fieldNameFromLabel(f.label, `field_${i + 1}`),
          type: f.type,
          required: f.required ?? false,
          placeholder: f.placeholder ?? "",
          options: JSON.stringify(f.options ?? []),
          sortOrder: f.sortOrder ?? i,
        })),
      });
    }

    const form = await prisma.form.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.slug !== undefined ? { slug: slugify(body.slug) || existing.slug } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.successText !== undefined ? { successText: body.successText } : {}),
      },
      include: { fields: { orderBy: { sortOrder: "asc" } } },
    });

    await writeLog({
      type: "form",
      message: `Updated form ${form.title}`,
      userId: admin.id,
    });

    return json({ form: serializeForm(form) });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Update failed", 500);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  const form = await prisma.form.delete({ where: { id } });
  await writeLog({
    type: "form",
    message: `Deleted form ${form.title}`,
    userId: admin.id,
  });
  return json({ ok: true });
}
