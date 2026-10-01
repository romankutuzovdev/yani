import { prisma } from "@/lib/db";
import { asStringArray, jsonString } from "@/lib/utils";
import { createLLMProvider, type LLMProvider, type LLMToolDefinition, type Message } from "@/llm";
import { ensureToolsRegistered, getTool, getToolsByNames, listTools, type AgentTool } from "@/tools";
import { registerMemoryTool, formatMemoryForPrompt, getRelevantMemory, writeMemory } from "@/memory";
import type { Agent, AgentStatus, Skill } from "@prisma/client";

export interface AgentEngineLimits {
  maxIterations: number;
  timeoutMs: number;
  maxTokens: number;
  maxToolCalls: number;
}

export interface RunTaskInput {
  agentId: string;
  instruction: string;
  taskId?: string;
  executionId?: string;
  userId?: string;
  sessionId?: string;
  skillIds?: string[];
  toolNames?: string[];
  limits?: Partial<AgentEngineLimits>;
  onStatus?: (status: AgentStatus, message?: string) => Promise<void> | void;
  onEvent?: (event: { type: string; summary: string; data?: unknown }) => Promise<void> | void;
  signal?: AbortSignal;
}

export interface OfferedForm {
  url: string;
  title: string;
  reason?: string;
}

export interface RunTaskResult {
  success: boolean;
  result: string;
  iterations: number;
  error?: string;
  cancelled?: boolean;
  forms?: OfferedForm[];
}

const DEFAULT_LIMITS: AgentEngineLimits = {
  maxIterations: 10,
  timeoutMs: 120_000,
  maxTokens: 4096,
  maxToolCalls: 20,
};

const FORM_MARKER_RE = /\[\[form:(https?:\/\/[^\]|]+)(?:\|([^\]]+))?\]\]/gi;

function parseFormMarkers(text: string): OfferedForm[] {
  const forms: OfferedForm[] = [];
  for (const match of text.matchAll(FORM_MARKER_RE)) {
    forms.push({
      url: match[1],
      title: (match[2] ?? "Форма").trim() || "Форма",
    });
  }
  return forms;
}

function stripFormMarkers(text: string): string {
  return text.replace(FORM_MARKER_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

function playbookBlock(agent: Agent): string {
  const playbook = agent.additionalInstructions?.trim();
  if (!playbook) return "";
  return [
    "",
    "=== WORKING PLAYBOOK (follow strictly) ===",
    playbook,
    "=== END PLAYBOOK ===",
    "",
    "If the playbook says to offer a form/link for a topic the user asks about,",
    "call the offer_form tool with that exact URL (and a short title).",
    "You may also include [[form:URL|Title]] in your final answer.",
    "Do not invent URLs that are not in the playbook.",
  ].join("\n");
}

function buildSystemPrompt(agent: Agent, skills: Skill[], memoryBlock: string): string {
  const skillsBlock = skills.length
    ? `\nActive skills:\n${skills.map((s) => `- ${s.name}: ${s.description}${s.systemPrompt ? `\n  ${s.systemPrompt}` : ""}`).join("\n")}`
    : "";
  const memory = memoryBlock ? `\nRelevant memory:\n${memoryBlock}` : "";

  if (agent.systemPrompt?.trim()) {
    return [agent.systemPrompt.trim(), skillsBlock, memory, playbookBlock(agent)]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `You are ${agent.name}, an AI agent.`,
    `Role: ${agent.role}`,
    `Personality: ${agent.personality}`,
    `Communication style: ${agent.communicationStyle}`,
    agent.goals ? `Goals: ${agent.goals}` : "",
    agent.rules ? `Rules: ${agent.rules}` : "",
    agent.restrictions ? `Restrictions: ${agent.restrictions}` : "",
    skillsBlock,
    memory,
    playbookBlock(agent),
    "",
    "You can use tools when needed. Prefer concise, actionable results.",
    "Do not reveal hidden chain-of-thought. Provide clear summaries of actions.",
    "Reply in the same language the user uses (usually Russian).",
  ]
    .filter(Boolean)
    .join("\n");
}

function toToolDefs(tools: AgentTool[]): LLMToolDefinition[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export class AgentEngine {
  private llm: LLMProvider;

  constructor(llm?: LLMProvider) {
    ensureToolsRegistered();
    registerMemoryTool();
    this.llm = llm ?? createLLMProvider("deepseek");
  }

  async run(input: RunTaskInput): Promise<RunTaskResult> {
    const agent = await prisma.agent.findUnique({
      where: { id: input.agentId },
      include: {
        skills: { include: { skill: true }, where: { enabled: true } },
        tools: { include: { tool: true }, where: { enabled: true } },
      },
    });

    if (!agent) {
      return { success: false, result: "", iterations: 0, error: "Agent not found" };
    }
    if (!agent.enabled) {
      return { success: false, result: "", iterations: 0, error: "Agent is disabled" };
    }

    const limits: AgentEngineLimits = {
      maxIterations: input.limits?.maxIterations ?? agent.maxIterations ?? DEFAULT_LIMITS.maxIterations,
      timeoutMs: input.limits?.timeoutMs ?? agent.timeoutMs ?? DEFAULT_LIMITS.timeoutMs,
      maxTokens: input.limits?.maxTokens ?? agent.maxTokens ?? DEFAULT_LIMITS.maxTokens,
      maxToolCalls: input.limits?.maxToolCalls ?? DEFAULT_LIMITS.maxToolCalls,
    };

    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    input.signal?.addEventListener("abort", onParentAbort);
    const timeout = setTimeout(() => controller.abort(), limits.timeoutMs);

    const emit = async (type: string, summary: string, data?: unknown) => {
      await input.onEvent?.({ type, summary, data });
      if (input.executionId) {
        await prisma.executionEvent.create({
          data: {
            executionId: input.executionId,
            type,
            summary,
            data: jsonString(data ?? {}, "{}"),
          },
        });
      }
    };

    const setStatus = async (status: AgentStatus, message = "") => {
      await prisma.agent.update({
        where: { id: agent.id },
        data: { status, statusMessage: message },
      });
      await input.onStatus?.(status, message);
    };

    let iterations = 0;
    let toolCalls = 0;

    try {
      await setStatus("THINKING", "Анализирую задачу");
      await emit("task_started", "Задача начата");

      let skills = agent.skills.map((s) => s.skill).filter((s) => s.enabled);
      if (input.skillIds?.length) {
        skills = skills.filter((s) => input.skillIds!.includes(s.id));
      }

      const skillToolNames = skills.flatMap((s) => asStringArray(s.tools));
      const agentToolNames = agent.tools.filter((t) => t.tool.enabled).map((t) => t.tool.name);
      const requested = input.toolNames?.length
        ? input.toolNames
        : Array.from(new Set([...skillToolNames, ...agentToolNames]));

      let tools = getToolsByNames(requested.length ? requested : listTools().map((t) => t.name));
      if (!tools.length) tools = listTools();
      // Always allow offering forms from the playbook
      if (!tools.some((t) => t.name === "offer_form")) {
        const offer = getTool("offer_form");
        if (offer) tools = [...tools, offer];
      }

      await emit(
        "plan",
        `Выбрано навыков: ${skills.length}, инструментов: ${tools.length}`,
        { skills: skills.map((s) => s.name), tools: tools.map((t) => t.name) },
      );

      const memory = await getRelevantMemory({
        agentId: agent.id,
        query: input.instruction.slice(0, 200),
        userId: input.userId,
      });
      const memoryBlock = formatMemoryForPrompt(memory);

      const messages: Message[] = [
        { role: "system", content: buildSystemPrompt(agent, skills, memoryBlock) },
        {
          role: "user",
          content: `Задача:\n${input.instruction}\n\nДай лучший итоговый ответ. Используй инструменты, если это помогает.`,
        },
      ];

      let finalResult = "";
      const offeredForms: OfferedForm[] = [];
      const pushForm = (form: OfferedForm) => {
        if (!offeredForms.some((f) => f.url === form.url)) {
          offeredForms.push(form);
        }
      };

      while (iterations < limits.maxIterations) {
        if (controller.signal.aborted) {
          await setStatus("ERROR", "Отменено или истекло время");
          await emit("cancelled", "Выполнение отменено или истекло время");
          return {
            success: false,
            result: finalResult,
            iterations,
            error: "Отменено или истекло время",
            cancelled: true,
          };
        }

        iterations += 1;
        await setStatus("THINKING", `Думаю (шаг ${iterations})`);
        await emit("iteration", `Итерация ${iterations}`);

        const response = await this.llm.chat(messages, {
          model: agent.model,
          temperature: agent.temperature,
          maxTokens: limits.maxTokens,
          tools: toToolDefs(tools),
          signal: controller.signal,
        });

        if (response.usage) {
          await prisma.usageRecord.create({
            data: {
              agentId: agent.id,
              provider: response.provider,
              model: response.model,
              inputTokens: response.usage.inputTokens,
              outputTokens: response.usage.outputTokens,
              totalTokens: response.usage.totalTokens,
              // TODO: accurate pricing table per model
              estimatedCost: 0,
              requestType: "agent_run",
            },
          });
        }

        if (response.toolCalls?.length) {
          messages.push({
            role: "assistant",
            content: response.content || "",
          });

          for (const call of response.toolCalls) {
            if (toolCalls >= limits.maxToolCalls) {
              await emit("tool_limit", "Достигнут лимит вызовов инструментов");
              break;
            }
            toolCalls += 1;
            await setStatus("WORKING", `Использую инструмент: ${call.name}`);
            await emit("tool_selected", `Выбран инструмент: ${call.name}`, {
              tool: call.name,
              input: call.arguments,
            });

            let parsedArgs: unknown = {};
            try {
              parsedArgs = call.arguments ? JSON.parse(call.arguments) : {};
            } catch {
              parsedArgs = { raw: call.arguments };
            }

            const tool = getTool(call.name);
            let toolResultText: string;
            if (!tool) {
              toolResultText = JSON.stringify({ success: false, error: `Unknown tool: ${call.name}` });
              await emit("tool_error", `Неизвестный инструмент: ${call.name}`);
            } else {
              try {
                const result = await tool.execute(parsedArgs, {
                  agentId: agent.id,
                  taskId: input.taskId,
                  executionId: input.executionId,
                  userId: input.userId,
                  sessionId: input.sessionId,
                  signal: controller.signal,
                });
                toolResultText = JSON.stringify(result);
                if (
                  result.success &&
                  call.name === "offer_form" &&
                  result.output &&
                  typeof result.output === "object"
                ) {
                  const d = result.output as { url?: string; title?: string; reason?: string };
                  if (d.url) {
                    pushForm({
                      url: d.url,
                      title: d.title ?? "Форма",
                      reason: d.reason,
                    });
                  }
                }
                await emit(
                  result.success ? "tool_result" : "tool_error",
                  result.success
                    ? `Инструмент ${call.name} выполнен`
                    : `Инструмент ${call.name} завершился с ошибкой`,
                  { tool: call.name, result },
                );
              } catch (e) {
                toolResultText = JSON.stringify({
                  success: false,
                  error: e instanceof Error ? e.message : "Tool failed",
                });
                await emit("tool_error", `Инструмент ${call.name} упал с ошибкой`);
              }
            }

            messages.push({
              role: "tool",
              name: call.name,
              toolCallId: call.id,
              content: toolResultText,
            });
          }
          continue;
        }

        finalResult = response.content?.trim() || "Ответ не сформирован.";
        for (const form of parseFormMarkers(finalResult)) pushForm(form);
        const cleanResult = stripFormMarkers(finalResult) || finalResult;
        await emit("final_result", "Задача завершена", {
          preview: cleanResult.slice(0, 500),
          forms: offeredForms,
        });
        await writeMemory({
          agentId: agent.id,
          content: `Результат задачи: ${cleanResult.slice(0, 2000)}`,
          type: "TASK",
          taskId: input.taskId,
          userId: input.userId,
          metadata: { instruction: input.instruction.slice(0, 500) },
        });
        await setStatus("SUCCESS", "Задача выполнена");
        return {
          success: true,
          result: cleanResult,
          iterations,
          forms: offeredForms,
        };
      }

      await setStatus("ERROR", "Достигнут лимит итераций");
      await emit("error", "Достигнут лимит итераций");
      return {
        success: false,
        result: finalResult,
        iterations,
        error: "Достигнут лимит итераций",
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Ошибка выполнения агента";
      await setStatus("ERROR", message);
      await emit("error", message);
      return { success: false, result: "", iterations, error: message };
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onParentAbort);
      setTimeout(() => {
        void prisma.agent
          .updateMany({
            where: { id: agent.id, status: { in: ["SUCCESS", "ERROR"] } },
            data: { status: "IDLE", statusMessage: "" },
          })
          .catch(() => undefined);
      }, 4000);
    }
  }
}

export const agentEngine = new AgentEngine();
