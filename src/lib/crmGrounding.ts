import { prisma } from "@/lib/db";
import { createLLMProvider, defaultLLMModel, providerForModel, type Message } from "@/llm";
import { isModelFailoverError, modelAttempts } from "@/llm/fallback";
import { costUsd, getPricedModels, resolvePricedModelId } from "@/llm/pricing";

type GroundingDocument = {
  id: string;
  fileName: string;
  url: string;
  text: string;
};

type GroundingPlaybook = {
  id: string;
  agentId: string;
  name: string;
  product: string;
  systemPrompt: string;
  goals: string;
  communicationStyle: string;
  restrictions: string;
  qualificationQuestions: string;
};

type GroundingLead = {
  id: string;
  displayName: string;
  company: string;
  email: string;
  phone: string;
  telegram: string;
  notes: string;
  agentInstruction: string;
};

function searchTerms(value: string) {
  return [...new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter((term) => term.length >= 4),
  )].slice(0, 40);
}

function chunks(document: GroundingDocument) {
  const paragraphs = document.text.split(/\n{2,}/).filter(Boolean);
  const result: Array<{ document: GroundingDocument; text: string }> = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > 2600) {
      result.push({ document, text: current });
      current = "";
    }
    current += `${current ? "\n\n" : ""}${paragraph}`;
  }
  if (current) result.push({ document, text: current });
  return result;
}

function selectContext(documents: GroundingDocument[], query: string) {
  const terms = searchTerms(query);
  return documents
    .flatMap(chunks)
    .map((chunk, index) => {
      const haystack = chunk.text.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { ...chunk, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 8);
}

export async function generateGroundedSalesDraft(input: {
  kind: "ANSWER" | "PROPOSAL";
  prompt: string;
  playbook: GroundingPlaybook;
  lead: GroundingLead;
  documents: GroundingDocument[];
  history: Array<{ direction: string; body: string }>;
  model?: string;
}) {
  const context = selectContext(
    input.documents,
    `${input.prompt}\n${input.playbook.product}\n${input.lead.notes}\n${input.lead.agentInstruction}`,
  );
  const uniqueSources = [...new Map(context.map((chunk) => [chunk.document.id, chunk.document])).values()];
  const sourceText = context
    .map((chunk, index) => `=== ИСТОЧНИК ${index + 1}: ${chunk.document.fileName} ===\n${chunk.text}`)
    .join("\n\n");
  const history = input.history
    .slice(-20)
    .map((message) => `${message.direction === "INBOUND" ? "Клиент" : "Менеджер"}: ${message.body}`)
    .join("\n");

  const system = [
    "Ты готовишь черновик для менеджера по продажам.",
    "Используй факты ТОЛЬКО из блоков ИСТОЧНИК ниже. Не добавляй знания из памяти модели.",
    "Если нужного факта в источниках нет, прямо напиши, что в материалах навыка этих данных нет.",
    "Для каждого фактического утверждения добавляй ссылку вида [Источник: точное имя файла].",
    "Не выдумывай цены, характеристики, сроки, гарантии, контакты и условия.",
    input.kind === "PROPOSAL"
      ? "Подготовь персональный черновик коммерческого предложения: потребность, решение, ценность, следующий шаг."
      : "Подготовь точный и естественный ответ клиенту.",
    `Навык: ${input.playbook.name}`,
    `Продукт: ${input.playbook.product}`,
    `Цели: ${input.playbook.goals}`,
    `Стиль: ${input.playbook.communicationStyle}`,
    `Ограничения: ${input.playbook.restrictions}`,
    `Квалифицирующие вопросы: ${input.playbook.qualificationQuestions}`,
    input.playbook.systemPrompt ? `Инструкция навыка: ${input.playbook.systemPrompt}` : "",
    input.lead.agentInstruction ? `Индивидуальная инструкция: ${input.lead.agentInstruction}` : "",
    sourceText,
  ].filter(Boolean).join("\n\n");

  const user = [
    `Клиент: ${input.lead.displayName || "имя не указано"}`,
    input.lead.company ? `Компания: ${input.lead.company}` : "",
    history ? `История диалога:\n${history}` : "Истории диалога пока нет.",
    input.kind === "PROPOSAL"
      ? `Задача для КП: ${input.prompt || "Подготовить предложение по потребностям клиента из карточки и диалога."}`
      : `Вопрос/задача: ${input.prompt}`,
  ].filter(Boolean).join("\n\n");

  const messages: Message[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const preferred = input.model?.trim() || defaultLLMModel();
  let lastError: unknown;
  for (const model of modelAttempts(preferred)) {
    try {
      const provider = createLLMProvider(providerForModel(model));
      const result = await provider.chat(messages, {
        model,
        temperature: 0.2,
        maxTokens: 2200,
      });
      const usage = result.usage ?? {
        inputTokens: Math.max(1, Math.ceil(messages.reduce((sum, message) => sum + message.content.length, 0) / 4)),
        outputTokens: Math.max(1, Math.ceil(result.content.length / 4)),
        totalTokens: 0,
      };
      usage.totalTokens = usage.totalTokens || usage.inputTokens + usage.outputTokens;
      const models = await getPricedModels().catch(() => []);
      const estimatedCost = models.length ? costUsd(result.model, usage, models, preferred) : 0;
      const storedModel = models.length
        ? resolvePricedModelId(result.model, models, preferred)
        : result.model;
      await prisma.$transaction([
        prisma.usageRecord.create({
          data: {
            agentId: input.playbook.agentId,
            provider: result.provider,
            model: storedModel,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            estimatedCost,
            requestType: input.kind === "PROPOSAL" ? "crm_proposal" : "crm_reply",
          },
        }),
        prisma.salesPlaybook.update({
          where: { id: input.playbook.id },
          data: { replyCount: { increment: 1 }, replySpendUsd: { increment: estimatedCost } },
        }),
        prisma.salesLead.update({
          where: { id: input.lead.id },
          data: { replyCount: { increment: 1 }, replySpendUsd: { increment: estimatedCost } },
        }),
      ]);
      const [playbookSpend, leadSpend] = await Promise.all([
        prisma.salesPlaybook.findUnique({
          where: { id: input.playbook.id },
          select: { replyCount: true, replySpendUsd: true },
        }),
        prisma.salesLead.findUnique({
          where: { id: input.lead.id },
          select: { replyCount: true, replySpendUsd: true },
        }),
      ]);
      return {
        draft: result.content.trim(),
        sources: uniqueSources.map(({ id, fileName, url }) => ({ id, fileName, url })),
        model: result.model,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          estimatedCost,
        },
        playbookSpend,
        leadSpend,
      };
    } catch (cause) {
      lastError = cause;
      const message = cause instanceof Error ? cause.message : String(cause);
      const unavailable = /unknown model|model.+(?:not found|does not exist|unsupported)/i.test(message);
      if (!unavailable && !isModelFailoverError(message)) throw cause;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Нет доступной модели для черновика");
}
