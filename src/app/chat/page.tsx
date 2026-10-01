"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CharacterStage } from "@/components/CharacterStage";
import type { CharacterAssetView } from "@/characters/CharacterRenderer";
import { ExternalLink, RotateCcw, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

type SkillTile = {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  model?: string;
  sortOrder: number;
};

type AgentCard = {
  id: string;
  name: string;
  description: string;
  logoUrl: string;
  greeting: string;
  status: string;
  statusMessage: string;
  character: { assets: CharacterAssetView[] } | null;
  skills: SkillTile[];
};

type OfferedForm = { url: string; title: string; reason?: string };

type ChatMsg = {
  role: "user" | "assistant" | "system";
  content: string;
  forms?: OfferedForm[];
};

export default function ClientChatPage() {
  const [agent, setAgent] = useState<AgentCard | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionId] = useState(() => `client-${Math.random().toString(36).slice(2)}`);
  const [activeForm, setActiveForm] = useState<OfferedForm | null>(null);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch("/api/v1/agents/by-slug/alex")
      .then((r) => r.json())
      .then((data) => {
        if (!data.agent) {
          setError(data.error ?? "Агент недоступен");
          return;
        }
        setAgent(data.agent);
        setMessages([{ role: "assistant", content: data.agent.greeting }]);
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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const activeSkill = useMemo(
    () => agent?.skills.find((s) => s.id === activeSkillId) ?? null,
    [agent, activeSkillId],
  );

  const placeholder = activeSkill
    ? `Спросите про «${activeSkill.name}»…`
    : "Задайте вопрос…";

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
        body: JSON.stringify({
          message: text,
          sessionId,
          skillId: activeSkillId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.error ?? "Не удалось получить ответ" },
        ]);
      } else {
        const forms = (data.forms ?? []) as OfferedForm[];
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.reply ?? "Пустой ответ",
            forms,
          },
        ]);
        if (forms[0]) setActiveForm(forms[0]);
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
    <div className="flex min-h-screen flex-col bg-[radial-gradient(ellipse_at_top,_#f5f3ff_0%,_#ffffff_50%,_#fafafa_100%)] text-slate-800">
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-5 md:px-6">
        <Link href="/chat" className="inline-flex items-center">
          {agent?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={agent.logoUrl}
              alt={agent.name}
              className="h-10 w-auto max-w-[160px] object-contain"
            />
          ) : (
            <Image
              src="/brand/yani-logo.png"
              alt="YANI"
              width={120}
              height={40}
              className="h-9 w-auto object-contain"
              priority
            />
          )}
        </Link>
        <Link
          href="/login"
          className="rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm text-violet-700 hover:bg-violet-50"
        >
          Админка
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 pb-6 md:px-6">
        {/* Hero — centered */}
        <section className="flex flex-col items-center pt-2 text-center">
          {agent ? (
            <CharacterStage
              name={agent.name}
              assets={agent.character?.assets ?? []}
              status={agent.status}
              statusMessage={agent.statusMessage}
              variant="light"
              compact
              className="w-full max-w-sm border-0 bg-transparent shadow-none"
            />
          ) : (
            <div className="rounded-3xl border border-violet-100 bg-white px-10 py-16 text-slate-500">
              Загрузка героя…
            </div>
          )}

          {/* Question field under hero */}
          <form onSubmit={send} className="mt-2 w-full max-w-xl">
            <div className="flex gap-2 rounded-2xl border border-violet-200 bg-white p-2 shadow-sm">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={placeholder}
                disabled={!agent || busy}
                className="flex-1 rounded-xl bg-transparent px-3 py-2.5 outline-none placeholder:text-slate-400"
              />
              <button
                disabled={!agent || busy || !input.trim()}
                className="rounded-xl bg-violet-600 px-5 py-2.5 font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                Спросить
              </button>
            </div>
            {activeSkill && (
              <p className="mt-2 text-xs text-violet-600">
                Активный навык: <span className="font-medium">{activeSkill.name}</span>
              </p>
            )}
            {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
          </form>
        </section>

        {/* Skills tiles */}
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-slate-500">
              <Sparkles size={14} className="text-violet-500" />
              Навыки
            </h2>
            <button
              type="button"
              onClick={() => setActiveSkillId(null)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition",
                activeSkillId === null
                  ? "border-violet-400 bg-violet-600 text-white"
                  : "border-violet-200 bg-white text-violet-700 hover:bg-violet-50",
              )}
            >
              <RotateCcw size={12} />
              Все навыки
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {(agent?.skills ?? []).map((skill) => {
              const active = activeSkillId === skill.id;
              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => setActiveSkillId(active ? null : skill.id)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-2xl border p-4 text-center transition",
                    active
                      ? "border-violet-400 bg-violet-50 shadow-sm ring-2 ring-violet-200"
                      : "border-violet-100 bg-white hover:border-violet-300 hover:bg-violet-50/50",
                  )}
                >
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-violet-100">
                    {skill.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={skill.iconUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Sparkles size={20} className="text-violet-500" />
                    )}
                  </div>
                  <span className="text-sm font-medium text-slate-900">{skill.name}</span>
                  {skill.description && (
                    <span className="line-clamp-2 text-[11px] leading-snug text-slate-500">
                      {skill.description}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {agent && !agent.skills.length && (
            <p className="rounded-2xl border border-dashed border-violet-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
              Навыки ещё не назначены этому агенту
            </p>
          )}
        </section>

        {/* Chat at bottom */}
        <section className="mt-8 flex min-h-[280px] flex-1 flex-col rounded-3xl border border-violet-100 bg-white shadow-sm">
          <div className="border-b border-violet-100 px-5 py-3">
            <h2 className="text-sm font-medium text-slate-800">Чат</h2>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                  m.role === "user"
                    ? "ml-auto bg-violet-600 text-white"
                    : "bg-violet-50 text-slate-800",
                )}
              >
                <div className="whitespace-pre-wrap">{m.content}</div>
                {!!m.forms?.length && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {m.forms.map((form) => (
                      <button
                        key={form.url}
                        type="button"
                        onClick={() => setActiveForm(form)}
                        className="rounded-xl bg-white px-3 py-2 text-xs font-medium text-violet-700 shadow-sm ring-1 ring-violet-200 hover:bg-violet-50"
                      >
                        Открыть: {form.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="rounded-2xl bg-violet-50 px-4 py-3 text-sm text-violet-700">
                Герой думает…
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={send} className="border-t border-violet-100 p-4">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={placeholder}
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

      {activeForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-3 md:items-center md:p-8">
          <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-violet-100 px-4 py-3">
              <div>
                <p className="font-medium text-slate-900">{activeForm.title}</p>
                {activeForm.reason && (
                  <p className="text-xs text-slate-500">{activeForm.reason}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={activeForm.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-xl border border-violet-200 px-3 py-2 text-xs text-violet-700 hover:bg-violet-50"
                >
                  <ExternalLink size={14} />
                  В новой вкладке
                </a>
                <button
                  type="button"
                  onClick={() => setActiveForm(null)}
                  className="rounded-xl border border-violet-200 p-2 text-slate-600 hover:bg-violet-50"
                  aria-label="Закрыть"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <iframe
              title={activeForm.title}
              src={activeForm.url}
              className="h-full w-full flex-1 bg-white"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      )}
    </div>
  );
}
