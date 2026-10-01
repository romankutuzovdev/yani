"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, FileText, ImagePlus, Sparkles, Trash2, Upload } from "lucide-react";

type Skill = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  iconUrl: string;
  documentUrl: string;
  documentName: string;
  documentText: string;
  tools: string[];
  enabled: boolean;
  sortOrder: number;
};

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [form, setForm] = useState({
    name: "",
    description: "",
    systemPrompt: "",
    model: "",
    tools: "web_search,memory_search",
  });
  const [createDoc, setCreateDoc] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const res = await fetch("/api/skills");
    const data = await res.json();
    setSkills(data.skills ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    if (!form.name.trim() || !form.description.trim()) {
      setMessage("Укажите название и описание");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          tools: form.tools
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Не удалось создать");
        return;
      }
      if (createDoc && data.skill?.id) {
        const fd = new FormData();
        fd.set("file", createDoc);
        const up = await fetch(`/api/skills/${data.skill.id}/document`, {
          method: "POST",
          body: fd,
        });
        const upData = await up.json();
        if (!up.ok) {
          setMessage(upData.error ?? "Навык создан, но Word не загрузился");
          setForm({ name: "", description: "", systemPrompt: "", model: "", tools: "" });
          setCreateDoc(null);
          await load();
          return;
        }
      }
      setForm({ name: "", description: "", systemPrompt: "", model: "", tools: "" });
      setCreateDoc(null);
      setMessage("Навык создан");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/skills/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
  }

  async function move(skill: Skill, dir: -1 | 1) {
    const sorted = [...skills].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((s) => s.id === skill.id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    await Promise.all([
      patch(skill.id, { sortOrder: swap.sortOrder }),
      patch(swap.id, { sortOrder: skill.sortOrder }),
    ]);
  }

  async function uploadIcon(id: string, file: File) {
    const fd = new FormData();
    fd.set("file", file);
    await fetch(`/api/skills/${id}/icon`, { method: "POST", body: fd });
    await load();
  }

  async function uploadDocument(id: string, file: File) {
    setBusy(true);
    setMessage("");
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch(`/api/skills/${id}/document`, { method: "POST", body: fd });
      const data = await res.json();
      setMessage(res.ok ? "Word-файл прикреплён" : data.error ?? "Ошибка загрузки");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function removeDocument(id: string) {
    setBusy(true);
    await fetch(`/api/skills/${id}/document`, { method: "DELETE" });
    setMessage("Документ удалён");
    await load();
    setBusy(false);
  }

  async function remove(id: string) {
    await fetch(`/api/skills/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">Навыки</h1>
        <p className="mt-1 text-slate-500">
          Промпт — что делать с текстом. Word (.docx) — источник текста для навыка.
        </p>
      </div>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-medium text-slate-900">Создать навык</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            placeholder="Название"
            className="rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            placeholder="Модель (пусто = модель агента)"
            className="rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
          <input
            placeholder="Инструменты через запятую"
            className="rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 md:col-span-2"
            value={form.tools}
            onChange={(e) => setForm({ ...form, tools: e.target.value })}
          />
        </div>
        <textarea
          placeholder="Описание"
          className="mt-3 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <textarea
          placeholder="Промпт навыка — что делать с текстом из Word (например: отвечай по этому регламенту, цитируй пункты…)"
          className="mt-3 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
          rows={4}
          value={form.systemPrompt}
          onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
        />

        <div className="mt-3 rounded-xl border border-dashed border-violet-200 bg-violet-50/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-800">Файл Word (.docx)</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Текст из файла попадёт в контекст навыка вместе с промптом
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-violet-50">
              <Upload size={16} />
              {createDoc ? "Заменить файл" : "Выбрать .docx"}
              <input
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => setCreateDoc(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          {createDoc && (
            <p className="mt-2 flex items-center gap-2 text-sm text-violet-700">
              <FileText size={14} />
              {createDoc.name}
              <button
                type="button"
                className="ml-auto text-xs text-slate-500 hover:text-rose-600"
                onClick={() => setCreateDoc(null)}
              >
                убрать
              </button>
            </p>
          )}
        </div>

        <button
          onClick={create}
          disabled={busy}
          className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 font-medium text-white hover:bg-violet-500 disabled:opacity-60"
        >
          {busy ? "Создание…" : "Создать"}
        </button>
        {message && <p className="mt-2 text-sm text-slate-600">{message}</p>}
      </section>

      <div className="space-y-3">
        {skills.map((skill) => (
          <div
            key={skill.id}
            className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-start gap-4">
              <label className="relative flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-dashed border-violet-200 bg-violet-50 hover:border-violet-400">
                {skill.iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={skill.iconUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus size={20} className="text-violet-400" />
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadIcon(skill.id, file);
                  }}
                />
              </label>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-medium text-slate-900">{skill.name}</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                      skill.enabled
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {skill.enabled ? "активен" : "выкл"}
                  </span>
                  <span className="text-xs text-slate-400">#{skill.sortOrder}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">{skill.description}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Модель: {skill.model || "как у агента"} · Инструменты:{" "}
                  {(Array.isArray(skill.tools) ? skill.tools : []).join(", ") || "нет"}
                </p>

                <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText size={14} className="text-violet-500" />
                    {skill.documentName ? (
                      <>
                        <span className="text-sm text-slate-700">{skill.documentName}</span>
                        <span className="text-xs text-slate-400">
                          · {skill.documentText?.length ?? 0} симв.
                        </span>
                        <a
                          href={skill.documentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-violet-600 hover:underline"
                        >
                          скачать
                        </a>
                        <button
                          type="button"
                          onClick={() => void removeDocument(skill.id)}
                          className="ml-auto inline-flex items-center gap-1 text-xs text-rose-600 hover:underline"
                        >
                          <Trash2 size={12} /> удалить
                        </button>
                      </>
                    ) : (
                      <span className="text-sm text-slate-500">Word-файл не прикреплён</span>
                    )}
                    <label className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-violet-50">
                      <Upload size={12} />
                      {skill.documentName ? "Заменить" : "Прикрепить .docx"}
                      <input
                        type="file"
                        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadDocument(skill.id, file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>

                {editingId === skill.id && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      className="w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 text-sm"
                      defaultValue={skill.systemPrompt}
                      id={`prompt-${skill.id}`}
                      rows={4}
                      placeholder="Промпт — что делать с текстом из Word"
                    />
                    <input
                      className="w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 text-sm"
                      defaultValue={skill.model}
                      id={`model-${skill.id}`}
                      placeholder="Модель"
                    />
                    <button
                      type="button"
                      className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm text-white"
                      onClick={() => {
                        const prompt = (
                          document.getElementById(`prompt-${skill.id}`) as HTMLTextAreaElement
                        )?.value;
                        const model = (
                          document.getElementById(`model-${skill.id}`) as HTMLInputElement
                        )?.value;
                        void patch(skill.id, { systemPrompt: prompt, model });
                        setEditingId(null);
                      }}
                    >
                      Сохранить промпт
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => move(skill, -1)}
                  className="rounded-lg border border-violet-200 p-2 text-slate-600 hover:bg-violet-50"
                  title="Выше"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  onClick={() => move(skill, 1)}
                  className="rounded-lg border border-violet-200 p-2 text-slate-600 hover:bg-violet-50"
                  title="Ниже"
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  onClick={() => setEditingId(editingId === skill.id ? null : skill.id)}
                  className="rounded-lg border border-violet-200 px-3 py-1.5 text-sm text-slate-700"
                >
                  Промпт
                </button>
                <button
                  onClick={() => patch(skill.id, { enabled: !skill.enabled })}
                  className="rounded-lg border border-violet-200 px-3 py-1.5 text-sm text-slate-700"
                >
                  {skill.enabled ? "Выключить" : "Включить"}
                </button>
                <button
                  onClick={() => remove(skill.id)}
                  className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-600"
                >
                  Удалить
                </button>
              </div>
            </div>
          </div>
        ))}
        {!skills.length && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Sparkles size={14} /> Пока нет навыков
          </p>
        )}
      </div>
    </div>
  );
}
