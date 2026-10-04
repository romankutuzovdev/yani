import { z } from "zod";
import { error, json, requireAdmin } from "@/lib/api";
import { readDefaultModel, writeDefaultModel } from "@/llm/pricing";
import { listLLMModels } from "@/llm";

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  return json({ model: readDefaultModel() });
}

export async function PUT(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  try {
    const body = z.object({ model: z.string().min(1) }).parse(await req.json());
    const { models } = await listLLMModels("chat");
    if (models.length && !models.some((m) => m.id === body.model)) {
      return error("Такой модели нет в списке сервиса");
    }
    writeDefaultModel(body.model);
    return json({ model: body.model });
  } catch (e) {
    if (e instanceof z.ZodError) return error("Укажите модель");
    return error(e instanceof Error ? e.message : "Не удалось сохранить", 500);
  }
}
