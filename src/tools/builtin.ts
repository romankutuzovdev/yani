import { fail, ok, type AgentContext, type AgentTool } from "./types";

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
      parsed = new URL(data.url);
    } catch {
      return fail("Invalid URL");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return fail("Only http/https URLs are allowed");
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

export const webSearchTool: AgentTool = {
  name: "web_search",
  description:
    "Search the web for information. Uses DuckDuckGo Instant Answer API (limited). Returns related topics when available.",
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
    const timeout = setTimeout(() => controller.abort(), 15000);
    const onAbort = () => controller.abort();
    context.signal?.addEventListener("abort", onAbort);

    try {
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
        heading: data.Heading ?? null,
        abstract: data.AbstractText ?? null,
        abstractUrl: data.AbstractURL ?? null,
        related,
        note: related.length || data.AbstractText
          ? undefined
          : "No rich results from Instant Answer API. Try a more specific query.",
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "web_search failed");
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", onAbort);
    }
  },
};

export const offerFormTool: AgentTool = {
  name: "offer_form",
  description:
    "Offer the user a web form or page that opens inside the chat as an iframe. Use when the playbook says to show a form for a topic. Pass the exact URL from the playbook.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "https:// link to the form or page" },
      title: { type: "string", description: "Short button/title for the form" },
      reason: { type: "string", description: "Why this form is offered (shown to the user)" },
    },
    required: ["url", "title"],
  },
  async execute(input) {
    const data = input as { url?: string; title?: string; reason?: string };
    const url = String(data.url ?? "").trim();
    const title = String(data.title ?? "").trim() || "Форма";
    if (!url) return fail("url is required");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return fail("Invalid URL");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return fail("Only http/https URLs are allowed");
    }
    return ok({
      url: parsed.toString(),
      title,
      reason: data.reason ?? "",
      openInIframe: true,
    });
  },
};
