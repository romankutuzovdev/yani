import { error, json, requireAdmin } from "@/lib/api";
import { listLLMModels, type LLMModelKind } from "@/llm";

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const kindParam = new URL(req.url).searchParams.get("kind") ?? "chat";
  const kind: LLMModelKind =
    kindParam === "image" || kindParam === "all" || kindParam === "chat"
      ? kindParam
      : "chat";

  try {
    const { provider, models } = await listLLMModels(kind);
    return json({ provider, models });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load models";
    return error(message, 502);
  }
}
