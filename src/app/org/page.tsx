"use client";

import { useEffect, useState } from "react";
import {
  SalesSupportDashboard,
  type DashboardBucket,
} from "@/components/SalesSupportDashboard";

type Overview = {
  name: string;
  orgName: string;
  orgUnp: string;
  planLine: string;
  salesPlanLine?: string;
  salesEnabled?: boolean;
  salesPlaybookLimit?: number;
  salesPlaybookUsed?: number;
  monthlyRequestLimit: number;
  requestsToday: number;
  requestsMonth: number;
  skills: number;
};

type SalesPayload = {
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
};

type SupportPayload = {
  agents: Array<{
    agentId: string;
    name: string;
    totalInbound: number;
    points: Array<{ key: string; label: string; inbound: number }>;
  }>;
  totals: { inbound: number };
};

export default function OrgOverviewPage() {
  const [agent, setAgent] = useState<Overview | null>(null);
  const [sales, setSales] = useState<SalesPayload | null>(null);
  const [support, setSupport] = useState<SupportPayload | null>(null);
  const [error, setError] = useState("");
  const [bucket, setBucket] = useState<DashboardBucket>("day");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetch(`/api/org?bucket=${bucket}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Кабинет недоступен");
        if (cancelled) return;
        setAgent(data.agent);
        setSales(data.sales ?? null);
        setSupport(data.support ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Кабинет недоступен");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bucket]);

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
          ["Тариф чата", agent?.planLine || "Не указан"],
          ["Тариф продаж", agent?.salesEnabled ? agent.salesPlanLine || "Подключён" : "Не подключён"],
          [
            "Навыки продаж",
            agent?.salesEnabled
              ? agent.salesPlaybookLimit
                ? `${agent.salesPlaybookUsed ?? 0} / ${agent.salesPlaybookLimit}`
                : `${agent.salesPlaybookUsed ?? 0} (без лимита)`
              : "—",
          ],
          ["Лимит запросов", limit],
          ["Навыки чата", agent ? String(agent.skills) : "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      <SalesSupportDashboard
        bucket={bucket}
        onBucketChange={setBucket}
        agentId=""
        onAgentChange={() => undefined}
        agents={[]}
        sales={sales}
        support={support}
        loading={loading}
        showAgentFilter={false}
      />
    </div>
  );
}
