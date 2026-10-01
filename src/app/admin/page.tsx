"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wrench } from "lucide-react";

type DashboardData = {
  stats: {
    agents: number;
    tasks: number;
    skills: number;
    tools: number;
    todayRequests: number;
    todayTokens: number;
    monthlyRequests: number;
    monthlyTokens: number;
  };
  recentTasks: Array<{
    id: string;
    title: string;
    status: string;
    agent: { name: string };
    createdAt: string;
  }>;
  recentLogs: Array<{ id: string; message: string; level: string; createdAt: string }>;
};

type Tool = { id: string; name: string; enabled: boolean; description: string };

const STATUS_RU: Record<string, string> = {
  PENDING: "Ожидает",
  RUNNING: "Выполняется",
  COMPLETED: "Готово",
  FAILED: "Ошибка",
  CANCELLED: "Отменено",
};

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);

  useEffect(() => {
    void fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData);
    void fetch("/api/tools")
      .then((r) => r.json())
      .then((d) => setTools((d.tools ?? []).slice(0, 5)));
  }, []);

  const stats = data?.stats;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Обзор</h1>
        <p className="mt-1 text-slate-500">Агенты, навыки и использование LLM</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Агенты", stats?.agents, "/admin/agents"],
          ["Навыки", stats?.skills, "/admin/skills"],
          ["Инструменты", stats?.tools, "/admin/tools"],
          ["Запросов сегодня", stats?.todayRequests],
          ["Токенов сегодня", stats?.todayTokens],
          ["Запросов за месяц", stats?.monthlyRequests],
          ["Токенов за месяц", stats?.monthlyTokens],
        ].map(([label, value, href]) => {
          const card = (
            <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm transition hover:border-violet-200">
              <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{value ?? "—"}</p>
            </div>
          );
          return href ? (
            <Link key={String(label)} href={String(href)}>
              {card}
            </Link>
          ) : (
            <div key={String(label)}>{card}</div>
          );
        })}
      </div>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wrench size={16} className="text-violet-600" />
            <h2 className="font-medium text-slate-900">Инструменты</h2>
          </div>
          <Link href="/admin/tools" className="text-sm text-violet-600 hover:underline">
            Все ({stats?.tools ?? tools.length})
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {tools.map((tool) => (
            <div key={tool.id} className="rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-slate-800">{tool.name}</p>
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    tool.enabled ? "bg-emerald-400" : "bg-slate-300"
                  }`}
                />
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{tool.description}</p>
            </div>
          ))}
          {!tools.length && <p className="text-sm text-slate-500">Пока нет инструментов</p>}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-medium text-slate-900">Недавние задачи</h2>
            <Link href="/admin/tasks" className="text-sm text-violet-600 hover:underline">
              Все
            </Link>
          </div>
          <div className="space-y-3">
            {(data?.recentTasks ?? []).map((t) => (
              <Link
                key={t.id}
                href={`/admin/tasks/${t.id}`}
                className="block rounded-xl border border-violet-100 bg-violet-50/40 px-4 py-3 hover:border-violet-200"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-800">{t.title}</p>
                    <p className="text-xs text-slate-500">{t.agent.name}</p>
                  </div>
                  <span className="text-xs uppercase text-slate-500">
                    {STATUS_RU[t.status] ?? t.status}
                  </span>
                </div>
              </Link>
            ))}
            {!data?.recentTasks?.length && (
              <p className="text-sm text-slate-500">Задач пока нет</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-medium text-slate-900">Системные логи</h2>
            <Link href="/admin/logs" className="text-sm text-violet-600 hover:underline">
              Все
            </Link>
          </div>
          <div className="space-y-3">
            {(data?.recentLogs ?? []).map((l) => (
              <div key={l.id} className="rounded-xl border border-violet-100 bg-violet-50/40 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700">{l.message}</p>
                  <span className="text-xs text-slate-500">{l.level}</span>
                </div>
              </div>
            ))}
            {!data?.recentLogs?.length && (
              <p className="text-sm text-slate-500">Логов пока нет</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
