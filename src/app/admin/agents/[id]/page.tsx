"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CharacterStage } from "@/components/CharacterStage";
import {
  ALL_CHARACTER_STATES,
  STATE_LABELS,
} from "@/characters/CharacterRenderer";
import type { CharacterState } from "@prisma/client";

type Asset = {
  state: string;
  type: string;
  url: string;
  mimeType: string;
};

type AgentDetail = {
  id: string;
  name: string;
  description: string;
  personality: string;
  role: string;
  communicationStyle: string;
  rules: string;
  goals: string;
  restrictions: string;
  additionalInstructions: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxIterations: number;
  status: string;
  statusMessage: string;
  character: { assets: Asset[] } | null;
  skills: Array<{ skill: { id: string; name: string } }>;
  tools: Array<{ tool: { id: string; name: string } }>;
};

const STATES = ALL_CHARACTER_STATES;

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [skills, setНавыки] = useState<Array<{ id: string; name: string }>>([]);
  const [tools, setИнструменты] = useState<Array<{ id: string; name: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLog, setChatLog] = useState<Array<{ role: string; content: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [previewState, setPreviewState] = useState<CharacterState | null>(null);

  async function load() {
    const [a, s, t] = await Promise.all([
      fetch(`/api/agents/${params.id}`).then((r) => r.json()),
      fetch("/api/skills").then((r) => r.json()),
      fetch("/api/tools").then((r) => r.json()),
    ]);
    setAgent(a.agent);
    setНавыки(s.skills ?? []);
    setИнструменты(t.tools ?? []);
  }

  useEffect(() => {
    void load();
    const es = new EventSource(`/api/agents/${params.id}/status/stream`);
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
  }, [params.id]);

  const selectedSkillIds = useMemo(
    () => new Set(agent?.skills.map((s) => s.skill.id) ?? []),
    [agent],
  );
  const selectedToolIds = useMemo(
    () => new Set(agent?.tools.map((t) => t.tool.id) ?? []),
    [agent],
  );

  async function save() {
    if (!agent) return;
    setSaving(true);
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: agent.name,
        description: agent.description,
        personality: agent.personality,
        role: agent.role,
        communicationStyle: agent.communicationStyle,
        rules: agent.rules,
        goals: agent.goals,
        restrictions: agent.restrictions,
        additionalInstructions: agent.additionalInstructions,
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        temperature: agent.temperature,
        maxIterations: agent.maxIterations,
        skillIds: Array.from(selectedSkillIds),
        toolIds: Array.from(selectedToolIds),
      }),
    });
    setSaving(false);
    setMessage(res.ok ? "Сохранено" : "Ошибка сохранения");
    await load();
  }

  async function upload(state: string, file: File) {
    const form = new FormData();
    form.set("state", state);
    form.set("file", file);
    await fetch(`/api/agents/${params.id}/character`, { method: "POST", body: form });
    await load();
  }

  async function sendChat() {
    if (!chatInput.trim() || !agent) return;
    const msg = chatInput;
    setChatInput("");
    setChatLog((prev) => [...prev, { role: "user", content: msg }]);
    const res = await fetch(`/api/agents/${agent.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, sessionId: "admin" }),
    });
    const data = await res.json();
    setChatLog((prev) => [
      ...prev,
      { role: "assistant", content: data.reply ?? data.error ?? "Нет ответа" },
    ]);
  }

  if (!agent) {
    return <p className="text-slate-500">Загрузка агента…</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{agent.name}</h1>
          <p className="text-slate-500">Персонаж, характер, навыки и инструменты</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-violet-600 px-4 py-2.5 font-medium text-white hover:bg-violet-500"
        >
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
      {message && <p className="text-sm text-violet-600">{message}</p>}

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <CharacterStage
          name={agent.name}
          assets={(agent.character?.assets ?? []) as never}
          status={agent.status}
          statusMessage={agent.statusMessage}
          previewState={previewState}
        />

        <div className="space-y-6">
          <section className="rounded-2xl border border-violet-100 bg-white shadow-sm p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-medium">Галерея эмоций</h2>
                <p className="text-xs text-slate-500">
                  Клик — превью · загрузка — заменить
                </p>
              </div>
              {previewState && (
                <button
                  type="button"
                  onClick={() => setPreviewState(null)}
                  className="rounded-lg border border-violet-200 px-3 py-1.5 text-xs text-violet-700"
                >
                  Живой статус
                </button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {STATES.map((state) => {
                const asset = agent.character?.assets.find((a) => a.state === state);
                const active = previewState === state;
                return (
                  <div
                    key={state}
                    className={`rounded-xl border p-3 text-center transition ${
                      active
                        ? "border-violet-400 bg-violet-50"
                        : "border-violet-100 bg-violet-50/50 hover:border-violet-300"
                    }`}
                  >
                    <button
                      type="button"
                      className="w-full"
                      onClick={() => setPreviewState(state)}
                    >
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        {STATE_LABELS[state]}
                      </p>
                      {asset ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={asset.url}
                          alt={state}
                          className="mx-auto mt-2 h-24 w-24 rounded-xl object-cover"
                        />
                      ) : (
                        <p className="mt-6 text-xs text-slate-500">Нет картинки</p>
                      )}
                    </button>
                    <label className="mt-2 inline-block cursor-pointer text-[11px] text-violet-600/70 hover:text-violet-700">
                      Заменить
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void upload(state, file);
                        }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-violet-100 bg-white shadow-sm p-5">
            <h2 className="mb-4 font-medium">Конструктор system prompt</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {(
                [
                  ["name", "Имя"],
                  ["role", "Роль"],
                  ["personality", "Характер"],
                  ["communicationStyle", "Стиль общения"],
                  ["goals", "Цели"],
                  ["rules", "Правила"],
                  ["restrictions", "Ограничения"],
                  ["model", "Модель"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="text-sm text-slate-300">
                  {label}
                  <input
                    className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
                    value={String(agent[key] ?? "")}
                    onChange={(e) => setAgent({ ...agent, [key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <label className="mt-3 block text-sm text-slate-700">
              Рабочий документ / промпт (до ~10 стр.)
              <p className="mt-1 text-xs font-normal text-slate-500">
                Сюда вставь инструкцию для DeepSeek: как отвечать, когда предлагать форму и какие ссылки открывать во фрейме.
              </p>
              <textarea
                className="mt-2 min-h-56 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 text-sm leading-relaxed text-slate-800"
                value={agent.additionalInstructions}
                onChange={(e) => setAgent({ ...agent, additionalInstructions: e.target.value })}
                placeholder={`Пример:
Ты консультант по услугам.

Если пользователь спрашивает про ипотеку — предложи форму заявки:
https://example.com/forms/ipoteka
Назови её «Заявка на ипотеку».

Если спрашивает про страховку — форма:
https://example.com/forms/insurance

Не выдумывай другие ссылки.`}
              />
            </label>
            <label className="mt-3 block text-sm text-slate-700">
              Свой system prompt (опционально)
              <textarea
                className="mt-1 min-h-28 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 font-mono text-xs text-slate-800"
                value={agent.systemPrompt}
                onChange={(e) => setAgent({ ...agent, systemPrompt: e.target.value })}
                placeholder="Оставьте пустым — соберётся из полей выше"
              />
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-300">
                Температура
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  max={2}
                  className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
                  value={agent.temperature}
                  onChange={(e) =>
                    setAgent({ ...agent, temperature: Number(e.target.value) })
                  }
                />
              </label>
              <label className="text-sm text-slate-300">
                Макс. итераций
                <input
                  type="number"
                  min={1}
                  max={50}
                  className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
                  value={agent.maxIterations}
                  onChange={(e) =>
                    setAgent({ ...agent, maxIterations: Number(e.target.value) })
                  }
                />
              </label>
            </div>
          </section>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-violet-100 bg-white shadow-sm p-5">
          <h2 className="mb-3 font-medium">Навыки</h2>
          <div className="space-y-2">
            {skills.map((skill) => (
              <label key={skill.id} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={selectedSkillIds.has(skill.id)}
                  onChange={(e) => {
                    const next = new Set(selectedSkillIds);
                    if (e.target.checked) next.add(skill.id);
                    else next.delete(skill.id);
                    setAgent({
                      ...agent,
                      skills: Array.from(next).map((id) => ({
                        skill: skills.find((s) => s.id === id)!,
                      })),
                    });
                  }}
                />
                {skill.name}
              </label>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-violet-100 bg-white shadow-sm p-5">
          <h2 className="mb-3 font-medium">Инструменты</h2>
          <div className="space-y-2">
            {tools.map((tool) => (
              <label key={tool.id} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={selectedToolIds.has(tool.id)}
                  onChange={(e) => {
                    const next = new Set(selectedToolIds);
                    if (e.target.checked) next.add(tool.id);
                    else next.delete(tool.id);
                    setAgent({
                      ...agent,
                      tools: Array.from(next).map((id) => ({
                        tool: tools.find((t) => t.id === id)!,
                      })),
                    });
                  }}
                />
                {tool.name}
              </label>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-violet-100 bg-white shadow-sm p-5">
        <h2 className="mb-3 font-medium">Чат с агентом</h2>
        <div className="mb-3 max-h-72 space-y-2 overflow-y-auto rounded-xl bg-violet-50/50 p-4">
          {chatLog.map((m, i) => (
            <div
              key={i}
              className={`rounded-lg px-3 py-2 text-sm ${
                m.role === "user" ? "bg-violet-600 text-white" : "bg-violet-50 text-slate-800"
              }`}
            >
              <span className="mr-2 text-xs uppercase text-slate-500">{m.role}</span>
              {m.content}
            </div>
          ))}
          {!chatLog.length && <p className="text-sm text-slate-500">Начните диалог</p>}
        </div>
        <div className="flex gap-2">
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void sendChat()}
            placeholder="Напишите агенту…"
            className="flex-1 rounded-xl border border-violet-200 bg-violet-50/40 px-4 py-3 outline-none focus:border-violet-400"
          />
          <button
            onClick={sendChat}
            className="rounded-xl bg-violet-600 px-5 py-3 font-medium text-white hover:bg-violet-500"
          >
            Отправить
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Виджет:{" "}
          <code className="rounded bg-black/40 px-1">{`<script src="${typeof window !== "undefined" ? window.location.origin : ""}/widget.js" data-agent-id="${agent.id}"></script>`}</code>
        </p>
      </section>
    </div>
  );
}
