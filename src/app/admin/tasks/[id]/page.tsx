"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Event = { id: string; type: string; summary: string; createdAt: string };
type Execution = {
  id: string;
  status: string;
  iterations: number;
  result?: string;
  error?: string;
  events: Event[];
};
type Task = {
  id: string;
  title: string;
  instruction: string;
  status: string;
  result?: string;
  error?: string;
  agent: { name: string };
  executions: Execution[];
};

const STATUS_RU: Record<string, string> = {
  PENDING: "Ожидает",
  RUNNING: "Выполняется",
  COMPLETED: "Готово",
  FAILED: "Ошибка",
  CANCELLED: "Отменено",
};

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const [task, setTask] = useState<Task | null>(null);

  async function load() {
    const res = await fetch(`/api/tasks/${params.id}`);
    const data = await res.json();
    setTask(data.task);
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [params.id]);

  async function action(act: "run" | "cancel") {
    await fetch(`/api/tasks/${params.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: act }),
    });
    await load();
  }

  if (!task) return <p className="text-slate-500">Загрузка…</p>;
  const execution = task.executions[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">{task.title}</h1>
          <p className="mt-1 text-slate-500">
            {task.agent.name} · {STATUS_RU[task.status] ?? task.status}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => action("run")}
            className="rounded-xl bg-violet-600 px-4 py-2 text-white hover:bg-violet-500"
          >
            Запустить
          </button>
          <button
            onClick={() => action("cancel")}
            className="rounded-xl border border-violet-200 px-4 py-2 text-slate-700"
          >
            Отменить
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="mb-2 font-medium text-slate-900">Инструкция</h2>
        <p className="whitespace-pre-wrap text-sm text-slate-700">{task.instruction}</p>
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-medium text-slate-900">Timeline выполнения</h2>
        <div className="space-y-3">
          {(execution?.events ?? []).map((ev) => (
            <div key={ev.id} className="flex gap-4 border-l-2 border-violet-300 pl-4">
              <div>
                <p className="text-sm text-slate-800">{ev.summary}</p>
                <p className="text-xs text-slate-500">
                  {ev.type} · {new Date(ev.createdAt).toLocaleTimeString("ru-RU")}
                </p>
              </div>
            </div>
          ))}
          {!execution?.events?.length && (
            <p className="text-sm text-slate-500">Событий пока нет</p>
          )}
        </div>
      </section>

      {(task.result || execution?.result) && (
        <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-medium text-slate-900">Результат</h2>
          <p className="whitespace-pre-wrap text-sm text-slate-700">
            {task.result || execution?.result}
          </p>
        </section>
      )}

      {(task.error || execution?.error) && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
          <h2 className="mb-2 font-medium text-rose-800">Ошибка</h2>
          <p className="text-sm text-rose-700">{task.error || execution?.error}</p>
        </section>
      )}
    </div>
  );
}
