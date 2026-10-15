import { z } from "zod";
import { error, json, requireAdmin } from "@/lib/api";
import { resolveLLMProviderName, type ProviderName } from "@/llm";
import { readLLMSettings, writeLLMSettings } from "@/llm/runtimeSettings";
import { clearPricedModelsCache, writeDefaultModel } from "@/llm/pricing";

const SWITCHABLE = ["vibecode", "hoster", "deepseek", "openai"] as const;

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const active = resolveLLMProviderName();
  const stored = readLLMSettings().provider?.trim() || null;
  return json({
    provider: active,
    stored,
    env: (process.env.LLM_PROVIDER ?? "vibecode").trim().toLowerCase(),
    options: SWITCHABLE.map((id) => ({
      id,
      label:
        id === "hoster"
          ? "hoster.by AI"
          : id === "vibecode"
            ? "vibecode.moe"
            : id === "deepseek"
              ? "DeepSeek"
              : "OpenAI",
    })),
  });
}

export async function PUT(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  try {
    const body = z
      .object({ provider: z.enum(SWITCHABLE), defaultModel: z.string().trim().optional() })
      .parse(await req.json());
    writeLLMSettings({ provider: body.provider });
    clearPricedModelsCache();
    if (body.defaultModel) {
      writeDefaultModel(body.defaultModel);
    } else if (body.provider === "hoster") {
      writeDefaultModel(process.env.HOSTER_MODEL ?? "qwen3.8-27b");
    }
    return json({ provider: resolveLLMProviderName() as ProviderName });
  } catch (e) {
    if (e instanceof z.ZodError) return error("Укажите провайдера");
    return error(e instanceof Error ? e.message : "Не удалось сохранить", 500);
  }
}
