"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { HeroBubble } from "@/components/HeroBubble";
import type { CharacterAssetView } from "@/characters/CharacterRenderer";
import {
  ArrowLeft,
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

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

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
    <div className="relative flex min-h-dvh flex-col overflow-x-hidden bg-white text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-yani-ring/40 bg-white/95 px-5 backdrop-blur supports-[backdrop-filter]:bg-white/80 sm:h-16 sm:px-6">
        <Link href="/chat" className="flex min-w-0 items-center gap-2" onClick={startNewChat}>
          {agent?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={agent.logoUrl}
              alt="yani"
              className="h-7 w-auto max-w-[100px] object-contain sm:h-8 sm:max-w-[120px]"
            />
          ) : (
            <span className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
              yani
            </span>
          )}
        </Link>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => {
              setHistoryOpen(true);
              setMenuOpen(false);
            }}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 active:bg-slate-50 sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-sm"
            aria-label="История чатов"
          >
            <History size={16} />
            <span className="hidden sm:inline">История чатов</span>
          </button>
          <button
            type="button"
            onClick={startNewChat}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-700 active:bg-slate-50"
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
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-700 active:bg-slate-50"
            aria-label="Меню"
          >
            <Menu size={18} />
          </button>
        </div>
      </header>

      {/* Main */}
      <main
        className={cn(
          "mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 pt-3 sm:px-6 sm:pt-4",
          "pb-[calc(6.5rem+env(safe-area-inset-bottom))]",
        )}
      >
        {/* Hero always stays on screen — same place when chat starts */}
        <div className="sticky top-14 z-20 -mx-5 flex flex-col items-center bg-white/95 px-5 pb-3 pt-2 backdrop-blur supports-[backdrop-filter]:bg-white/90 sm:top-16 sm:-mx-6 sm:px-6 sm:pb-4">
          {agent ? (
            <HeroBubble
              name={agent.name}
              assets={agent.character?.assets ?? []}
              status={agent.status}
              size="lg"
              className="h-28 w-28 sm:h-44 sm:w-44 md:h-52 md:w-52"
            />
          ) : (
            <div className="flex h-28 w-28 items-center justify-center rounded-full bg-slate-50 text-slate-400 sm:h-40 sm:w-40">
              …
            </div>
          )}
          {hasConversation && (
            <p className="mt-2 text-xs text-slate-500">
              {activeSkill ? `Навык: ${activeSkill.name}` : agent?.name ?? "Yani"}
            </p>
          )}
        </div>

        {!hasConversation ? (
          <section className="flex flex-1 flex-col items-center justify-start text-center sm:pb-8">
            <h1 className="mt-4 text-xl font-medium tracking-tight text-slate-900 sm:mt-6 sm:text-3xl">
              Чем я могу помочь?
            </h1>
            {agent?.statusMessage && (
              <p className="mt-1.5 max-w-sm px-2 text-xs text-slate-500 sm:mt-2 sm:text-sm">
                {agent.statusMessage}
              </p>
            )}

            {/* Skills — равные отступы сверху (от заголовка) и снизу */}
            <div className="mt-6 w-full pb-6 sm:mt-8 sm:pb-8">
              <div className="mb-2.5 flex flex-col items-center gap-2.5 sm:mb-3 sm:gap-3">
                <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-slate-400 sm:text-sm">
                  <Sparkles size={14} className="text-slate-400" />
                  Навыки
                </p>
                {activeSkillId && (
                  <button
                    type="button"
                    onClick={() => setActiveSkillId(null)}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-400 active:text-slate-500"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 text-slate-400">
                      <ArrowLeft size={13} />
                    </span>
                    Все навыки
                  </button>
                )}
              </div>
              <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4">
                {(agent?.skills ?? []).map((skill) => {
                  const active = activeSkillId === skill.id;
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => setActiveSkillId(active ? null : skill.id)}
                      className={cn(
                        "flex w-full flex-col items-center justify-center gap-1.5 rounded-2xl border px-2 py-3 text-center transition active:scale-[0.98] sm:gap-2 sm:px-3 sm:py-4",
                        active
                          ? "border-yani-mid bg-yani-soft ring-2 ring-yani-ring/50"
                          : "border-slate-200 bg-white active:bg-slate-50 sm:hover:border-slate-300 sm:hover:bg-slate-50",
                      )}
                    >
                      <div className="mx-auto flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-slate-100 sm:h-11 sm:w-11">
                        {skill.iconUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={skill.iconUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Sparkles size={16} className="text-yani-mid" />
                        )}
                      </div>
                      <span className="line-clamp-2 w-full text-center text-[13px] font-medium leading-snug text-slate-800 sm:text-sm">
                        {skill.name}
                      </span>
                    </button>
                  );
                })}
                {agent && !agent.skills.length && (
                  <p className="col-span-full py-4 text-sm text-slate-400">Навыки не назначены</p>
                )}
              </div>
            </div>
          </section>
        ) : (
          <section className="flex flex-1 flex-col">
            <div className="flex-1 space-y-3 sm:space-y-4">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed sm:max-w-[92%] sm:px-4 sm:py-3",
                    m.role === "user"
                      ? "ml-auto bg-yani-deep text-white"
                      : "bg-yani-soft/70 text-slate-800",
                  )}
                >
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                  {!!m.forms?.length && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {m.forms.map((form) => (
                        <button
                          key={form.url}
                          type="button"
                          onClick={() => setActiveForm(form)}
                          className="rounded-xl bg-white px-3 py-2 text-xs font-medium text-yani-ink shadow-sm ring-1 ring-yani-ring/50"
                        >
                          Открыть: {form.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {busy && (
                <div className="w-fit rounded-2xl bg-yani-soft/70 px-4 py-3 text-sm text-slate-500">
                  Думаю…
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          </section>
        )}

        {error && <p className="mt-2 text-center text-sm text-rose-600">{error}</p>}
      </main>

      {/* Bottom composer */}
      <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-white via-white to-transparent px-5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pt-4">
        <form
          onSubmit={send}
          className="mx-auto w-full max-w-3xl rounded-[1.35rem] border border-yani-ring/50 bg-white p-2.5 shadow-[0_8px_30px_rgba(139,111,212,0.12)] sm:rounded-3xl sm:p-3"
        >
          {activeSkill && (
            <div className="mb-1.5 flex items-center gap-2 px-1 sm:mb-2">
              <span className="max-w-[70%] truncate rounded-full bg-yani-soft px-2.5 py-0.5 text-xs text-yani-ink">
                {activeSkill.name}
              </span>
              <button
                type="button"
                onClick={() => setActiveSkillId(null)}
                className="shrink-0 text-xs text-slate-400 active:text-slate-600"
              >
                сбросить
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={greeting}
              disabled={!agent || busy}
              enterKeyHint="send"
              className="max-h-[120px] min-h-[40px] w-full flex-1 resize-none bg-transparent px-2 py-2 text-base leading-snug outline-none placeholder:text-slate-400 sm:min-h-[44px] sm:text-[15px]"
            />
            <button
              type="submit"
              disabled={!agent || busy || !input.trim()}
              className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yani-deep text-white transition active:bg-yani-mid disabled:bg-slate-200 disabled:text-slate-400 sm:h-10 sm:w-10"
              aria-label="Отправить"
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </form>
      </div>

      {/* History drawer */}
      {historyOpen && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-slate-950/30"
          onClick={() => setHistoryOpen(false)}
        >
          <aside
            className="flex h-full w-full max-w-full flex-col bg-white shadow-xl sm:max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-14 items-center justify-between border-b border-slate-100 px-4">
              <h2 className="font-medium">История чатов</h2>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg active:bg-slate-50"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto overscroll-contain p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={startNewChat}
                className="mb-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-200 px-3 py-3.5 text-sm text-yani-ink active:bg-yani-soft"
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
                    "block w-full rounded-xl px-3 py-3.5 text-left text-sm active:bg-slate-50",
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
        <div
          className="fixed inset-0 z-40 flex justify-end bg-slate-950/30"
          onClick={() => setMenuOpen(false)}
        >
          <aside
            className="flex h-full w-[min(100%,20rem)] flex-col bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-14 items-center justify-between border-b border-slate-100 px-4">
              <h2 className="font-medium">Меню</h2>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg active:bg-slate-50"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="space-y-1 p-3 text-sm pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={startNewChat}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-3.5 text-left active:bg-slate-50"
              >
                <MessageSquarePlus size={16} /> Новый чат
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setHistoryOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-3.5 text-left active:bg-slate-50"
              >
                <History size={16} /> История чатов
              </button>
              <Link
                href="/login"
                className="flex w-full items-center gap-2 rounded-xl px-3 py-3.5 active:bg-slate-50"
              >
                Админка
              </Link>
            </nav>
          </aside>
        </div>
      )}

      {activeForm && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-950/40 p-0 sm:items-center sm:p-8">
          <div className="flex h-dvh w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl sm:h-[85vh] sm:rounded-3xl">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{activeForm.title}</p>
                {activeForm.reason && (
                  <p className="truncate text-xs text-slate-500">{activeForm.reason}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                <a
                  href={activeForm.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-200 px-2.5 text-xs text-yani-ink active:bg-yani-soft sm:px-3"
                >
                  <ExternalLink size={14} />
                  <span className="hidden xs:inline sm:inline">Вкладка</span>
                </a>
                <button
                  type="button"
                  onClick={() => setActiveForm(null)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 active:bg-slate-50"
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
