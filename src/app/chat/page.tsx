"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { HeroBubble } from "@/components/HeroBubble";
import type { CharacterAssetView } from "@/characters/CharacterRenderer";
import { ArrowUp, History, Menu, MessageSquarePlus, Sparkles, Trash2, X } from "lucide-react";
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

type ChatMsg = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ChatSession = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMsg[];
};

const HISTORY_KEY = "yani-chat-history-v1";
const HISTORY_MS = 7 * 24 * 60 * 60 * 1000;

function freshSessions(sessions: ChatSession[]) {
  const cutoff = Date.now() - HISTORY_MS;
  return sessions.filter((s) => s.updatedAt >= cutoff).slice(0, 30);
}

function loadHistory(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const sessions = freshSessions(JSON.parse(raw) as ChatSession[]);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(sessions));
    return sessions;
  } catch {
    return [];
  }
}

function saveHistory(sessions: ChatSession[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(freshSessions(sessions)));
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
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

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
    const box = messagesRef.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  // Keyboard: only interactive-widget=resizes-content + h-dvh.
  // Do not pin/translate the shell to visualViewport — that double-moves
  // the composer and looks like a jump when the field is focused.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
    };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    const shell = shellRef.current;
    if (shell) {
      shell.style.top = "";
      shell.style.height = "";
      shell.style.transform = "";
    }

    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
    };
  }, []);

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

  async function clearHistory() {
    if (!sessions.length) return;
    const ids = sessions.map((s) => s.id);
    setConfirmClear(false);
    setSessions([]);
    localStorage.removeItem(HISTORY_KEY);
    if (agent) {
      void fetch(`/api/v1/agents/${agent.id}/history`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionIds: ids }),
      });
    }
    startNewChat();
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!agent || !input.trim() || busy) return;
    const text = input.trim();
    setInput("");
    setBusy(true);
    setError("");
    const withUser = [...messages, { role: "user" as const, content: text }];
    setMessages([...withUser, { role: "assistant", content: "" }]);

    try {
      const res = await fetch(`/api/v1/agents/${agent.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          sessionId,
          skillId: activeSkillId,
          stream: true,
        }),
      });
      const ctype = res.headers.get("content-type") ?? "";
      if (!ctype.includes("text/event-stream") || !res.body) {
        const data = await res.json().catch(() => ({}));
        const next: ChatMsg[] = [
          ...withUser,
          {
            role: "assistant",
            content: data.reply ?? data.error ?? "Не удалось получить ответ",
          },
        ];
        setMessages(next);
        persistSession(next);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      let failed = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split(/\n\n/);
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l.startsWith("data:"));
          if (!line) continue;
          let data: { delta?: string; reply?: string; error?: string; done?: boolean };
          try {
            data = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (data.delta) {
            acc += data.delta;
            setMessages([...withUser, { role: "assistant", content: acc }]);
          }
          if (data.error) failed = data.error;
          if (data.done && data.reply) acc = data.reply;
        }
      }
      const next: ChatMsg[] = [
        ...withUser,
        { role: "assistant", content: acc.trim() || failed || "Пустой ответ" },
      ];
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
    <div
      ref={shellRef}
      className="fixed inset-x-0 top-0 flex h-dvh flex-col overflow-hidden bg-white text-slate-900"
    >
      {/* Header — never scrolls away */}
      <header className="z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-yani-ring/40 bg-white px-5 sm:h-16 sm:px-6">
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

      {/* Hero — fixed in layout, not in scroll area (survives keyboard) */}
      <div className="flex shrink-0 flex-col items-center bg-white px-5 pb-2 pt-2 sm:px-6 sm:pb-3 sm:pt-3">
        {agent ? (
          <HeroBubble
            name={agent.name}
            assets={agent.character?.assets ?? []}
            status={agent.status}
            size="lg"
            className="h-24 w-24 sm:h-40 sm:w-40 md:h-48 md:w-48"
          />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-slate-50 text-slate-400 sm:h-40 sm:w-40">
            …
          </div>
        )}
        {hasConversation && (
          <p className="mt-1.5 text-xs text-slate-500">
            {activeSkill ? `Навык: ${activeSkill.name}` : agent?.name ?? "Yani"}
          </p>
        )}
      </div>

      {/* Only this middle zone scrolls */}
      <div
        ref={messagesRef}
        className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6"
      >
        {!hasConversation ? (
          <section className="flex flex-col items-center justify-start pb-4 text-center">
            <h1 className="mt-2 text-xl font-medium tracking-tight text-slate-900 sm:mt-4 sm:text-3xl">
              {greeting}
            </h1>
            {agent?.description?.trim() && (
              <p className="mt-2 max-w-lg px-2 text-sm leading-relaxed text-slate-500">
                {agent.description.trim()}
              </p>
            )}
            {activeSkill?.description?.trim() && (
              <p className="mt-2 max-w-lg px-2 text-sm leading-relaxed text-slate-600">
                {activeSkill.description.trim()}
              </p>
            )}

            <div className="mt-6 w-full pb-4 sm:mt-8">
              <div className="relative mb-2.5 flex h-7 items-center justify-center sm:mb-3 sm:h-8">
                <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-slate-400 sm:text-sm">
                  <Sparkles size={14} className="text-slate-400" />
                  Навыки
                </p>
                {activeSkillId && (
                  <button
                    type="button"
                    onClick={() => setActiveSkillId(null)}
                    aria-label="Все навыки"
                    className="absolute right-0 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center text-slate-500 active:text-slate-800 sm:h-8 sm:w-8"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4 sm:h-[18px] sm:w-[18px]" aria-hidden>
                      <path
                        fill="currentColor"
                        d="M12.2 5.1A6.9 6.9 0 1 0 18.6 16a1.35 1.35 0 1 0-2.2-1.55A4.2 4.2 0 1 1 12.15 7.8h.15l-1.15 1.15a1.35 1.35 0 0 0 1.91 1.91l3.05-3.05a1.35 1.35 0 0 0 0-1.91L13.06 2.85a1.35 1.35 0 1 0-1.91 1.91l1.05 1.05v.29Z"
                      />
                    </svg>
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
          <section className="flex flex-col pb-2">
            <div className="space-y-3 sm:space-y-4">
              {messages.map((m, i) => {
                const typing = busy && i === messages.length - 1 && m.role === "assistant";
                const text = m.content || (typing ? "Думаю…" : "");
                return (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed sm:max-w-[92%] sm:px-4 sm:py-3",
                      m.role === "user"
                        ? "ml-auto bg-yani-deep text-white"
                        : "bg-yani-soft/70 text-slate-800",
                    )}
                  >
                    <div className="whitespace-pre-wrap break-words">
                      {text}
                      {typing && m.content ? (
                        <span className="ml-0.5 inline-block animate-pulse text-yani-deep">▍</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
          </section>
        )}

        {error && <p className="mt-2 text-center text-sm text-rose-600">{error}</p>}
      </div>

      {/* Composer — in flex column, rides above keyboard */}
      <div
        className="z-20 shrink-0 bg-gradient-to-t from-white via-white to-transparent px-5 pt-2 sm:px-6 sm:pt-3"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
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
              <div>
                <h2 className="font-medium">История чатов</h2>
                <p className="text-xs text-slate-400">Хранится 7 дней</p>
              </div>
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
            {sessions.length > 0 && (
              <div className="border-t border-slate-100 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {confirmClear ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmClear(false)}
                      className="flex-1 rounded-xl px-3 py-3 text-sm text-slate-600 active:bg-slate-50"
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      onClick={() => void clearHistory()}
                      className="flex-1 rounded-xl bg-red-600 px-3 py-3 text-sm text-white active:bg-red-700"
                    >
                      Очистить
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm text-red-600 active:bg-red-50"
                  >
                    <Trash2 size={16} />
                    Очистить историю
                  </button>
                )}
              </div>
            )}
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
            </nav>
          </aside>
        </div>
      )}

    </div>
  );
}
