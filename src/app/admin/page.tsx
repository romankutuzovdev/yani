"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  SalesSupportDashboard,
  type DashboardBucket,
} from "@/components/SalesSupportDashboard";

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
  agents?: Array<{ id: string; name: string }>;
  sales?: {
    series: Array<{
      key: string;
      label: string;
      inbound: number;
      outbound: number;
      communicating: number;
      clients: number;
      messages: number;
      workMinutes: number;
    }>;
    totals: {
      inbound: number;
      outbound: number;
      communicating: number;
      communicatingLive?: number;
      clients: number;
      clientsLive?: number;
      messages: number;
      workMinutes: number;
    };
    agents: Array<{ id: string; name: string }>;
  };
  support?: {
    agents: Array<{
      agentId: string;
      name: string;
      totalInbound: number;
      points: Array<{ key: string; label: string; inbound: number }>;
    }>;
    totals: { inbound: number };
  };
};

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [agentId, setAgentId] = useState("");
  const [bucket, setBucket] = useState<DashboardBucket>("day");
  const [loading, setLoading] = useState(true);
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  const todayKey = useMemo(
    () =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Minsk",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ bucket });
    if (agentId) params.set("agentId", agentId);
    void fetch(`/api/dashboard?${params}`)
      .then((r) => r.json())
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, bucket]);

  const stats = data?.stats;
  const visitDays = data?.visitsByDay ?? [];
  const regions = data?.visitsByRegion ?? [];
  const maxVisitors = Math.max(1, ...visitDays.map((d) => d.visitors));
  const todayVisits = visitDays.find((d) => d.day === todayKey);
  const hoveredVisit = visitDays.find((d) => d.day === hoverDay) ?? null;
  const agentOptions = data?.sales?.agents ?? data?.agents ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Обзор</h1>
        <p className="mt-1 text-slate-500">
          Менеджер продаж, техподдержка Yani, контакты сайта и расходы LLM
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Агенты", stats?.agents, "/admin/agents"],
          ["Навыки", stats?.skills, "/admin/skills"],
          [
            "Контактов сегодня",
            todayVisits?.visitors ?? "—",
          ],
          ["Потрачено сегодня", stats?.todayCost, "/admin/settings"],
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

      <SalesSupportDashboard
        bucket={bucket}
        onBucketChange={setBucket}
        agentId={agentId}
        onAgentChange={setAgentId}
        agents={agentOptions}
        sales={data?.sales ?? null}
        support={data?.support ?? null}
        loading={loading}
      />

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Контакты по дням</h2>
        <p className="mt-1 text-sm text-slate-500">
          Высота столбца — число людей (уникальные IP), не сообщений. Наведите на день — увидите детали.
        </p>
        <div className="relative mt-5">
          {hoveredVisit && (
            <div className="pointer-events-none absolute left-1/2 top-0 z-10 w-max max-w-[92%] -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-3 py-2 text-center text-[11px] text-white shadow-lg">
              <p className="font-medium">
                {hoveredVisit.day === todayKey ? `Сегодня · ${hoveredVisit.label}` : hoveredVisit.label}
              </p>
              <p className="mt-0.5 text-slate-100">
                {hoveredVisit.visitors.toLocaleString("ru-RU")} контактов
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400">
                {hoveredVisit.requests.toLocaleString("ru-RU")} сообщений за день
              </p>
            </div>
          )}
          <div className="flex h-44 items-end gap-1.5 sm:gap-2">
            {visitDays.map((day) => (
              <div
                key={day.day}
                className="flex h-full min-w-0 flex-1 flex-col justify-end"
                onMouseEnter={() => setHoverDay(day.day)}
                onMouseLeave={() => setHoverDay(null)}
                onFocus={() => setHoverDay(day.day)}
                onBlur={() => setHoverDay(null)}
                tabIndex={0}
                aria-label={`${day.day === todayKey ? "Сегодня" : day.label}: ${day.visitors} контактов, ${day.requests} сообщений`}
              >
                <span className="mb-1 text-center text-[10px] font-medium text-slate-600">
                  {day.visitors || ""}
                </span>
                <div
                  className={`w-full rounded-t-md bg-violet-500 transition ${hoverDay === day.day ? "ring-2 ring-slate-900/15" : ""}`}
                  style={{
                    height: `${Math.max(day.visitors ? 8 : 2, (day.visitors / maxVisitors) * 100)}%`,
                    opacity: day.visitors ? 0.95 : 0.25,
                  }}
                />
                <span className="mt-1 truncate text-center text-[10px] text-slate-400">
                  {day.day === todayKey ? "сегодня" : day.label}
                </span>
              </div>
            ))}
            {!visitDays.length && <p className="text-sm text-slate-500">Пока нет данных</p>}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Контакты по регионам</h2>
        <p className="mt-1 text-sm text-slate-500">Страна и регион по IP за 14 дней. Считаем людей, не сообщения.</p>
        <div className="mt-4 divide-y divide-violet-50">
          {[...regions]
            .sort((a, b) => b.visitors - a.visitors || a.label.localeCompare(b.label, "ru"))
            .map((region) => (
            <div key={region.label} className="flex items-center justify-between gap-3 py-2.5">
              <p className="min-w-0 truncate text-sm text-slate-800">{region.label}</p>
              <p className="shrink-0 text-sm text-slate-500">
                {region.visitors} контактов
                <span className="text-slate-400"> · {region.requests} сообщ.</span>
              </p>
            </div>
          ))}
          {!regions.length && <p className="text-sm text-slate-500">Пока нет данных</p>}
        </div>
      </section>
    </div>
  );
}
