import { describe, expect, it, vi } from "vitest";
import { DeepSeekProvider } from "../src/llm/DeepSeekProvider";
import { calculatorTool, datetimeTool } from "../src/tools/builtin";
import { hashApiKey, generateApiKey, slugify } from "../src/lib/utils";
import { resolveCharacterAsset, agentStatusToCharacterState } from "../src/characters/CharacterRenderer";

describe("utils", () => {
  it("hashes api keys consistently", () => {
    const a = hashApiKey("sk_agent_test");
    const b = hashApiKey("sk_agent_test");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("generates sk_agent_ keys", () => {
    const key = generateApiKey();
    expect(key.raw.startsWith("sk_agent_")).toBe(true);
    expect(key.hash).toBe(hashApiKey(key.raw));
  });

  it("slugifies names", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });
});

describe("tools", () => {
  it("calculator evaluates expressions", async () => {
    const result = await calculatorTool.execute({ expression: "(2+3)*4" }, { agentId: "a" });
    expect(result.success).toBe(true);
    expect((result.output as { result: number }).result).toBe(20);
  });

  it("calculator rejects unsafe input", async () => {
    const result = await calculatorTool.execute({ expression: "process.exit(1)" }, { agentId: "a" });
    expect(result.success).toBe(false);
  });

  it("datetime returns iso", async () => {
    const result = await datetimeTool.execute({}, { agentId: "a" });
    expect(result.success).toBe(true);
    expect((result.output as { iso: string }).iso).toMatch(/^\d{4}-/);
  });
});

describe("character renderer", () => {
  it("maps agent status to character state", () => {
    expect(agentStatusToCharacterState("THINKING")).toBe("THINKING");
    expect(agentStatusToCharacterState("IDLE")).toBe("IDLE");
  });

  it("falls back to idle asset", () => {
    const asset = resolveCharacterAsset(
      [
        { state: "IDLE", type: "IMAGE", url: "/idle.png", mimeType: "image/png" },
        { state: "WORKING", type: "IMAGE", url: "/work.png", mimeType: "image/png" },
      ],
      "SPEAKING",
    );
    expect(asset?.url).toBe("/idle.png");
  });
});

describe("DeepSeekProvider", () => {
  it("throws without API key", async () => {
    const provider = new DeepSeekProvider({ apiKey: "" });
    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      /DEEPSEEK_API_KEY/,
    );
  });

  it("parses chat response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "deepseek-chat",
        choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new DeepSeekProvider({ apiKey: "test-key" });
    const res = await provider.chat([{ role: "user", content: "hi" }]);
    expect(res.content).toBe("hello");
    expect(res.usage?.totalTokens).toBe(2);
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
