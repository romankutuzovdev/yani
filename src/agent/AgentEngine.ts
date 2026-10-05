import { prisma } from "@/lib/db";
import { asStringArray, jsonString } from "@/lib/utils";
import {
  createLLMProvider,
  type LLMOptions,
  type LLMProvider,
  type LLMResponse,
  type LLMToolCall,
  type LLMToolDefinition,
  type Message,
} from "@/llm";
import { estimateUsd, readDefaultModel } from "@/llm/pricing";
import { ensureToolsRegistered, getTool, getToolsByNames, listTools, type AgentTool } from "@/tools";
import { registerMemoryTool, formatMemoryForPrompt, getRelevantMemory, writeMemory } from "@/memory";
import { enqueueMilli } from "@/lib/milliQueue";
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
  /** Called as soon as the model emits visible text, before the full reply is ready. */
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface RunTaskResult {
  success: boolean;
  result: string;
  iterations: number;
  error?: string;
  cancelled?: boolean;
}

const DEFAULT_LIMITS: AgentEngineLimits = {
  maxIterations: 10,
  timeoutMs: 120_000,
  maxTokens: 4096,
  maxToolCalls: 20,
};

function playbookBlock(agent: Agent): string {
  const playbook = agent.additionalInstructions?.trim();
  if (!playbook) return "";
  return ["", "=== WORKING PLAYBOOK (follow strictly) ===", playbook, "=== END PLAYBOOK ==="].join(
    "\n",
  );
}

function skillPromptBlock(skill: Skill, chosen: boolean): string {
  const lines = [
    `=== НАВЫК «${skill.name}» ===`,
    chosen
      ? "Пользователь выбрал этот навык. Отвечай строго по его промпту."
      : "Навык не выбран. Это один из доступных материалов, не отдельный режим ответа.",
    "Если промпт навыка требует держаться прикреплённого текста — не выходи за него и не дополняй общими знаниями.",
  ];
  if (skill.description?.trim() && skill.description.trim() !== skill.name.trim()) {
    lines.push(`Описание: ${skill.description.trim()}`);
  }
  if (skill.systemPrompt?.trim()) {
    lines.push("ОБЩИЙ ПРОМПТ НАВЫКА (выполняй дословно):", skill.systemPrompt.trim());
  }
  if (skill.documentText?.trim()) {
    const label = skill.documentName?.trim() || "прикреплённый текст";
    lines.push(
      `ПРИКРЕПЛЁННЫЙ ТЕКСТ (${label}) — источник для ответа:`,
      "---",
      skill.documentText.trim(),
      "---",
      "Факты бери только из этого текста. Если ответа в тексте нет — прямо скажи, что в тексте этого нет.",
    );
  }
  lines.push(`=== КОНЕЦ НАВЫКА «${skill.name}» ===`);
  return lines.join("\n");
}

function buildSystemPrompt(
  agent: Agent,
  skills: Skill[],
  memoryBlock: string,
  skillChosen: boolean,
): string {
  const skillsBlock = skills.length
    ? [
        "",
        skillChosen ? "ВЫБРАННЫЙ НАВЫК" : "НАВЫК НЕ ВЫБРАН. МАТЕРИАЛЫ ВСЕХ НАЗНАЧЕННЫХ НАВЫКОВ",
        skills.map((s) => skillPromptBlock(s, skillChosen)).join("\n\n"),
      ].join("\n")
    : "";
  const memory = memoryBlock ? `\nRelevant memory:\n${memoryBlock}` : "";
  const noSkillTask = agent.systemPrompt?.trim();

  if (!skillChosen && noSkillTask) {
    return [
      "Пользователь не выбрал навык.",
      "ЗАДАЧА АГЕНТА — выполни её. Она главнее материалов навыков ниже:",
      noSkillTask,
      "Материалы навыков открывай для ответа только если задача это разрешает. Если задача велит попросить выбрать навык — не отвечай по материалам, назови навыки и попроси выбрать.",
      skillsBlock,
      memory,
      playbookBlock(agent),
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (skillChosen && noSkillTask) {
    return [skillsBlock, memory, playbookBlock(agent)].filter(Boolean).join("\n");
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
    this.llm = llm ?? createLLMProvider();
  }

  /** Streams one model turn and forwards text tokens as they arrive. */
  private async completeTurn(
    messages: Message[],
    options: LLMOptions,
    onDelta: (delta: string) => void,
  ): Promise<LLMResponse> {
    let content = "";
    const toolCalls: LLMToolCall[] = [];
    let usage: LLMResponse["usage"];
    let model = options.model ?? "";

    for await (const chunk of this.llm.stream(messages, options)) {
      if (chunk.content) {
        content += chunk.content;
        onDelta(chunk.content);
      }
      if (chunk.toolCalls?.length) toolCalls.push(...chunk.toolCalls);
      if (chunk.model) model = chunk.model;
      if (chunk.usage && (chunk.usage.totalTokens || chunk.usage.inputTokens || chunk.usage.outputTokens)) {
        usage = chunk.usage;
      }
    }

    if (!usage) {
      const inputTokens = Math.max(
        1,
        Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4),
      );
      const outputTokens = Math.ceil(
        (content + toolCalls.map((t) => `${t.name}${t.arguments}`).join("")).length / 4,
      );
      usage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
    }

    return {
      content,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      usage,
      model,
      provider: this.llm.name,
    };
  }

  run(input: RunTaskInput): Promise<RunTaskResult> {
    return enqueueMilli(() => this.execute(input));
  }

  private async execute(input: RunTaskInput): Promise<RunTaskResult> {
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
      const grounded = skills.some((s) => Boolean(s.documentText?.trim()));
      const requested = input.toolNames?.length
        ? input.toolNames
        : Array.from(new Set([...skillToolNames, ...agentToolNames]));

      let tools = getToolsByNames(requested).filter((t) => t.name !== "offer_form");
      if (!tools.length && !grounded) {
        tools = listTools().filter((t) => t.name !== "offer_form");
      }
      if (grounded) {
        const outside = new Set(["web_search", "http_request"]);
        tools = tools.filter((t) => !outside.has(t.name));
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

      const skillChosen = Boolean(input.skillIds?.length);
      const skillModel =
        skillChosen && skills.length === 1 && skills[0]?.model?.trim()
          ? skills[0].model.trim()
          : "";
      const taskTail = skillChosen
        ? "Пользователь выбрал навык. Ответь строго по его промпту. Если к навыку прикреплён текст — опирайся только на него."
        : "Навык не выбран. Выполни задачу агента из системного промпта.";

      const messages: Message[] = [
        { role: "system", content: buildSystemPrompt(agent, skills, memoryBlock, skillChosen) },
        {
          role: "user",
          content: `Задача:\n${input.instruction}\n\n${taskTail}`,
        },
      ];

      let finalResult = "";
      let streamed = "";
      let padNext = false;
      const onDelta = (delta: string) => {
        if (!delta) return;
        if (padNext) {
          padNext = false;
          streamed += "\n\n";
          input.onDelta?.("\n\n");
        }
        streamed += delta;
        input.onDelta?.(delta);
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

        const response = await this.completeTurn(messages, {
          model: skillModel || agent.model || readDefaultModel(),
          temperature: agent.temperature,
          maxTokens: limits.maxTokens,
          tools: toToolDefs(tools),
          signal: controller.signal,
        }, onDelta);

        if (response.usage) {
          await prisma.usageRecord.create({
            data: {
              agentId: agent.id,
              provider: response.provider,
              model: response.model,
              inputTokens: response.usage.inputTokens,
              outputTokens: response.usage.outputTokens,
              totalTokens: response.usage.totalTokens,
              estimatedCost: await estimateUsd(response.model || skillModel || agent.model, response.usage),
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
          padNext = streamed.length > 0;
          continue;
        }

        finalResult = streamed.trim() || response.content?.trim() || "Ответ не сформирован.";
        await emit("final_result", "Задача завершена", {
          preview: finalResult.slice(0, 500),
        });
        await writeMemory({
          agentId: agent.id,
          content: `Результат задачи: ${finalResult.slice(0, 2000)}`,
          type: "TASK",
          taskId: input.taskId,
          userId: input.userId,
          metadata: { instruction: input.instruction.slice(0, 500) },
        });
        await setStatus("SUCCESS", "Задача выполнена");
        return {
          success: true,
          result: finalResult,
          iterations,
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
