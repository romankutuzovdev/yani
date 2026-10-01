"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CharacterStage } from "@/components/CharacterStage";
import type { CharacterAssetView } from "@/characters/CharacterRenderer";
import { Wrench } from "lucide-react";

type ToolInfo = { name: string; description: string };

type AgentCard = {
  id: string;
  name: string;
  description: string;
  status: string;
  statusMessage: string;
  character: { assets: CharacterAssetView[] } | null;
  tools: ToolInfo[];
  widget?: { config?: { greeting?: string } } | null;
};

type ChatMsg = {
  role: "user" | "assistant" | "system";
  content: string;
  toolHint?: string;
};

const TOOL_LABELS: Record<string, string> = {
  web_search: "Поиск в интернете",
  http_request: "HTTP-запрос",
  calculator: "Калькулятор",
  datetime: "Дата и время",
  memory_search: "Поиск по памяти",
};

export default function ClientChatPage() {
  const [agent, setAgent] = useState<AgentCard | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionId] = useState(() => `client-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    void fetch("/api/v1/agents/by-slug/alex")
      .then((r) => r.json())
      .then((data) => {
        if (!data.agent) {
          setError(data.error ?? "Агент недоступен");
          return;
        }
        setAgent(data.agent);
        const greeting =
          data.agent.widget?.config?.greeting ??
          `Привет! Я ${data.agent.name}. Чем помочь?`;
        setMessages([{ role: "assistant", content: greeting }]);
      })
      .catch(() => setError("Не удалось загрузить агента"));
  }, []);

  useEffect(() => {
    if (!agent?.id) return;
    const es = new EventSource(`/api/v1/agents/${agent.id}/status/stream`);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setAgent((prev) =>
          prev
            ? {
                ...prev,
                status: data.status,
                statusMessage: data.statusMessage,
                character: data.character ?? prev.character,
              }
            : prev,
        );
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [agent?.id]);

  const activeToolHint = useMemo(() => {
    const msg = agent?.statusMessage ?? "";
    const match =
      msg.match(/Использую инструмент:\s*(\w+)/i) ||
      msg.match(/Using tool:\s*(\w+)/i);
    if (!match) return null;
    const name = match[1];
    return TOOL_LABELS[name] ?? name;
  }, [agent?.statusMessage]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!agent || !input.trim() || busy) return;
    const text = input.trim();
    setInput("");
    setBusy(true);
    setError("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      const res = await fetch(`/api/v1/agents/${agent.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.error ?? "Не удалось получить ответ" },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.reply ?? "Пустой ответ",
            toolHint: activeToolHint ?? undefined,
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Сетевая ошибка. Попробуйте ещё раз." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#f5f3ff_0%,_#ffffff_55%,_#fafafa_100%)] text-slate-800">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-6">
        <Link href="/chat" className="rounded-2xl bg-slate-950 px-3 py-2">
          <Image
            src="/brand/yani-logo.png"
            alt="YANI"
            width={120}
            height={40}
            className="h-8 w-auto object-contain"
            priority
          />
        </Link>
        <Link
          href="/login"
          className="rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm text-violet-700 hover:bg-violet-50"
        >
          Админка
        </Link>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 pb-10 md:grid-cols-[320px_1fr] md:px-6">
        <aside className="space-y-4">
          {agent ? (
            <CharacterStage
              name={agent.name}
              assets={agent.character?.assets ?? []}
              status={agent.status}
              statusMessage={
                activeToolHint
                  ? `Использую: ${activeToolHint}`
                  : agent.statusMessage
              }
              variant="light"
              compact
            />
          ) : (
            <div className="rounded-3xl border border-violet-100 bg-white p-8 text-center text-slate-500">
              Загрузка героя…
            </div>
          )}

          <section className="rounded-3xl border border-violet-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-800">
              <Wrench size={16} className="text-violet-600" />
              Инструменты
            </div>
            <div className="space-y-2">
              {(agent?.tools ?? []).map((tool) => (
                <div
                  key={tool.name}
                  className={`rounded-xl border px-3 py-2 text-sm ${
                    activeToolHint &&
                    (TOOL_LABELS[tool.name] === activeToolHint || tool.name === activeToolHint)
                      ? "border-violet-300 bg-violet-50"
                      : "border-violet-100 bg-violet-50/40"
                  }`}
                >
                  <p className="font-medium text-slate-800">
                    {TOOL_LABELS[tool.name] ?? tool.name}
                  </p>
                  <p className="text-xs text-slate-500">{tool.description}</p>
                </div>
              ))}
              {!agent?.tools?.length && (
                <p className="text-xs text-slate-500">Инструменты пока не назначены</p>
              )}
            </div>
          </section>
        </aside>

        <section className="flex min-h-[70vh] flex-col rounded-3xl border border-violet-100 bg-white shadow-sm">
          <div className="border-b border-violet-100 px-5 py-4">
            <h1 className="text-xl font-semibold text-slate-900">Чат с агентом</h1>
            <p className="text-sm text-slate-500">
              {agent?.description || "Простой чат с инструментами и живым персонажем"}
            </p>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "ml-auto bg-violet-600 text-white"
                    : "bg-violet-50 text-slate-800"
                }`}
              >
                {m.content}
              </div>
            ))}
            {busy && (
              <div className="rounded-2xl bg-violet-50 px-4 py-3 text-sm text-violet-700">
                {activeToolHint
                  ? `Герой использует инструмент: ${activeToolHint}…`
                  : "Герой думает…"}
              </div>
            )}
          </div>

          {error && <p className="px-5 pb-2 text-sm text-rose-600">{error}</p>}

          <form onSubmit={send} className="border-t border-violet-100 p-4">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Напишите сообщение…"
                disabled={!agent || busy}
                className="flex-1 rounded-2xl border border-violet-200 bg-violet-50/40 px-4 py-3 outline-none focus:border-violet-400"
              />
              <button
                disabled={!agent || busy || !input.trim()}
                className="rounded-2xl bg-violet-600 px-5 py-3 font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                Отправить
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
