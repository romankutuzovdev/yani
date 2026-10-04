"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type DashboardData = {
  stats: {
    agents: number;
    tasks: number;
    skills: number;
    todayRequests: number;
    monthlyRequests: number;
    todayCost?: string;
    monthCost?: string;
  };
  recentTasks: Array<{
    id: string;
    title: string;
    status: string;
    agent: { name: string };
    createdAt: string;
  }>;
};

const STATUS_RU: Record<string, string> = {
  PENDING: "Ожидает",
  RUNNING: "Выполняется",
  COMPLETED: "Готово",
  FAILED: "Ошибка",
  CANCELLED: "Отменено",
};

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    void fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData);
  }, []);

  const stats = data?.stats;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Обзор</h1>
        <p className="mt-1 text-slate-500">Агенты, навыки и использование LLM</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ["Агенты", stats?.agents, "/admin/agents"],
          ["Навыки", stats?.skills, "/admin/skills"],
          ["Запросов сегодня", stats?.todayRequests],
          ["Потрачено сегодня", stats?.todayCost, "/admin/settings"],
          ["Запросов за месяц", stats?.monthlyRequests],
          ["Потрачено за месяц", stats?.monthCost, "/admin/settings"],
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
          {!data?.recentTasks?.length && <p className="text-sm text-slate-500">Задач пока нет</p>}
        </div>
      </section>
    </div>
  );
}
