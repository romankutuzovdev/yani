import { prisma } from "@/lib/db";
import { yandexCredentials, yandexRequestCostRub } from "@/lib/yandexSettings";

/** Yandex Cloud Search API v2 — web search for agent research. */

export type YandexSearchHit = {
  title: string;
  url: string;
  snippet: string;
  domain?: string;
};

export type YandexSearchResult = {
  provider: "yandex";
  query: string;
  hits: YandexSearchHit[];
  rawXmlLength: number;
};

function decodeEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function tagText(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeEntities(match[1] ?? "") : "";
}

/** Parse Yandex Search API XML (UTF-8) into flat hits. */
export function parseYandexSearchXml(xml: string, limit = 8): YandexSearchHit[] {
  const docs = xml.match(/<doc\b[\s\S]*?<\/doc>/gi) ?? [];
  const hits: YandexSearchHit[] = [];
  for (const doc of docs) {
    const url = tagText(doc, "url") || tagText(doc, "saved-copy-url");
    if (!url) continue;
    const passages = [...doc.matchAll(/<passage[^>]*>([\s\S]*?)<\/passage>/gi)]
      .map((m) => decodeEntities(m[1] ?? ""))
      .filter(Boolean);
    const title = tagText(doc, "title") || tagText(doc, "headline") || url;
    const snippet =
      passages.join(" … ") || tagText(doc, "headline") || tagText(doc, "modtime") || "";
    let domain = "";
    try {
      domain = new URL(url).hostname;
    } catch {
      domain = tagText(doc, "domain");
    }
    hits.push({ title, url, snippet, domain });
    if (hits.length >= limit) break;
  }
  return hits;
}

export function yandexSearchConfigured() {
  return Boolean(yandexCredentials());
}

async function recordYandexSpend(agentId?: string) {
  const estimatedCost = yandexRequestCostRub();
  await prisma.usageRecord.create({
    data: {
      agentId: agentId || null,
      provider: "yandex",
      model: "search-api-sync",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost,
      requestType: "yandex_search",
    },
  });
}

export async function yandexWebSearch(input: {
  query: string;
  limit?: number;
  searchType?: "SEARCH_TYPE_RU" | "SEARCH_TYPE_COM" | "SEARCH_TYPE_BE";
  signal?: AbortSignal;
  agentId?: string;
}): Promise<YandexSearchResult> {
  const creds = yandexCredentials();
  if (!creds) {
    throw new Error("Yandex Search: укажите ключ и каталог в Настройках");
  }
  const { apiKey, folderId } = creds;
  const query = input.query.trim().slice(0, 400);
  if (!query) throw new Error("Yandex Search: пустой запрос");

  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
  const response = await fetch("https://searchapi.api.cloud.yandex.net/v2/web/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Api-Key ${apiKey}`,
    },
    body: JSON.stringify({
      query: {
        searchType: input.searchType ?? "SEARCH_TYPE_RU",
        queryText: query,
        familyMode: "FAMILY_MODE_MODERATE",
        fixTypoMode: "FIX_TYPO_MODE_ON",
      },
      folderId,
      groupSpec: {
        groupMode: "GROUP_MODE_FLAT",
        groupsOnPage: limit,
        docsInGroup: 1,
      },
      maxPassages: 3,
      l10n: "LOCALIZATION_RU",
      responseFormat: "FORMAT_XML",
    }),
    signal: input.signal,
  });

  const payload = (await response.json().catch(() => ({}))) as {
    rawData?: string;
    message?: string;
    error?: string;
    code?: number;
  };
  if (!response.ok) {
    throw new Error(
      payload.message || payload.error || `Yandex Search HTTP ${response.status}`,
    );
  }
  if (!payload.rawData) throw new Error("Yandex Search: пустой rawData");

  await recordYandexSpend(input.agentId).catch((cause) => {
    console.warn("[yandex] spend log failed:", cause instanceof Error ? cause.message : cause);
  });

  const xml = Buffer.from(payload.rawData, "base64").toString("utf8");
  return {
    provider: "yandex",
    query,
    hits: parseYandexSearchXml(xml, limit),
    rawXmlLength: xml.length,
  };
}
