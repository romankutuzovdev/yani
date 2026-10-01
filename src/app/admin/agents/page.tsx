"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Agent = {
  id: string;
  name: string;
  description: string;
  logoUrl?: string;
  status: string;
  model: string;
  _count: { tasks: number; memories: number };
};

const STATUS_RU: Record<string, string> = {
  IDLE: "Свободен",
  THINKING: "Думает",
  WORKING: "Работает",
  SUCCESS: "Успех",
  ERROR: "Ошибка",
  ONLINE: "Онлайн",
  OFFLINE: "Офлайн",
  WAITING: "Ждёт",
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    const res = await fetch("/api/agents");
    const data = await res.json();
    setAgents(data.agents ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createAgent() {
    if (!name.trim()) return;
    setCreating(true);
    await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setName("");
    setCreating(false);
    await load();
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Агенты</h1>
          <p className="mt-1 text-slate-500">Создавайте и настраивайте AI-агентов с персонажем</p>
        </div>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Имя нового агента"
            className="rounded-xl border border-violet-200 bg-white px-4 py-2.5 outline-none focus:border-violet-400"
          />
          <button
            onClick={createAgent}
            disabled={creating}
            className="rounded-xl bg-violet-600 px-4 py-2.5 font-medium text-white hover:bg-violet-500 disabled:opacity-60"
          >
            Создать
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => (
          <Link
            key={agent.id}
            href={`/admin/agents/${agent.id}`}
            className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm transition hover:border-violet-200"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {agent.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={agent.logoUrl}
                    alt=""
                    className="h-10 w-10 rounded-xl object-contain bg-violet-50 p-1"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-sm font-semibold text-violet-700">
                    {agent.name.slice(0, 1)}
                  </div>
                )}
                <h2 className="text-xl font-medium text-slate-900">{agent.name}</h2>
              </div>
              <span className="text-xs uppercase text-slate-500">
                {STATUS_RU[agent.status] ?? agent.status}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 text-sm text-slate-500">
              {agent.description || "Без описания"}
            </p>
            <div className="mt-4 flex gap-4 text-xs text-slate-500">
              <span>{agent.model}</span>
              <span>{agent._count.tasks} задач</span>
              <span>{agent._count.memories} память</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
