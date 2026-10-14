"use client";

import { useEffect, useState } from "react";

type Overview = {
  name: string;
  orgName: string;
  orgUnp: string;
  planLine: string;
  monthlyRequestLimit: number;
  requestsToday: number;
  requestsMonth: number;
  skills: number;
};

export default function OrgOverviewPage() {
  const [agent, setAgent] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/org")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Кабинет недоступен");
        setAgent(data.agent);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Кабинет недоступен");
      });
  }, []);

  const limit =
    agent == null ? "—" : agent.monthlyRequestLimit > 0 ? String(agent.monthlyRequestLimit) : "без лимита";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Обзор</h1>
        <p className="mt-1 text-slate-500">{agent?.name ?? "Кабинет организации"}</p>
      </div>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ["Организация", agent?.orgName.trim() || "Название не указано"],
          ["УНП", agent?.orgUnp.trim() || "не указан"],
          ["Тариф", agent?.planLine || "Не указан"],
          ["Лимит запросов", limit],
          ["Запросов сегодня", agent ? String(agent.requestsToday) : "—"],
          ["Запросов за месяц", agent ? String(agent.requestsMonth) : "—"],
          ["Навыки", agent ? String(agent.skills) : "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
