import { fail, ok, type AgentContext, type AgentTool } from "./types";
import { assertPublicHttpUrl, fetchPageText } from "@/lib/fetchPageText";
import { yandexSearchConfigured, yandexWebSearch } from "@/lib/yandexSearch";
import { runWebResearch } from "@/lib/webResearch";

export const calculatorTool: AgentTool = {
  name: "calculator",
  description: "Evaluate a simple arithmetic expression. Supports +, -, *, /, parentheses, and decimals.",
  inputSchema: {
    type: "object",
    properties: {
      expression: { type: "string", description: "Arithmetic expression to evaluate" },
    },
    required: ["expression"],
  },
  async execute(input) {
    const expression = String((input as { expression?: string })?.expression ?? "").trim();
    if (!expression) return fail("expression is required");
    if (!/^[\d+\-*/().\s]+$/.test(expression)) {
      return fail("Only numbers and + - * / ( ) are allowed");
    }
    try {
      // Restricted Function constructor — expression already sanitized above
      const result = Function(`"use strict"; return (${expression});`)();
      if (typeof result !== "number" || !Number.isFinite(result)) {
        return fail("Invalid calculation result");
      }
      return ok({ expression, result });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Calculation failed");
    }
  },
};

export const datetimeTool: AgentTool = {
  name: "datetime",
  description: "Get the current date and time in ISO and human-readable formats.",
  inputSchema: {
    type: "object",
    properties: {
      timezone: { type: "string", description: "Optional IANA timezone, e.g. Europe/Moscow" },
    },
  },
  async execute(input) {
    const timezone = (input as { timezone?: string })?.timezone;
    const now = new Date();
    try {
      const human = timezone
        ? new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone,
            dateStyle: "full",
            timeStyle: "long",
          }).format(now)
        : now.toString();
      return ok({ iso: now.toISOString(), human, timezone: timezone ?? "local" });
    } catch {
      return fail("Invalid timezone");
    }
  },
};

export const httpRequestTool: AgentTool = {
  name: "http_request",
  description: "Perform an HTTP GET or POST request to a public URL. Use carefully.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      method: { type: "string", enum: ["GET", "POST"] },
      body: { type: "string" },
      headers: { type: "object" },
    },
    required: ["url"],
  },
  async execute(input, context: AgentContext) {
    const data = input as {
      url?: string;
      method?: string;
      body?: string;
      headers?: Record<string, string>;
    };
    if (!data.url) return fail("url is required");
    let parsed: URL;
    try {
      parsed = assertPublicHttpUrl(data.url);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Invalid URL");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const onAbort = () => controller.abort();
    context.signal?.addEventListener("abort", onAbort);

    try {
      const res = await fetch(parsed.toString(), {
        method: data.method ?? "GET",
        headers: {
          "User-Agent": "YaniAgent/1.0",
          ...(data.headers ?? {}),
        },
        body: data.method === "POST" ? data.body : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      return ok({
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: text.slice(0, 8000),
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "HTTP request failed");
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", onAbort);
    }
  },
};

export const fetchPageTool: AgentTool = {
  name: "fetch_page",
  description:
    "Open a public web page and return cleaned text (HTML stripped). Use after web_search to read a site.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Page URL (http/https)" },
      maxChars: { type: "number", description: "Max characters of text (default 12000)" },
    },
    required: ["url"],
  },
  async execute(input, context) {
    const data = input as { url?: string; maxChars?: number };
    if (!data.url) return fail("url is required");
    try {
      const page = await fetchPageText({
        url: data.url,
        maxChars: data.maxChars,
        signal: context.signal,
      });
      return ok(page);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "fetch_page failed");
    }
  },
};

export const webSearchTool: AgentTool = {
  name: "web_search",
  description:
    "Search the web. Prefers Yandex Search API (keys from admin settings); falls back to DuckDuckGo Instant Answer.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
  async execute(input, context) {
    const query = String((input as { query?: string })?.query ?? "").trim();
    if (!query) return fail("query is required");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const onAbort = () => controller.abort();
    context.signal?.addEventListener("abort", onAbort);

    try {
      if (yandexSearchConfigured()) {
        const result = await yandexWebSearch({
          query,
          limit: 8,
          signal: controller.signal,
          agentId: context.agentId,
        });
        return ok({
          query: result.query,
          provider: result.provider,
          results: result.hits,
          note: result.hits.length
            ? undefined
            : "Yandex не вернул результатов. Уточните запрос.",
        });
      }

      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return fail(`Search failed with status ${res.status}`);
      const data = (await res.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string } | { Topics?: unknown }>;
      };

      const related = (data.RelatedTopics ?? [])
        .flatMap((t) => ("Text" in t && t.Text ? [t] : []))
        .slice(0, 5)
        .map((t) => ({ text: t.Text, url: t.FirstURL }));

      return ok({
        query,
        provider: "duckduckgo",
        heading: data.Heading ?? null,
        abstract: data.AbstractText ?? null,
        abstractUrl: data.AbstractURL ?? null,
        related,
        note:
          related.length || data.AbstractText
            ? "Yandex не настроен — использован DuckDuckGo. Ключ задаётся в Настройках."
            : "Нет результатов. Укажите ключ Яндекса в Настройках или уточните запрос.",
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "web_search failed");
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", onAbort);
    }
  },
};

export const webResearchTool: AgentTool = {
  name: "web_research",
  description:
    "Search the web (Yandex), open top result pages, extract text, and return a research pack. Use when you need facts from sites before answering or drafting a message.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to research" },
      maxPages: { type: "number", description: "How many pages to open (1–5, default 3)" },
    },
    required: ["query"],
  },
  async execute(input, context) {
    const data = input as { query?: string; maxPages?: number };
    const query = String(data.query ?? "").trim();
    if (!query) return fail("query is required");
    try {
      const bundle = await runWebResearch({
        query,
        maxPages: data.maxPages,
        signal: context.signal,
        agentId: context.agentId,
      });
      return ok({
        query: bundle.query,
        provider: bundle.provider,
        hits: bundle.hits,
        pages: bundle.pages.map((page) => ({
          url: page.url,
          title: page.title,
          snippet: page.snippet,
          text: page.text.slice(0, 6000),
        })),
        summaryText: bundle.summaryText,
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "web_research failed");
    }
  },
};
