import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json } from "@/lib/api";
import { asStringArray } from "@/lib/utils";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params;
  const form = await prisma.form.findUnique({
    where: { slug },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });
  if (!form || !form.enabled) return error("Form not found", 404);

  return json({
    form: {
      id: form.id,
      title: form.title,
      slug: form.slug,
      description: form.description,
      successText: form.successText,
      fields: form.fields.map((f) => ({
        id: f.id,
        label: f.label,
        name: f.name,
        type: f.type,
        required: f.required,
        placeholder: f.placeholder,
        options: asStringArray(f.options),
      })),
    },
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params;
  const form = await prisma.form.findUnique({
    where: { slug },
    include: { fields: true },
  });
  if (!form || !form.enabled) return error("Form not found", 404);

  try {
    const body = (await req.json()) as { answers?: Record<string, unknown> };
    const answers = body.answers ?? {};

    for (const field of form.fields) {
      const value = answers[field.name];
      const empty =
        value === undefined ||
        value === null ||
        value === false ||
        (typeof value === "string" && !value.trim()) ||
        (Array.isArray(value) && value.length === 0);
      if (field.required && empty) {
        return error(`Поле «${field.label}» обязательно`);
      }
      if (field.type === "EMAIL" && typeof value === "string" && value.trim()) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
          return error(`Некорректный email в поле «${field.label}»`);
        }
      }
    }

    const submission = await prisma.formSubmission.create({
      data: {
        formId: form.id,
        answers: JSON.stringify(answers),
        meta: JSON.stringify({
          userAgent: req.headers.get("user-agent") ?? "",
          ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
        }),
      },
    });

    return json({
      ok: true,
      id: submission.id,
      message: form.successText,
    });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Submit failed", 500);
  }
}
