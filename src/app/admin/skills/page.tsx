"use client";

import { useEffect, useState } from "react";
import { Sparkles, Trash2 } from "lucide-react";

type Skill = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  enabled: boolean;
};

const emptyForm = { name: "", description: "", systemPrompt: "" };

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState(emptyForm);
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
    if (!form.name.trim()) {
      setMessage("Укажите название навыка");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim(),
          systemPrompt: form.systemPrompt,
          tools: [],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Не удалось создать");
        return;
      }
      setForm(emptyForm);
      setMessage("Навык создан");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    if (!edit.name.trim()) {
      setMessage("Укажите название навыка");
      return;
    }
    setBusy(true);
    setMessage("");
    const res = await fetch(`/api/skills/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: edit.name.trim(),
        description: edit.description.trim(),
        systemPrompt: edit.systemPrompt,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMessage(data.error ?? "Не удалось сохранить");
      return;
    }
    setEditingId(null);
    setMessage("Сохранено");
    await load();
  }

  async function remove(id: string) {
    await fetch(`/api/skills/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">Навыки</h1>
        <p className="mt-1 text-slate-500">Название, описание и промпт навыка.</p>
      </div>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-medium text-slate-900">Новый навык</h2>
        <label className="block text-sm text-slate-700">
          Название навыка
          <input
            className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="mt-3 block text-sm text-slate-700">
          Описание
          <textarea
            className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 text-sm"
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label className="mt-3 block text-sm text-slate-700">
          Промпт навыка
          <textarea
            className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 text-sm"
            rows={6}
            placeholder="Например: отвечай только в рамках этого описания"
            value={form.systemPrompt}
            onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
          />
        </label>
        <button
          onClick={create}
          disabled={busy}
          className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 font-medium text-white hover:bg-violet-500 disabled:opacity-60"
        >
          {busy ? "Создание…" : "Создать навык"}
        </button>
        {message && <p className="mt-2 text-sm text-slate-600">{message}</p>}
      </section>

      <div className="space-y-3">
        {skills.map((skill) => (
          <div key={skill.id} className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-medium text-slate-900">{skill.name}</h3>
                <p className="mt-1 text-sm text-slate-600">{skill.description || "Без описания"}</p>
                <p className="mt-2 line-clamp-3 text-sm text-slate-500">
                  {skill.systemPrompt?.trim() || "Промпт не задан"}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (editingId === skill.id) {
                      setEditingId(null);
                      return;
                    }
                    setEditingId(skill.id);
                    setEdit({
                      name: skill.name,
                      description: skill.description || "",
                      systemPrompt: skill.systemPrompt || "",
                    });
                  }}
                  className="rounded-lg border border-violet-200 px-3 py-1.5 text-sm text-slate-700"
                >
                  {editingId === skill.id ? "Закрыть" : "Изменить"}
                </button>
                <button
                  type="button"
                  onClick={() => remove(skill.id)}
                  className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-600"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {editingId === skill.id && (
              <div className="mt-4 space-y-3">
                <label className="block text-sm text-slate-700">
                  Название навыка
                  <input
                    className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
                    value={edit.name}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  Описание
                  <textarea
                    className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 text-sm"
                    rows={3}
                    value={edit.description}
                    onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  Промпт навыка
                  <textarea
                    className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 text-sm"
                    rows={6}
                    value={edit.systemPrompt}
                    onChange={(e) => setEdit({ ...edit, systemPrompt: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveEdit(skill.id)}
                  className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm text-white disabled:opacity-60"
                >
                  Сохранить
                </button>
              </div>
            )}
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
