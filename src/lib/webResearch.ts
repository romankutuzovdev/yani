import { fetchPageText } from "@/lib/fetchPageText";
import { yandexSearchConfigured, yandexWebSearch, type YandexSearchHit } from "@/lib/yandexSearch";

export type ResearchPage = {
  url: string;
  title: string;
  snippet: string;
  text: string;
};

export type WebResearchBundle = {
  query: string;
  provider: "yandex" | "none";
  hits: YandexSearchHit[];
  pages: ResearchPage[];
  summaryText: string;
};

/** Detect “search the web / parse sites” instructions in free-form prompts. */
export function textWantsWebResearch(text: string) {
  const blob = text.trim();
  if (!blob) return false;
  return (
    /(ищи|поиск|найди|собери|парс|проверь|монитор).{0,80}(интернет|сайт|в сети|яндекс|google|web)/i.test(
      blob,
    ) ||
    /(интернет|сайт|в сети|яндекс|web).{0,80}(ищи|поиск|найди|собери|парс|анализ)/i.test(blob) ||
    /(search|browse|scrape|crawl).{0,40}(web|site|internet)/i.test(blob)
  );
}

/** True when sales playbook prompt asks to use the internet (independent of agent checkbox). */
export function playbookWantsWebResearch(playbook: {
  systemPrompt?: string | null;
  goals?: string | null;
  product?: string | null;
  restrictions?: string | null;
  qualificationQuestions?: string | null;
}) {
  return textWantsWebResearch(
    [
      playbook.systemPrompt,
      playbook.goals,
      playbook.product,
      playbook.restrictions,
      playbook.qualificationQuestions,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

/** True when agent or skill prompts ask to use the internet (independent of checkbox). */
export function agentPromptWantsWebResearch(input: {
  systemPrompt?: string | null;
  additionalInstructions?: string | null;
  goals?: string | null;
  rules?: string | null;
  skills?: Array<{ systemPrompt?: string | null; description?: string | null }>;
}) {
  const parts = [
    input.systemPrompt,
    input.additionalInstructions,
    input.goals,
    input.rules,
    ...(input.skills ?? []).flatMap((skill) => [skill.systemPrompt, skill.description]),
  ];
  return textWantsWebResearch(parts.filter(Boolean).join("\n"));
}

async function duckDuckGoFallback(query: string, signal?: AbortSignal): Promise<YandexSearchHit[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
  };
  const hits: YandexSearchHit[] = [];
  if (data.AbstractURL) {
    hits.push({
      title: data.Heading || data.AbstractURL,
      url: data.AbstractURL,
      snippet: data.AbstractText || "",
    });
  }
  for (const topic of data.RelatedTopics ?? []) {
    if (!topic.FirstURL || !topic.Text) continue;
    hits.push({ title: topic.Text.slice(0, 120), url: topic.FirstURL, snippet: topic.Text });
    if (hits.length >= 6) break;
  }
  return hits;
}

/** Search (Yandex preferred) + fetch/parse top result pages into one LLM-ready block. */
export async function runWebResearch(input: {
  query: string;
  maxPages?: number;
  signal?: AbortSignal;
  agentId?: string;
}): Promise<WebResearchBundle> {
  const query = input.query.trim().slice(0, 400);
  const maxPages = Math.min(Math.max(input.maxPages ?? 3, 1), 5);
  let provider: "yandex" | "none" = "none";
  let hits: YandexSearchHit[] = [];

  if (yandexSearchConfigured()) {
    try {
      const result = await yandexWebSearch({
        query,
        limit: 8,
        signal: input.signal,
        agentId: input.agentId,
      });
      hits = result.hits;
      provider = "yandex";
    } catch {
      hits = await duckDuckGoFallback(query, input.signal);
    }
  } else {
    hits = await duckDuckGoFallback(query, input.signal);
  }

  const pages: ResearchPage[] = [];
  for (const hit of hits.slice(0, maxPages)) {
    try {
      const page = await fetchPageText({ url: hit.url, maxChars: 10_000, signal: input.signal });
      if (!page.text.trim()) continue;
      pages.push({
        url: page.finalUrl || hit.url,
        title: page.title || hit.title,
        snippet: hit.snippet,
        text: page.text,
      });
    } catch {
      pages.push({
        url: hit.url,
        title: hit.title,
        snippet: hit.snippet,
        text: hit.snippet || "(текст страницы недоступен)",
      });
    }
  }

  const parts: string[] = [`Запрос: ${query}`, `Источник поиска: ${provider === "yandex" ? "Yandex Search API" : "fallback"}`];
  if (hits.length) {
    parts.push(
      "Результаты поиска:\n" +
        hits
          .slice(0, 8)
          .map((hit, i) => `${i + 1}. ${hit.title}\n   ${hit.url}\n   ${hit.snippet}`)
          .join("\n"),
    );
  }
  for (const page of pages) {
    parts.push(`--- Страница: ${page.title} ---\nURL: ${page.url}\n${page.text.slice(0, 8_000)}`);
  }

  return {
    query,
    provider,
    hits,
    pages,
    summaryText: parts.join("\n\n").slice(0, 28_000),
  };
}
