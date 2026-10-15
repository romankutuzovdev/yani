"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { HeroBubble } from "@/components/HeroBubble";
import type { CharacterAssetView } from "@/characters/CharacterRenderer";
import { ArrowUp, FileText, History, Menu, MessageSquarePlus, Sparkles, Trash2, X } from "lucide-react";
import { InstallAppButton } from "@/components/InstallAppButton";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { ThinkingDots } from "@/components/ThinkingDots";
import { hideOpenButtonToken, splitReplyButtons, type ReplyButton } from "@/lib/replyButtons";
import { CHAT_UNAVAILABLE, toChatUserMessage } from "@/lib/chatUserError";
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
  slug: string;
  description: string;
  logoUrl: string;
  homeIconUrl: string;
  greeting: string;
  asideText: string;
  orgName: string;
  status: string;
  statusMessage: string;
  character: { assets: CharacterAssetView[] } | null;
  skills: SkillTile[];
  docs: { id: string; title: string; url: string; openMode: "preview" | "direct" }[];
};

type ChatMsg = {
  role: "user" | "assistant" | "system";
  content: string;
  limit?: "month" | "day";
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
  const [docsOpen, setDocsOpen] = useState(false);
  const [popup, setPopup] = useState<ReplyButton | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputSizerRef = useRef<HTMLDivElement>(null);
  const [inputScroll, setInputScroll] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSessions(loadHistory());
  }, []);

  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get("slug")?.trim() ?? "";
    const slug = /^[a-z0-9][a-z0-9-]{0,80}$/i.test(fromQuery) ? fromQuery : "primary";
    void fetch(`/api/v1/agents/by-slug/${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.agent) {
          setError(data.error ?? "Агент недоступен");
          return;
        }
        setAgent(data.agent);
        const loaded = data.agent.slug as string;
        if (loaded && /^[a-z0-9][a-z0-9-]{0,80}$/i.test(loaded)) {
          const url = new URL(window.location.href);
          if (url.searchParams.get("slug") !== loaded) {
            url.pathname = "/chat";
            url.searchParams.set("slug", loaded);
            window.history.replaceState(null, "", `${url.pathname}${url.search}`);
          }
        }
      })
      .catch(() => setError("Не удалось загрузить агента"));
  }, []);

  useEffect(() => {
    if (!agent?.id) return;
    const es = new EventSource(`/api/v1/agents/${agent.id}/status/stream`);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setAgent((prev) => {
          if (!prev) return prev;
          if (prev.status === data.status && prev.statusMessage === data.statusMessage) return prev;
          return {
            ...prev,
            status: data.status,
            statusMessage: data.statusMessage,
          };
        });
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
  const limitLocked = messages.some((m) => m.limit === "month" || m.limit === "day");
  const greeting = agent?.greeting || "Чем я могу помочь?";

  useEffect(() => {
    const sizer = inputSizerRef.current;
    if (!sizer) return;
    setInputScroll(sizer.scrollHeight > 120);
  }, [input, greeting, limitLocked]);

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
        if (data.code === "monthly_limit" || data.code === "daily_limit") {
          const next: ChatMsg[] = [
            ...withUser,
            {
              role: "assistant",
              content: "",
              limit: data.code === "monthly_limit" ? "month" : "day",
            },
          ];
          setMessages(next);
          persistSession(next);
          return;
        }
        const next: ChatMsg[] = [
          ...withUser,
          {
            role: "assistant",
            content: toChatUserMessage(data.reply ?? data.error ?? CHAT_UNAVAILABLE),
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
          if (data.error) failed = toChatUserMessage(data.error);
          if (data.done && data.reply) acc = data.reply;
        }
      }
      const next: ChatMsg[] = [
        ...withUser,
        {
          role: "assistant",
          content: acc.trim() || failed || CHAT_UNAVAILABLE,
        },
      ];
      setMessages(next);
      persistSession(next);
    } catch {
      const next = [
        ...withUser,
        { role: "assistant" as const, content: CHAT_UNAVAILABLE },
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
      className="fixed inset-0 flex flex-col overflow-hidden bg-white text-slate-900"
    >
      {/* Header — never scrolls away */}
      <header className="z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-yani-ring/40 bg-white px-4 md:h-16 md:px-6">
        <Link
          href={agent?.slug ? `/chat?slug=${encodeURIComponent(agent.slug)}` : "/chat"}
          className="flex min-w-0 items-center gap-2"
          onClick={startNewChat}
        >
          {/* Brand mark only — agent logo must not replace Yani in the header */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/yani-logo.png"
            alt="yani"
            className="h-8 w-auto max-w-[72px] object-contain md:max-w-[120px]"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              const next = e.currentTarget.nextElementSibling;
              if (next instanceof HTMLElement) next.hidden = false;
            }}
          />
          <span hidden className="text-lg font-semibold tracking-tight text-slate-900">
            yani
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
          {agent?.slug ? (
            <InstallAppButton
              slug={agent.slug}
              name={agent.orgName || agent.name}
              iconUrl={agent.homeIconUrl || ""}
            />
          ) : null}
          <button
            type="button"
            onClick={() => {
              setHistoryOpen(true);
              setMenuOpen(false);
            }}
            className="inline-flex h-10 w-10 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white text-sm text-slate-700 active:bg-slate-50 md:h-auto md:w-auto md:px-3 md:py-1.5"
            aria-label="История чатов"
          >
            <History size={16} />
            <span className="hidden md:inline">История чатов</span>
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

      {/* Hero — stays on screen, including phones */}
      <div className="flex shrink-0 flex-col items-center bg-white px-4 pb-2 pt-3 md:px-6 md:pb-3">
        <div className="flex items-center justify-center gap-3 md:gap-5">
          {agent ? (
            <HeroBubble
              name={agent.name}
              assets={agent.character?.assets ?? []}
              status={agent.status}
              size="lg"
              className="h-28 w-28 shrink-0 md:h-48 md:w-48"
            />
          ) : (
            <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-400 md:h-48 md:w-48">
              …
            </div>
          )}
          {agent?.asideText?.trim() ? (
            <p className="max-w-[11rem] whitespace-pre-wrap text-left text-sm leading-snug text-slate-600 sm:max-w-xs sm:text-base md:block">
              {agent.asideText.trim()}
            </p>
          ) : null}
        </div>
        {hasConversation && (
          <p className="mt-1.5 hidden text-xs text-slate-500 md:block">
            {activeSkill ? `Навык: ${activeSkill.name}` : agent?.name ?? "Yani"}
          </p>
        )}
      </div>

      {/* Only this middle zone scrolls */}
      <div
        ref={messagesRef}
        className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-y-auto overscroll-contain px-4 md:px-6"
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

            {agent && agent.skills.length > 0 && (
            <div className="mt-6 w-full pb-4 sm:mt-8">
              <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center">
                <span />
                <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-slate-400">
                  <Sparkles size={14} className="text-slate-400" />
                  Навыки
                </p>
                <div className="flex justify-end">
                  {activeSkillId && (
                    <button
                      type="button"
                      onClick={() => setActiveSkillId(null)}
                      className="rounded-full bg-yani-deep px-3 py-1 text-xs font-medium text-white shadow-sm active:bg-yani-mid"
                    >
                      Закрыть
                    </button>
                  )}
                </div>
              </div>
              <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4">
                {agent.skills.map((skill) => {
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
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 active:bg-slate-50",
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
              </div>
            </div>
            )}
          </section>
        ) : (
          <section className="flex flex-col pb-2">
            <div className="space-y-4">
              {messages.map((m, i) => {
                if (m.limit) {
                  const month = m.limit === "month";
                  return (
                    <div
                      key={i}
                      className="mx-auto w-full max-w-md rounded-3xl border border-violet-200 bg-gradient-to-b from-violet-50 to-white px-5 py-6 text-center shadow-sm"
                    >
                      <p className="text-base font-semibold text-slate-900">
                        {month ? "Лимит запросов на месяц исчерпан" : "Лимит запросов на сегодня исчерпан"}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-slate-500">
                        {month
                          ? "В этом месяце новые сообщения больше не принимаются. Лимит обновится в начале следующего месяца."
                          : "На сегодня сообщения закончились. Завтра можно будет написать снова."}
                      </p>
                    </div>
                  );
                }
                const typing = busy && i === messages.length - 1 && m.role === "assistant";
                const waiting = typing && !m.content;
                const raw = m.content || "";
                const parsed =
                  m.role === "assistant" ? splitReplyButtons(hideOpenButtonToken(raw)) : { text: raw, buttons: [] };
                return (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[92%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed",
                      m.role === "user"
                        ? "ml-auto bg-yani-deep text-white"
                        : "bg-yani-soft/70 text-slate-800",
                    )}
                  >
                    {waiting ? (
                      <div className="break-words text-slate-600">
                        <ThinkingDots />
                      </div>
                    ) : parsed.text ? (
                      <div className="break-words">
                        <ChatMarkdown
                          text={parsed.text}
                          variant={m.role === "user" ? "user" : "assistant"}
                        />
                        {typing && m.content ? (
                          <span className="ml-0.5 inline-block animate-pulse text-yani-deep">▍</span>
                        ) : null}
                      </div>
                    ) : null}
                    {parsed.buttons.length ? (
                      <div className={cn("flex flex-col gap-2", parsed.text && "mt-3")}>
                        {parsed.buttons.map((button) =>
                          button.popup ? (
                            <button
                              key={button.label + button.href}
                              type="button"
                              onClick={() => setPopup(button)}
                              className="rounded-xl bg-yani-btn px-3 py-2.5 text-center text-sm font-medium !text-slate-900 hover:bg-yani-btn-hover"
                            >
                              {button.label}
                            </button>
                          ) : (
                            <a
                              key={button.label + button.href}
                              href={button.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-xl bg-yani-btn px-3 py-2.5 text-center text-sm font-medium !text-slate-900 hover:bg-yani-btn-hover"
                            >
                              {button.label}
                            </a>
                          ),
                        )}
                      </div>
                    ) : null}
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
        className="z-20 shrink-0 bg-gradient-to-t from-white via-white to-transparent px-6 pt-3"
        style={{ paddingBottom: "max(2.75rem, calc(env(safe-area-inset-bottom) + 2.25rem))" }}
      >
        <form
          onSubmit={send}
          className="mx-auto w-full max-w-3xl rounded-3xl border border-yani-ring/50 bg-white p-3 shadow-[0_8px_30px_rgba(139,111,212,0.12)] focus-within:border-yani-deep"
        >
          {activeSkill && (
            <div className="mb-2 flex items-center gap-2 px-1">
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
            <div className="relative min-w-0 flex-1">
              <div
                ref={inputSizerRef}
                aria-hidden
                className={`max-h-[120px] min-h-[44px] overflow-hidden whitespace-pre-wrap break-words px-2 py-2 text-[15px] leading-snug ${
                  input ? "invisible" : "text-slate-400"
                }`}
              >
                {input || (limitLocked ? "Лимит запросов исчерпан" : greeting) || "\u00a0"}
              </div>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                disabled={!agent || busy || limitLocked}
                enterKeyHint="send"
                style={{ overflowY: inputScroll ? "auto" : "hidden" }}
                className="chat-input absolute inset-0 w-full resize-none bg-transparent px-2 py-2 text-[15px] leading-snug text-slate-800 outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              />
            </div>
            <VoiceInputButton
              disabled={!agent || busy || limitLocked}
              value={input}
              onChange={setInput}
              onError={setError}
            />
            <button
              type="submit"
              disabled={!agent || busy || limitLocked || !input.trim()}
              className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yani-deep text-white transition active:bg-yani-mid disabled:bg-slate-200 disabled:text-slate-400"
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
            className="flex h-full w-full max-w-sm flex-col bg-white shadow-xl"
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
              {docsOpen ? (
                <button
                  type="button"
                  onClick={() => setDocsOpen(false)}
                  className="text-sm font-medium text-slate-700"
                >
                  ← Меню
                </button>
              ) : (
                <h2 className="font-medium">Меню</h2>
              )}
              <button
                type="button"
                onClick={() => {
                  setDocsOpen(false);
                  setMenuOpen(false);
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg active:bg-slate-50"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="space-y-1 overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm">
              {docsOpen ? (
                (agent?.docs ?? []).length ? (
                  (agent?.docs ?? []).map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => {
                        setDocsOpen(false);
                        setMenuOpen(false);
                        if (doc.openMode === "direct" && doc.url) {
                          window.open(doc.url, "_blank", "noopener,noreferrer");
                          return;
                        }
                        setPopup({ label: doc.title, href: `/docs/${doc.id}`, popup: true });
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-3.5 text-left active:bg-slate-50"
                    >
                      <FileText size={16} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-3.5 text-slate-500">Файлов пока нет</p>
                )
              ) : (
                <>
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
                  <button
                    type="button"
                    onClick={() => setDocsOpen(true)}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-3.5 text-left active:bg-slate-50"
                  >
                    <FileText size={16} /> Документация
                  </button>
                </>
              )}
            </nav>
          </aside>
        </div>
      )}

      {popup && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-3 sm:items-center"
          onClick={() => setPopup(null)}
        >
          <div
            className="flex h-[min(92dvh,760px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-3">
              <p className="truncate text-sm font-medium text-slate-800">{popup.label}</p>
              <button
                type="button"
                onClick={() => setPopup(null)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50"
                aria-label="Закрыть"
              >
                <X size={18} />
              </button>
            </div>
            <iframe title={popup.label} src={popup.href} className="min-h-0 w-full flex-1 border-0 bg-white" />
          </div>
        </div>
      )}

    </div>
  );
}
