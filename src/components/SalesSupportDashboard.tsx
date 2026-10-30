"use client";

import { useState } from "react";

export type DashboardBucket = "day" | "week" | "month" | "year";

type SalesPoint = {
  key: string;
  label: string;
  inbound: number;
  outbound: number;
  communicating: number;
  clients: number;
  messages: number;
  workMinutes: number;
};

type SalesTotals = {
  inbound: number;
  outbound: number;
  communicating: number;
  communicatingLive?: number;
  clients: number;
  clientsLive?: number;
  messages: number;
  workMinutes: number;
};

type SupportAgent = {
  agentId: string;
  name: string;
  totalInbound: number;
  points: Array<{ key: string; label: string; inbound: number }>;
};

const BUCKETS: Array<{ id: DashboardBucket; label: string }> = [
  { id: "day", label: "Дни" },
  { id: "week", label: "Недели" },
  { id: "month", label: "Месяцы" },
  { id: "year", label: "Годы" },
];

const SALES_SERIES: Array<{
  key: keyof Omit<SalesPoint, "key" | "label">;
  title: string;
  hint: string;
  color: string;
  format?: (n: number) => string;
}> = [
  {
    key: "outbound",
    title: "Исходящие сообщения",
    hint: "Отправленные сообщения за период (без черновиков и email-зеркал)",
    color: "bg-sky-500",
  },
  {
    key: "inbound",
    title: "Входящие сообщения",
    hint: "Сообщения от лидов за период",
    color: "bg-indigo-500",
  },
  {
    key: "communicating",
    title: "Активные диалоги",
    hint: "Уникальные лиды с перепиской в каждом интервале",
    color: "bg-blue-500",
  },
  {
    key: "clients",
    title: "Новые клиенты",
    hint: "Уникальные переходы в стадию «Клиент»",
    color: "bg-emerald-500",
  },
  {
    key: "messages",
    title: "Всего сообщений",
    hint: "Входящие + исходящие за период",
    color: "bg-violet-500",
  },
  {
    key: "workMinutes",
    title: "Работа агента",
    hint: "Минуты с CRM-запросами к модели",
    color: "bg-amber-500",
    format: (n) => `${n.toLocaleString("ru-RU")} мин`,
  },
];

function MetricBars({
  points,
  metric,
  color,
  format,
}: {
  points: Array<{ key: string; label: string } & Record<string, number | string>>;
  metric: string;
  color: string;
  format?: (n: number) => string;
}) {
  const values = points.map((p) => Number(p[metric] ?? 0));
  const max = Math.max(1, ...values);
  const [hover, setHover] = useState<string | null>(null);
  const hovered = points.find((p) => p.key === hover) ?? null;
  const hoveredValue = hovered ? Number(hovered[metric] ?? 0) : 0;

  return (
    <div className="relative mt-4">
      {hovered && (
        <div className="pointer-events-none absolute -top-1 left-1/2 z-10 w-max max-w-[92%] -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-2.5 py-1.5 text-center text-[11px] text-white shadow-lg">
          <p className="font-medium">{hovered.label}</p>
          <p className="mt-0.5 text-slate-200">
            {format ? format(hoveredValue) : hoveredValue.toLocaleString("ru-RU")}
          </p>
        </div>
      )}
      <div className="flex h-28 items-end gap-0.5 sm:gap-1">
        {points.map((point) => {
          const value = Number(point[metric] ?? 0);
          const active = hover === point.key;
          return (
            <div
              key={point.key}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
              onMouseEnter={() => setHover(point.key)}
              onMouseLeave={() => setHover(null)}
              tabIndex={0}
              aria-label={`${point.label}: ${value}`}
            >
              <div
                className={`w-full rounded-t transition ${color} ${active ? "opacity-100 ring-2 ring-slate-900/20" : "opacity-90"}`}
                style={{
                  height: `${Math.max(value ? 8 : 2, (value / max) * 100)}%`,
                  opacity: value ? undefined : 0.25,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-slate-400">
        <span className="truncate">{points[0]?.label}</span>
        <span className="truncate">{points.at(-1)?.label}</span>
      </div>
    </div>
  );
}

export function SalesSupportDashboard({
  bucket,
  onBucketChange,
  agentId,
  onAgentChange,
  agents,
  sales,
  support,
  loading,
  showAgentFilter = true,
}: {
  bucket: DashboardBucket;
  onBucketChange: (bucket: DashboardBucket) => void;
  agentId: string;
  onAgentChange: (agentId: string) => void;
  agents: Array<{ id: string; name: string }>;
  sales: { series: SalesPoint[]; totals: SalesTotals } | null;
  support: { agents: SupportAgent[]; totals: { inbound: number } } | null;
  loading?: boolean;
  showAgentFilter?: boolean;
}) {
  const salesSeries = sales?.series ?? [];
  const salesTotals = sales?.totals;
  const supportAgents = support?.agents ?? [];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-violet-200 bg-white p-1">
          {BUCKETS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onBucketChange(item.id)}
              className={
                bucket === item.id
                  ? "rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-violet-50"
              }
            >
              {item.label}
            </button>
          ))}
        </div>
        {showAgentFilter ? (
          <select
            value={agentId}
            onChange={(e) => onAgentChange(e.target.value)}
            className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="">Все агенты</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Менеджер продаж</h2>
          <p className="mt-1 text-sm text-slate-500">
            CRM за выбранный период: сообщения, активные диалоги, клиенты и минуты работы.
            Карточки «общение» и «клиенты» — текущий снимок стадий.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[
            ["Исходящие сообщения", salesTotals?.outbound, "за период"],
            ["Входящие сообщения", salesTotals?.inbound, "за период"],
            [
              "Идёт общение",
              salesTotals?.communicatingLive ?? salesTotals?.communicating,
              "сейчас в стадии",
            ],
            [
              "Клиенты",
              salesTotals?.clientsLive ?? salesTotals?.clients,
              salesTotals?.clientsLive != null ? "сейчас в стадии" : "уникальные за период",
            ],
            ["Всего сообщений", salesTotals?.messages, "за период"],
            [
              "Работа агента",
              salesTotals?.workMinutes != null
                ? `${salesTotals.workMinutes.toLocaleString("ru-RU")} мин`
                : null,
              "за период",
            ],
          ].map(([label, value, note]) => (
            <div
              key={String(label)}
              className="rounded-2xl border border-sky-100 bg-sky-50/40 p-4 shadow-sm"
            >
              <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">
                {loading && value == null
                  ? "…"
                  : value == null
                    ? "—"
                    : typeof value === "number"
                      ? value.toLocaleString("ru-RU")
                      : value}
              </p>
              {note ? <p className="mt-1 text-[11px] text-slate-500">{note}</p> : null}
            </div>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {SALES_SERIES.map((series) => {
            const total = salesTotals?.[series.key] ?? 0;
            return (
              <div
                key={series.key}
                className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{series.title}</p>
                    <p className="text-xs text-slate-500">{series.hint}</p>
                  </div>
                  <p className="text-right text-lg font-semibold text-slate-900">
                    {loading && !salesSeries.length
                      ? "…"
                      : series.format
                        ? series.format(total)
                        : total.toLocaleString("ru-RU")}
                  </p>
                </div>
                {salesSeries.length ? (
                  <MetricBars
                    points={salesSeries}
                    metric={series.key}
                    color={series.color}
                    format={series.format}
                  />
                ) : (
                  <p className="mt-6 text-sm text-slate-500">
                    {loading ? "Загрузка…" : "Пока нет данных"}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Техподдержка Yani</h2>
          <p className="mt-1 text-sm text-slate-500">
            Уникальные сессии чата (контакты), не каждое сообщение.
          </p>
        </div>

        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wider text-slate-500">Контактов всего</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {loading && support?.totals.inbound == null
              ? "…"
              : (support?.totals.inbound ?? 0).toLocaleString("ru-RU")}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {supportAgents.map((agent) => (
            <div
              key={agent.agentId}
              className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">{agent.name}</p>
                  <p className="text-xs text-slate-500">Уникальные контакты (сессии)</p>
                </div>
                <p className="text-lg font-semibold text-slate-900">
                  {agent.totalInbound.toLocaleString("ru-RU")}
                </p>
              </div>
              {agent.points.length ? (
                <MetricBars points={agent.points} metric="inbound" color="bg-emerald-500" />
              ) : (
                <p className="mt-6 text-sm text-slate-500">Нет входящих</p>
              )}
            </div>
          ))}
          {!supportAgents.length && (
            <p className="text-sm text-slate-500">{loading ? "Загрузка…" : "Агентов пока нет"}</p>
          )}
        </div>
      </section>
    </div>
  );
}
