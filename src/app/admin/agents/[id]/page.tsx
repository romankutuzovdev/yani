"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CharacterStage } from "@/components/CharacterStage";
import { ModelSelect } from "@/components/ModelSelect";
import {
  ALL_CHARACTER_STATES,
  STATE_LABELS,
  normalizeAssetUrl,
} from "@/characters/CharacterRenderer";
import type { CharacterState } from "@prisma/client";

type Asset = {
  state: string;
  type: string;
  url: string;
  mimeType: string;
};

type SkillItem = {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  enabled?: boolean;
};

type AgentSkillRow = {
  skillId: string;
  enabled: boolean;
  visible: boolean;
  sortOrder: number;
  skill: SkillItem;
};

type AgentDetail = {
  id: string;
  name: string;
  description: string;
  logoUrl: string;
  greeting: string;
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
  skills: AgentSkillRow[];
  tools: Array<{ tool: { id: string; name: string } }>;
};

const STATES = ALL_CHARACTER_STATES;

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLog, setChatLog] = useState<Array<{ role: string; content: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [previewState, setPreviewState] = useState<CharacterState | null>(null);
  const [spentLabel, setSpentLabel] = useState("");

  async function load() {
    const [a, s] = await Promise.all([
      fetch(`/api/agents/${params.id}`).then((r) => r.json()),
      fetch("/api/skills").then((r) => r.json()),
    ]);
    const raw = a.agent as AgentDetail & {
      skills: Array<{
        skillId?: string;
        enabled?: boolean;
        visible?: boolean;
        sortOrder?: number;
        skill: SkillItem;
      }>;
    };
    if (raw) {
      raw.skills = (raw.skills ?? [])
        .map((row, i) => ({
          skillId: row.skillId ?? row.skill.id,
          enabled: row.enabled ?? true,
          visible: row.visible ?? true,
          sortOrder: row.sortOrder ?? i,
          skill: row.skill,
        }))
        .sort((x, y) => x.sortOrder - y.sortOrder);
      raw.logoUrl = raw.logoUrl ?? "";
      raw.greeting = raw.greeting ?? "";
    }
    setAgent(raw);
    setSkills(s.skills ?? []);
    try {
      const usage = await fetch(`/api/llm/usage?agentId=${params.id}`).then((r) => r.json());
      const row = (usage.byAgent ?? []).find((a: { agentId: string }) => a.agentId === params.id);
      setSpentLabel(row?.costLabel ?? "$0");
    } catch {
      setSpentLabel("");
    }
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

  async function save() {
    if (!agent) return;
    setSaving(true);
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: agent.name,
        description: agent.description,
        logoUrl: agent.logoUrl,
        greeting: agent.greeting,
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
        skillAssignments: agent.skills.map((s, i) => ({
          skillId: s.skillId,
          enabled: s.enabled,
          visible: s.visible,
          sortOrder: i,
        })),
      }),
    });
    setSaving(false);
    setMessage(res.ok ? "Сохранено" : "Ошибка сохранения");
    await load();
  }

  async function uploadLogo(file: File) {
    const form = new FormData();
    form.set("file", file);
    await fetch(`/api/agents/${params.id}/logo`, { method: "POST", body: form });
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
          <p className="text-slate-500">Лого, hero, приветствие, промпт и навыки</p>
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

      <section className="grid gap-4 rounded-2xl border border-violet-100 bg-white p-5 shadow-sm md:grid-cols-[140px_1fr]">
        <label className="flex h-32 w-32 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-violet-200 bg-violet-50 text-center text-xs text-violet-600 hover:border-violet-400">
          {agent.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={agent.logoUrl} alt="logo" className="h-full w-full object-contain p-2" />
          ) : (
            <span>Логотип</span>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadLogo(file);
            }}
          />
        </label>
        <div className="space-y-3">
          <label className="block text-sm text-slate-700">
            Название
            <input
              className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
              value={agent.name}
              onChange={(e) => setAgent({ ...agent, name: e.target.value })}
            />
          </label>
          <label className="block text-sm text-slate-700">
            Приветствие
            <textarea
              className="mt-1 min-h-20 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
              value={agent.greeting}
              onChange={(e) => setAgent({ ...agent, greeting: e.target.value })}
              placeholder="Привет! Чем могу помочь?"
            />
          </label>
          <label className="block text-sm text-slate-700">
            Описание
            <textarea
              className="mt-1 min-h-16 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
              value={agent.description}
              onChange={(e) => setAgent({ ...agent, description: e.target.value })}
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Модель этого агента</h2>
        <p className="mt-1 text-sm text-slate-500">
          Только этот агент отвечает выбранной моделью. Цена в списке — вход / выход за 1 млн токенов.
          Потрачено на запросы этого агента: <span className="font-medium text-slate-800">{spentLabel || "—"}</span>
        </p>
        <div className="mt-3 max-w-xl">
          <ModelSelect
            value={agent.model ?? ""}
            onChange={(model) => setAgent({ ...agent, model })}
          />
        </div>
        <p className="mt-2 text-xs text-slate-500">Сохраняется вместе с кнопкой «Сохранить» внизу страницы.</p>
      </section>

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
                  Картинка или web-видео (WebM / MP4 / Ogg), до 50 МБ
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
                const isVideo =
                  asset?.type === "VIDEO" ||
                  asset?.mimeType?.startsWith("video/") ||
                  /\.(webm|mp4|ogv|ogg)(\?|$)/i.test(asset?.url ?? "");
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
                        {isVideo ? " · видео" : ""}
                      </p>
                      {asset ? (
                        isVideo ? (
                          <video
                            src={normalizeAssetUrl(asset.url)}
                            className="mx-auto mt-2 h-24 w-24 rounded-xl object-contain"
                            muted
                            loop
                            autoPlay
                            playsInline
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={normalizeAssetUrl(asset.url)}
                            alt={state}
                            className="mx-auto mt-2 h-24 w-24 rounded-xl object-contain"
                          />
                        )
                      ) : (
                        <p className="mt-6 text-xs text-slate-500">Нет медиа</p>
                      )}
                    </button>
                    <label className="mt-2 inline-block cursor-pointer text-[11px] text-violet-600/70 hover:text-violet-700">
                      Загрузить
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,video/webm,video/mp4,video/ogg"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void upload(state, file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </section>

        </div>
      </div>

      <section className="rounded-2xl border border-violet-100 bg-white shadow-sm p-5">
          <h2 className="mb-3 font-medium">Назначенные навыки</h2>
          <p className="mb-4 text-xs text-slate-500">
            Включите навык, настройте видимость на пользовательском экране и порядок плиток.
          </p>
          <div className="space-y-2">
            {skills.map((skill) => {
              const assigned = agent.skills.find((s) => s.skillId === skill.id);
              const checked = Boolean(assigned);
              return (
                <div
                  key={skill.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-2 text-sm"
                >
                  <label className="flex min-w-[140px] flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setAgent({
                            ...agent,
                            skills: [
                              ...agent.skills,
                              {
                                skillId: skill.id,
                                enabled: true,
                                visible: true,
                                sortOrder: agent.skills.length,
                                skill,
                              },
                            ],
                          });
                        } else {
                          setAgent({
                            ...agent,
                            skills: agent.skills.filter((s) => s.skillId !== skill.id),
                          });
                        }
                      }}
                    />
                    {skill.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={skill.iconUrl} alt="" className="h-6 w-6 rounded object-cover" />
                    ) : null}
                    <span>{skill.name}</span>
                  </label>
                  {assigned && (
                    <>
                      <label className="flex items-center gap-1 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={assigned.visible}
                          onChange={(e) => {
                            setAgent({
                              ...agent,
                              skills: agent.skills.map((s) =>
                                s.skillId === skill.id
                                  ? { ...s, visible: e.target.checked }
                                  : s,
                              ),
                            });
                          }}
                        />
                        виден
                      </label>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="rounded border border-violet-200 px-2 py-0.5 text-xs"
                          onClick={() => {
                            const list = [...agent.skills];
                            const i = list.findIndex((s) => s.skillId === skill.id);
                            if (i <= 0) return;
                            [list[i - 1], list[i]] = [list[i], list[i - 1]];
                            setAgent({ ...agent, skills: list });
                          }}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="rounded border border-violet-200 px-2 py-0.5 text-xs"
                          onClick={() => {
                            const list = [...agent.skills];
                            const i = list.findIndex((s) => s.skillId === skill.id);
                            if (i < 0 || i >= list.length - 1) return;
                            [list[i], list[i + 1]] = [list[i + 1], list[i]];
                            setAgent({ ...agent, skills: list });
                          }}
                        >
                          ↓
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>

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
