"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type DayVisit = {
  day: string;
  label: string;
  requests: number;
  visitors: number;
};

type RegionVisit = {
  label: string;
  requests: number;
  visitors: number;
};

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
  visitsByDay?: DayVisit[];
  visitsByRegion?: RegionVisit[];
};

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    void fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData);
  }, []);

  const stats = data?.stats;
  const days = data?.visitsByDay ?? [];
  const regions = data?.visitsByRegion ?? [];
  const maxRequests = Math.max(1, ...days.map((d) => d.requests));

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
        <h2 className="font-medium text-slate-900">Посещения по дням</h2>
        <p className="mt-1 text-sm text-slate-500">
          Сообщения в чате за 14 дней. В столбце — число сообщений, уникальные IP считаются отдельно.
        </p>
        <div className="mt-5 flex h-44 items-end gap-1.5 sm:gap-2">
          {days.map((day) => (
            <div key={day.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${day.label}: ${day.requests} сообщ., ${day.visitors} IP`}>
              <span className="mb-1 text-center text-[10px] text-slate-500">{day.requests || ""}</span>
              <div
                className="w-full rounded-t-md bg-violet-400"
                style={{ height: `${Math.max(day.requests ? 8 : 2, (day.requests / maxRequests) * 100)}%` }}
              />
              <span className="mt-1 truncate text-center text-[10px] text-slate-400">{day.label}</span>
            </div>
          ))}
          {!days.length && <p className="text-sm text-slate-500">Пока нет данных</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Посещения по регионам</h2>
        <p className="mt-1 text-sm text-slate-500">Страна и регион определяются по IP за те же 14 дней.</p>
        <div className="mt-4 divide-y divide-violet-50">
          {regions.map((region) => (
            <div key={region.label} className="flex items-center justify-between gap-3 py-2.5">
              <p className="min-w-0 truncate text-sm text-slate-800">{region.label}</p>
              <p className="shrink-0 text-sm text-slate-500">
                {region.requests} сообщ. · {region.visitors} IP
              </p>
            </div>
          ))}
          {!regions.length && <p className="text-sm text-slate-500">Пока нет данных</p>}
        </div>
      </section>
    </div>
  );
}
