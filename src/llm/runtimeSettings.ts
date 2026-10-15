import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const SETTINGS_FILE = path.join(process.cwd(), "prisma", "data", "llm-settings.json");

export type LLMRuntimeSettings = {
  defaultModel?: string;
  /** vibecode | hoster | deepseek | openai — overrides LLM_PROVIDER when set */
  provider?: string;
};

export function readLLMSettings(): LLMRuntimeSettings {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as LLMRuntimeSettings;
  } catch {
    return {};
  }
}

export function writeLLMSettings(patch: Partial<LLMRuntimeSettings>) {
  mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  const current = readLLMSettings();
  const next: LLMRuntimeSettings = { ...current, ...patch };
  if (patch.defaultModel !== undefined) {
    next.defaultModel = patch.defaultModel.trim();
  }
  if (patch.provider !== undefined) {
    const value = patch.provider.trim().toLowerCase();
    if (value) next.provider = value;
    else delete next.provider;
  }
  writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
}
