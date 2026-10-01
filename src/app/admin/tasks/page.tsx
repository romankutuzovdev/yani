"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Task = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  agent: { id: string; name: string };
};

type Agent = { id: string; name: string };

const STATUS_RU: Record<string, string> = {
  PENDING: "Ожидает",
  RUNNING: "Выполняется",
  COMPLETED: "Готово",
  FAILED: "Ошибка",
  CANCELLED: "Отменено",
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [form, setForm] = useState({
    agentId: "",
    title: "",
    instruction: "",
    runImmediately: true,
  });

  async function load() {
    const [t, a] = await Promise.all([
      fetch("/api/tasks").then((r) => r.json()),
      fetch("/api/agents").then((r) => r.json()),
    ]);
    setTasks(t.tasks ?? []);
    setAgents(a.agents ?? []);
    if (!form.agentId && a.agents?.[0]?.id) {
      setForm((f) => ({ ...f, agentId: a.agents[0].id }));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createTask() {
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm((f) => ({ ...f, title: "", instruction: "" }));
    await load();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">Задачи</h1>
        <p className="mt-1 text-slate-500">Назначайте работу агентам и смотрите timeline выполнения</p>
      </div>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-medium text-slate-900">Создать задачу</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm text-slate-700">
            Агент
            <select
              className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
              value={form.agentId}
              onChange={(e) => setForm({ ...form, agentId: e.target.value })}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Название
            <input
              className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
        </div>
        <label className="mt-3 block text-sm text-slate-700">
          Инструкция
          <textarea
            className="mt-1 min-h-28 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
            value={form.instruction}
            onChange={(e) => setForm({ ...form, instruction: e.target.value })}
          />
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.runImmediately}
            onChange={(e) => setForm({ ...form, runImmediately: e.target.checked })}
          />
          Запустить сразу
        </label>
        <button
          onClick={createTask}
          className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 font-medium text-white hover:bg-violet-500"
        >
          Создать задачу
        </button>
      </section>

      <div className="overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-violet-50 text-slate-500">
            <tr>
              <th className="px-4 py-3">Задача</th>
              <th className="px-4 py-3">Агент</th>
              <th className="px-4 py-3">Статус</th>
              <th className="px-4 py-3">Создана</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className="border-t border-violet-50 hover:bg-violet-50/50">
                <td className="px-4 py-3">
                  <Link href={`/admin/tasks/${t.id}`} className="text-violet-700 hover:underline">
                    {t.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-700">{t.agent.name}</td>
                <td className="px-4 py-3 text-xs uppercase text-slate-500">
                  {STATUS_RU[t.status] ?? t.status}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(t.createdAt).toLocaleString("ru-RU")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
