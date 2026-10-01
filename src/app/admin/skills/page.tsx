"use client";

import { useEffect, useState } from "react";

type Skill = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  enabled: boolean;
};

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [form, setForm] = useState({
    name: "",
    description: "",
    systemPrompt: "",
    tools: "web_search,memory_search",
  });

  async function load() {
    const res = await fetch("/api/skills");
    const data = await res.json();
    setSkills(data.skills ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    await fetch("/api/skills", {
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
    setForm({ name: "", description: "", systemPrompt: "", tools: "" });
    await load();
  }

  async function toggle(skill: Skill) {
    await fetch(`/api/skills/${skill.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !skill.enabled }),
    });
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
        <p className="mt-1 text-slate-500">Специализированные способности агентов</p>
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
            placeholder="Инструменты через запятую"
            className="rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
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
          placeholder="System prompt навыка"
          className="mt-3 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
          value={form.systemPrompt}
          onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
        />
        <button
          onClick={create}
          className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 font-medium text-white hover:bg-violet-500"
        >
          Создать
        </button>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {skills.map((skill) => (
          <div key={skill.id} className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-medium text-slate-900">{skill.name}</h3>
                <p className="mt-1 text-sm text-slate-500">{skill.description}</p>
                <p className="mt-2 text-xs text-slate-500">
                  Инструменты: {(Array.isArray(skill.tools) ? skill.tools : []).join(", ") || "нет"}
                </p>
              </div>
              <span className="text-xs uppercase text-slate-500">
                {skill.enabled ? "вкл" : "выкл"}
              </span>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => toggle(skill)}
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
        ))}
      </div>
    </div>
  );
}
