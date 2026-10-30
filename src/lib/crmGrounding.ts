import { prisma } from "@/lib/db";
import { createLLMProvider, defaultLLMModel, providerForModel, type Message } from "@/llm";
import { isModelFailoverError, modelAttempts } from "@/llm/fallback";
import { costUsd, getPricedModels, resolvePricedModelId } from "@/llm/pricing";
import {
  attachmentCatalogText,
  finalizeCrmDraft,
  isCrmImageDoc,
  isCrmTrainingDoc,
  wantsFileAttachment,
} from "@/lib/crmMedia";
import { playbookWantsWebResearch, runWebResearch } from "@/lib/webResearch";

type GroundingDocument = {
  id: string;
  fileName: string;
  url: string;
  mimeType?: string;
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

function selectContext(documents: GroundingDocument[], query: string, limit = 8) {
  const terms = searchTerms(query);
  return documents
    .flatMap(chunks)
    .map((chunk, index) => {
      const haystack = chunk.text.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { ...chunk, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit);
}

/** True when the client asks about products/services/prices — then answer from docs. */
export function isServiceOrProductQuestion(text: string, product = "") {
  const value = text.toLowerCase();
  const productBits = searchTerms(product);
  const hasProductHit = productBits.some((term) => value.includes(term));
  return (
    hasProductHit
    || /(услуг|сервис|тариф|прайс|цен[аыуе]|стоимост|прайс[- ]?лист|пакет|подписк|лиценз|договор|гарант|срок|доставк|оплат|реквизит|как работа|что входите|чем занима|условия|характеристик|спецификац|коммерческ|кп\b|proposal|offer|price|service)/i.test(
      value,
    )
  );
}

function buildDialogueMessages(input: {
  kind: "ANSWER" | "PROPOSAL";
  prompt: string;
  playbook: GroundingPlaybook;
  lead: GroundingLead;
  documents: GroundingDocument[];
  history: Array<{ direction: string; body: string }>;
  webResearchText?: string;
}): { messages: Message[]; uniqueSources: GroundingDocument[]; temperature: number; maxTokens: number } {
  const textDocuments = input.documents.filter(
    (doc) => isCrmTrainingDoc(doc) || (!isCrmImageDoc(doc) && doc.text),
  );
  const filesText = attachmentCatalogText(input.documents);
  const wantsDocs =
    input.kind === "PROPOSAL" || isServiceOrProductQuestion(input.prompt, input.playbook.product);
  // Only the client message decides attachments — systemPrompt often mentions «файл» as knowledge.
  const wantsAttach = wantsFileAttachment(input.prompt);

  // Knowledge base: always retrieve relevant chunks; heavier when asking about services.
  const context = textDocuments.length
    ? selectContext(
        textDocuments,
        `${input.prompt}\n${input.playbook.product}\n${input.lead.notes}`,
        input.kind === "PROPOSAL" ? 8 : wantsDocs ? 6 : 3,
      )
    : [];
  const softContext =
    !context.length && textDocuments.length
      ? selectContext(textDocuments, input.playbook.product || input.playbook.name, wantsDocs ? 3 : 2)
      : [];
  const usedContext = context.length ? context : softContext;
  const uniqueSources = [...new Map(usedContext.map((chunk) => [chunk.document.id, chunk.document])).values()];
  const sourceText = usedContext
    .map((chunk, index) => `=== БАЗА ЗНАНИЙ ${index + 1}: ${chunk.document.fileName} ===\n${chunk.text}`)
    .join("\n\n");

  if (input.kind === "PROPOSAL") {
    const system = [
      "Ты готовишь персональное коммерческое предложение. Пиши как живой менеджер, не шаблоном.",
      "Факты об услугах, ценах и условиях — только из блоков БАЗА ЗНАНИЙ. Не выдумывай.",
      "Если факта нет в базе — честно напиши, что в материалах этого нет.",
      filesText
        ? "Презентацию, PDF или картинку прикладывай маркером [[FILE:имя]] / [[IMAGE:имя]] отдельной строкой — не вставляй файл текстом."
        : "",
      `Навык: ${input.playbook.name}`,
      `Продукт: ${input.playbook.product}`,
      `Цели: ${input.playbook.goals}`,
      `Стиль: ${input.playbook.communicationStyle}`,
      `Ограничения: ${input.playbook.restrictions}`,
      input.playbook.systemPrompt ? `Инструкция навыка: ${input.playbook.systemPrompt}` : "",
      input.lead.agentInstruction ? `Индивидуальная инструкция: ${input.lead.agentInstruction}` : "",
      sourceText,
      input.webResearchText
        ? `=== ИНТЕРНЕТ-ИССЛЕДОВАНИЕ (Yandex / сайты) ===\nИспользуй факты ниже, если они помогают. Не выдумывай сверх этого.\n${input.webResearchText}`
        : "",
      filesText,
    ]
      .filter(Boolean)
      .join("\n\n");
    const history = input.history
      .slice(-20)
      .map((message) => `${message.direction === "INBOUND" ? "Клиент" : "Менеджер"}: ${message.body}`)
      .join("\n");
    return {
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            `Клиент: ${input.lead.displayName || "имя не указано"}`,
            input.lead.company ? `Компания: ${input.lead.company}` : "",
            history ? `История диалога:\n${history}` : "",
            `Задача для КП: ${input.prompt || "Подготовить предложение по потребностям клиента."}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      uniqueSources,
      temperature: 0.45,
      maxTokens: 2200,
    };
  }

  // Live chat — human dialogue + knowledge base when needed + real file attachments.
  const system = [
    "Ты — живой менеджер по продажам в переписке. Пишешь от первого лица как человек, коротко и по делу.",
    "Поддерживай диалог по истории. Не повторяй шаблонное приветствие и презентацию компании в каждом сообщении.",
    "Блоки БАЗА ЗНАНИЙ — извлечённый текст документов. Опирайся на них, когда нужны факты об услугах, ценах, условиях. Не выдумывай. Не вставляй документ целиком в ответ.",
    wantsDocs
      ? "Сейчас вопрос про услуги/цены/условия — отвечай по базе знаний. Если факта нет — скажи прямо."
      : "Сейчас обычный диалог: не читай лекцию из базы, пока клиент сам не спросит про услуги. Базу можно использовать точечно, если без неё ответ будет выдумкой.",
    wantsAttach
      ? "Клиент просит файл: прикрепи презентацию/PDF/картинку маркером [[FILE:точное_имя]] или [[IMAGE:имя]] в конце. DOCX из базы знаний не прикрепляй. Не копируй содержимое файла в текст."
      : filesText
        ? "Не прикрепляй DOCX и другие файлы базы знаний. Файл (PDF/презентацию/картинку) — только если клиент явно просит прислать."
        : "",
    "Без markdown и без пометок [Источник: …]. Обычно 1–5 предложений.",
    `Продукт: ${input.playbook.product || input.playbook.name}`,
    `Цели: ${input.playbook.goals}`,
    `Стиль: ${input.playbook.communicationStyle || "дружелюбный, деловой, живой"}`,
    `Ограничения: ${input.playbook.restrictions}`,
    input.playbook.qualificationQuestions
      ? `Можешь мягко выяснять: ${input.playbook.qualificationQuestions}`
      : "",
    !input.lead.displayName || !input.lead.company || !input.lead.email
      ? `В карточке не хватает данных (${[
          !input.lead.displayName ? "имя" : "",
          !input.lead.company ? "компания" : "",
          !input.lead.email ? "email" : "",
          !input.lead.phone ? "телефон" : "",
        ]
          .filter(Boolean)
          .join(", ")}). Если уместно — мягко спроси недостающее в одном коротком вопросе. Ответы клиента система сама запишет в карточку.`
      : "",
    "Если клиент просит прислать на почту — ответь по сути здесь. НИКОГДА не пиши «уже отправил на почту»: система сама отправит письмо и допишет статус в конец сообщения.",
    input.playbook.systemPrompt ? `Инструкция навыка: ${input.playbook.systemPrompt}` : "",
    input.lead.agentInstruction ? `Индивидуальная инструкция по карточке: ${input.lead.agentInstruction}` : "",
    sourceText,
    input.webResearchText
      ? [
          "=== ИНТЕРНЕТ-ИССЛЕДОВАНИЕ (Yandex / сайты) ===",
          "Ниже — результаты поиска и текст страниц. Опирайся на них, если в промпте навыка нужно искать в интернете.",
          "Если нашёл подходящий вариант/факт для клиента — используй его в ответе (сообщение уйдёт по обычному режиму отправки навыка).",
          "Не выдумывай контакты и цены, которых нет в исследовании или базе знаний.",
          input.webResearchText,
        ].join("\n")
      : "",
    filesText,
  ]
    .filter(Boolean)
    .join("\n\n");

  const messages: Message[] = [{ role: "system", content: system }];
  const recent = input.history.slice(-16);
  for (const item of recent) {
    const content = item.body?.trim();
    if (!content) continue;
    messages.push({
      role: item.direction === "INBOUND" ? "user" : "assistant",
      content,
    });
  }
  // Ensure the latest inbound is present even if history lag omitted it.
  const last = recent[recent.length - 1];
  if (!last || last.direction !== "INBOUND" || last.body.trim() !== input.prompt.trim()) {
    messages.push({ role: "user", content: input.prompt });
  }
  if (messages.length === 1) {
    messages.push({ role: "user", content: input.prompt });
  }

  return {
    messages,
    uniqueSources,
    temperature: wantsDocs ? 0.35 : 0.65,
    maxTokens: wantsDocs ? 1200 : 700,
  };
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
  let webResearchText = "";
  const agentSearch = await prisma.agent.findUnique({
    where: { id: input.playbook.agentId },
    select: { webSearchEnabled: true },
  });
  if (agentSearch?.webSearchEnabled || playbookWantsWebResearch(input.playbook)) {
    const researchQuery = [input.prompt, input.playbook.product, input.lead.company, input.lead.displayName]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 350);
    try {
      const bundle = await runWebResearch({
        query: researchQuery,
        maxPages: 3,
        agentId: input.playbook.agentId,
      });
      webResearchText = bundle.summaryText;
      if (bundle.hits.length) {
        console.log(
          `[crm-grounding] web research playbook=${input.playbook.id} provider=${bundle.provider} hits=${bundle.hits.length} pages=${bundle.pages.length}`,
        );
      }
    } catch (cause) {
      console.warn(
        "[crm-grounding] web research failed:",
        cause instanceof Error ? cause.message : cause,
      );
    }
  }

  const { messages, uniqueSources, temperature, maxTokens } = buildDialogueMessages({
    ...input,
    webResearchText,
  });
  const preferred = input.model?.trim() || defaultLLMModel();
  let lastError: unknown;
  for (const model of modelAttempts(preferred)) {
    try {
      const provider = createLLMProvider(providerForModel(model));
      const result = await provider.chat(messages, {
        model,
        temperature,
        maxTokens,
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
      const cleaned =
        input.kind === "ANSWER"
          ? result.content
              .trim()
              .replace(/\s*\[Источник:[^\]]+\]/gi, "")
              .replace(/\n{3,}/g, "\n\n")
              .trim()
          : result.content.trim();
      const finalized = finalizeCrmDraft(cleaned, input.documents, [input.prompt]);
      return {
        draft: finalized.body,
        attachments: finalized.attachments,
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

/** Cold first email from a manager prompt — personalized, send-ready, no source footnotes. */
export async function generateFirstTouchEmail(input: {
  prompt: string;
  playbook: GroundingPlaybook;
  lead: GroundingLead;
  documents?: GroundingDocument[];
  model?: string;
}) {
  const docs = input.documents ?? [];
  const trainingDocs = docs.filter((doc) => isCrmTrainingDoc(doc) || (!isCrmImageDoc(doc) && doc.text));
  const context = trainingDocs.length
    ? selectContext(trainingDocs, `${input.prompt}\n${input.playbook.product}\n${input.lead.company}`)
    : [];
  const sourceText = context.length
    ? context
        .map((chunk, index) => `=== МАТЕРИАЛ ${index + 1}: ${chunk.document.fileName} ===\n${chunk.text}`)
        .join("\n\n")
    : "";

  const filesText = attachmentCatalogText(docs);
  const system = [
    "Ты пишешь первое холодное письмо потенциальному клиенту от имени продавца.",
    "Верни ТОЛЬКО текст письма — без темы, без кавычек, без markdown, без пометок [Источник:].",
    "Материалы DOCX/PDF/PPTX — текст для обучения: бери факты, не вставляй документ целиком в письмо.",
    "Письмо короткое (4–8 предложений), естественное, на «вы», с одним понятным следующим шагом.",
    "Не выдумывай цены, сроки и гарантии. Если факта нет в материалах — не утверждай его.",
    filesText
      ? "Если в задании просят приложить файл или картинку — добавь в конец маркер [[FILE:имя_файла]] (или [[IMAGE:имя]]), не копируй файл в текст."
      : "",
    `Навык: ${input.playbook.name}`,
    `Продукт: ${input.playbook.product}`,
    `Цели: ${input.playbook.goals}`,
    `Стиль: ${input.playbook.communicationStyle}`,
    `Ограничения: ${input.playbook.restrictions}`,
    input.playbook.systemPrompt ? `Инструкция навыка: ${input.playbook.systemPrompt}` : "",
    input.lead.agentInstruction ? `Индивидуальная инструкция по карточке: ${input.lead.agentInstruction}` : "",
    sourceText,
    filesText,
  ]
    .filter(Boolean)
    .join("\n\n");

  const user = [
    `Получатель: ${input.lead.displayName || "имя не указано"}`,
    input.lead.company ? `Компания: ${input.lead.company}` : "",
    input.lead.email ? `Email: ${input.lead.email}` : "",
    input.lead.notes ? `Заметки: ${input.lead.notes}` : "",
    `Задание менеджера (что должно быть в первом письме):\n${input.prompt}`,
  ]
    .filter(Boolean)
    .join("\n");

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
        temperature: 0.45,
        maxTokens: 900,
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
            requestType: "crm_first_touch",
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
      const finalized = finalizeCrmDraft(result.content.trim(), docs, [input.prompt]);
      return { body: finalized.body, attachments: finalized.attachments };
    } catch (cause) {
      lastError = cause;
      const message = cause instanceof Error ? cause.message : String(cause);
      const unavailable = /unknown model|model.+(?:not found|does not exist|unsupported)/i.test(message);
      if (!unavailable && !isModelFailoverError(message)) throw cause;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Нет доступной модели для первого письма");
}
