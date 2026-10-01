"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { HeroBubble } from "@/components/HeroBubble";
import type { CharacterAssetView } from "@/characters/CharacterRenderer";
import {
  ArrowUp,
  ExternalLink,
  History,
  Menu,
  MessageSquarePlus,
  Sparkles,
  X,
} from "lucide-react";
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

type ChatSession = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMsg[];
};

const HISTORY_KEY = "yani-chat-history-v1";

function loadHistory(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatSession[];
  } catch {
    return [];
  }
}

function saveHistory(sessions: ChatSession[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(sessions.slice(0, 30)));
}

export default function ClientChatPage() {
  const [agent, setAgent] = useState<AgentCard | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState(
    () => `client-${Math.random().toString(36).slice(2)}`,
  );
  const [activeForm, setActiveForm] = useState<OfferedForm | null>(null);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setSessions(loadHistory());
  }, []);

  useEffect(() => {
    void fetch("/api/v1/agents/by-slug/alex")
      .then((r) => r.json())
      .then((data) => {
        if (!data.agent) {
          setError(data.error ?? "Агент недоступен");
          return;
        }
        setAgent(data.agent);
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

  const hasConversation = messages.some((m) => m.role === "user");
  const greeting = agent?.greeting || "Чем я могу помочь?";

  function persistSession(nextMessages: ChatMsg[]) {
    const title =
      nextMessages.find((m) => m.role === "user")?.content.slice(0, 48) || "Новый чат";
    setSessions((prev) => {
      const others = prev.filter((s) => s.id !== sessionId);
      const updated: ChatSession[] = [
        { id: sessionId, title, updatedAt: Date.now(), messages: nextMessages },
        ...others,
      ];
      saveHistory(updated);
      return updated;
    });
  }

  function startNewChat() {
    const id = `client-${Math.random().toString(36).slice(2)}`;
    setSessionId(id);
    setMessages([]);
    setActiveSkillId(null);
    setInput("");
    setError("");
    setHistoryOpen(false);
    setMenuOpen(false);
    inputRef.current?.focus();
  }

  function openSession(s: ChatSession) {
    setSessionId(s.id);
    setMessages(s.messages);
    setHistoryOpen(false);
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!agent || !input.trim() || busy) return;
    const text = input.trim();
    setInput("");
    setBusy(true);
    setError("");
    const withUser = [...messages, { role: "user" as const, content: text }];
    setMessages(withUser);

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
      let next: ChatMsg[];
      if (!res.ok) {
        next = [
          ...withUser,
          { role: "assistant", content: data.error ?? "Не удалось получить ответ" },
        ];
      } else {
        const forms = (data.forms ?? []) as OfferedForm[];
        next = [
          ...withUser,
          { role: "assistant", content: data.reply ?? "Пустой ответ", forms },
        ];
        if (forms[0]) setActiveForm(forms[0]);
      }
      setMessages(next);
      persistSession(next);
    } catch {
      const next = [
        ...withUser,
        { role: "assistant" as const, content: "Сетевая ошибка. Попробуйте ещё раз." },
      ];
      setMessages(next);
      persistSession(next);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col bg-white text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-100 bg-white/90 px-4 py-3 backdrop-blur md:px-6">
        <Link href="/chat" className="flex items-center gap-2" onClick={startNewChat}>
          {agent?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={agent.logoUrl}
              alt="yani"
              className="h-8 w-auto max-w-[120px] object-contain"
            />
          ) : (
            <span className="text-lg font-semibold tracking-tight text-slate-900">yani</span>
          )}
        </Link>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setHistoryOpen(true);
              setMenuOpen(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            <History size={15} />
            <span className="hidden sm:inline">История чатов</span>
          </button>
          <button
            type="button"
            onClick={startNewChat}
            className="rounded-full border border-slate-200 p-2 text-slate-700 hover:bg-slate-50"
            aria-label="Новый чат"
          >
            <MessageSquarePlus size={18} />
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(true);
              setHistoryOpen(false);
            }}
            className="rounded-full border border-slate-200 p-2 text-slate-700 hover:bg-slate-50"
            aria-label="Меню"
          >
            <Menu size={18} />
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-36 pt-4 md:px-6">
        {!hasConversation ? (
          <section className="flex flex-1 flex-col items-center justify-center pb-8 text-center">
            {agent ? (
              <HeroBubble
                name={agent.name}
                assets={agent.character?.assets ?? []}
                status={agent.status}
                size="lg"
              />
            ) : (
              <div className="flex h-40 w-40 items-center justify-center rounded-full bg-slate-50 text-slate-400">
                …
              </div>
            )}

            <h1 className="mt-6 text-2xl font-medium tracking-tight text-slate-900 sm:text-3xl">
              Чем я могу помочь?
            </h1>
            {agent?.statusMessage && (
              <p className="mt-2 text-sm text-slate-500">{agent.statusMessage}</p>
            )}

            {/* Skills */}
            <div className="mt-8 w-full">
              <div className="mb-3 flex items-center justify-between px-1">
                <p className="text-sm font-medium text-slate-500">Навыки</p>
                {activeSkillId && (
                  <button
                    type="button"
                    onClick={() => setActiveSkillId(null)}
                    className="text-xs text-sky-600 hover:underline"
                  >
                    Все навыки
                  </button>
                )}
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {(agent?.skills ?? []).map((skill) => {
                  const active = activeSkillId === skill.id;
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => setActiveSkillId(active ? null : skill.id)}
                      className={cn(
                        "flex w-[132px] shrink-0 flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-center transition",
                        active
                          ? "border-sky-400 bg-sky-50 ring-2 ring-sky-100"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                      )}
                    >
                      <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                        {skill.iconUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={skill.iconUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Sparkles size={18} className="text-sky-500" />
                        )}
                      </div>
                      <span className="line-clamp-2 text-sm font-medium text-slate-800">
                        {skill.name}
                      </span>
                    </button>
                  );
                })}
                {agent && !agent.skills.length && (
                  <p className="w-full py-4 text-sm text-slate-400">Навыки не назначены</p>
                )}
              </div>
            </div>
          </section>
        ) : (
          <section className="flex flex-1 flex-col">
            <div className="mb-4 flex items-center gap-3">
              {agent && (
                <HeroBubble
                  name={agent.name}
                  assets={agent.character?.assets ?? []}
                  status={agent.status}
                  size="sm"
                />
              )}
              <div>
                <p className="text-sm font-medium text-slate-800">{agent?.name ?? "Yani"}</p>
                <p className="text-xs text-slate-500">
                  {activeSkill ? `Навык: ${activeSkill.name}` : "Все навыки"}
                </p>
              </div>
            </div>

            <div className="flex-1 space-y-4">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[92%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed",
                    m.role === "user"
                      ? "ml-auto bg-sky-600 text-white"
                      : "bg-slate-50 text-slate-800",
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
                          className="rounded-xl bg-white px-3 py-2 text-xs font-medium text-sky-700 shadow-sm ring-1 ring-sky-100"
                        >
                          Открыть: {form.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {busy && (
                <div className="w-fit rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  Думаю…
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* skills chips while chatting */}
            {(agent?.skills?.length ?? 0) > 0 && (
              <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setActiveSkillId(null)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1.5 text-xs",
                    !activeSkillId
                      ? "border-sky-400 bg-sky-50 text-sky-700"
                      : "border-slate-200 text-slate-600",
                  )}
                >
                  Все
                </button>
                {agent!.skills.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActiveSkillId(s.id === activeSkillId ? null : s.id)}
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-1.5 text-xs",
                      activeSkillId === s.id
                        ? "border-sky-400 bg-sky-50 text-sky-700"
                        : "border-slate-200 text-slate-600",
                    )}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {error && <p className="mt-2 text-center text-sm text-rose-600">{error}</p>}
      </main>

      {/* Bottom composer */}
      <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-white via-white to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-4">
        <form
          onSubmit={send}
          className="mx-auto w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-3 shadow-[0_8px_30px_rgba(15,23,42,0.08)]"
        >
          {activeSkill && (
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs text-sky-700">
                {activeSkill.name}
              </span>
              <button
                type="button"
                onClick={() => setActiveSkillId(null)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                сбросить
              </button>
            </div>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={greeting}
            disabled={!agent || busy}
            className="max-h-40 min-h-[44px] w-full resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-slate-400"
          />
          <div className="mt-1 flex items-center justify-between gap-2 px-1">
            <div className="flex min-w-0 gap-2 overflow-x-auto">
              {(agent?.skills ?? []).slice(0, 4).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveSkillId(s.id === activeSkillId ? null : s.id)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
                    activeSkillId === s.id
                      ? "border-sky-400 bg-sky-50 text-sky-700"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {s.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.iconUrl} alt="" className="h-3.5 w-3.5 rounded-sm object-cover" />
                  ) : (
                    <Sparkles size={12} />
                  )}
                  {s.name}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={!agent || busy || !input.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white transition hover:bg-sky-500 disabled:bg-slate-200 disabled:text-slate-400"
              aria-label="Отправить"
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </form>
      </div>

      {/* History drawer */}
      {historyOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/30" onClick={() => setHistoryOpen(false)}>
          <aside
            className="flex h-full w-full max-w-sm flex-col bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="font-medium">История чатов</h2>
              <button type="button" onClick={() => setHistoryOpen(false)} className="rounded-lg p-2 hover:bg-slate-50">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto p-3">
              <button
                type="button"
                onClick={startNewChat}
                className="mb-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-200 px-3 py-3 text-sm text-sky-700 hover:bg-sky-50"
              >
                <MessageSquarePlus size={16} />
                Новый чат
              </button>
              {sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => openSession(s)}
                  className={cn(
                    "block w-full rounded-xl px-3 py-3 text-left text-sm hover:bg-slate-50",
                    s.id === sessionId && "bg-slate-50",
                  )}
                >
                  <p className="line-clamp-1 font-medium text-slate-800">{s.title}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {new Date(s.updatedAt).toLocaleString()}
                  </p>
                </button>
              ))}
              {!sessions.length && (
                <p className="px-2 py-6 text-center text-sm text-slate-400">Пока пусто</p>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Menu drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/30" onClick={() => setMenuOpen(false)}>
          <aside
            className="flex h-full w-full max-w-xs flex-col bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="font-medium">Меню</h2>
              <button type="button" onClick={() => setMenuOpen(false)} className="rounded-lg p-2 hover:bg-slate-50">
                <X size={18} />
              </button>
            </div>
            <nav className="space-y-1 p-3 text-sm">
              <button
                type="button"
                onClick={startNewChat}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left hover:bg-slate-50"
              >
                <MessageSquarePlus size={16} /> Новый чат
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setHistoryOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left hover:bg-slate-50"
              >
                <History size={16} /> История чатов
              </button>
              <Link
                href="/login"
                className="flex w-full items-center gap-2 rounded-xl px-3 py-3 hover:bg-slate-50"
              >
                Админка
              </Link>
            </nav>
          </aside>
        </div>
      )}

      {activeForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-3 md:items-center md:p-8">
          <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
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
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs text-sky-700 hover:bg-sky-50"
                >
                  <ExternalLink size={14} />
                  В новой вкладке
                </a>
                <button
                  type="button"
                  onClick={() => setActiveForm(null)}
                  className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
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
