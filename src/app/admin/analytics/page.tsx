"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatExact } from "@/lib/money";
import { PagedRows } from "@/components/PagedRows";
import { minskDayKey } from "@/lib/minskTime";

type Range = "today" | "month" | "all";
type Bucket = "day" | "week" | "month" | "quarter" | "year";

type Report = {
  totals: {
    allLabel: string;
    todayLabel: string;
    monthLabel: string;
    requests: number;
    todayRequests: number;
    monthRequests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    range: string;
    selectedDay?: string | null;
    selectedDayLabel?: string | null;
    selectedDayRequests?: number | null;
    selectedDayCostLabel?: string | null;
  };
  byModel: Array<{
    model: string;
    displayName: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    costLabel: string;
    inputUsdPerM: number | null;
    outputUsdPerM: number | null;
  }>;
  byAgent: Array<{
    agentId: string;
    name: string;
    currentModel: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costLabel: string;
  }>;
  byAgentModel: Array<{
    agentId: string;
    agentName: string;
    model: string;
    displayName: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costLabel: string;
  }>;
  bucket?: string;
  series: Array<{
    key: string;
    label: string;
    agentId: string;
    agentName: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costLabel: string;
  }>;
  daily: Array<{
    date: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costLabel: string;
  }>;
  recent: Array<{
    id: string;
    createdAt: string;
    agentId: string | null;
    agentName: string;
    model: string;
    displayName: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costLabel: string;
  }>;
};

const RANGES: Array<{ id: Range; label: string }> = [
  { id: "today", label: "Сегодня" },
  { id: "month", label: "Этот месяц" },
  { id: "all", label: "Всё время" },
];

const BUCKETS: Array<{ id: Bucket; label: string }> = [
  { id: "day", label: "Дни" },
  { id: "week", label: "Недели" },
  { id: "month", label: "Месяцы" },
  { id: "quarter", label: "Кварталы" },
  { id: "year", label: "Годы" },
];

function tokens(value: number) {
  return value.toLocaleString("ru-RU");
}

function when(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>("month");
  const [bucket, setBucket] = useState<Bucket>("day");
  const [agentId, setAgentId] = useState("");
  const [day, setDay] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ range, bucket });
    if (agentId) params.set("agentId", agentId);
    if (day) params.set("day", day);
    void fetch(`/api/llm/usage?${params}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Не удалось собрать отчёт");
        if (!cancelled) setReport(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось собрать отчёт");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, bucket, agentId, day]);

  const totals = report?.totals;
  const spent = day
    ? totals?.selectedDayCostLabel
    : range === "today"
      ? totals?.todayLabel
      : range === "month"
        ? totals?.monthLabel
        : totals?.allLabel;
  const requests = day
    ? totals?.selectedDayRequests
    : range === "today"
      ? totals?.todayRequests
      : range === "month"
        ? totals?.monthRequests
        : totals?.requests;
  const maxDay = Math.max(1, ...(report?.daily ?? []).map((day) => day.totalTokens));
  const tokenBase = totals?.totalTokens || 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Аналитика</h1>
          <p className="mt-1 max-w-2xl text-slate-500">
            Сколько токенов ушло на каждого агента и модель. Сумма — сохранённая стоимость каждого
            запроса, по минскому времени.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="text-sm text-slate-600">
            День
            <input
              type="date"
              value={day}
              max={minskDayKey(new Date())}
              onChange={(e) => setDay(e.target.value)}
              className="ml-2 rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-sm text-slate-700"
            />
          </label>
          <button
            type="button"
            className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-sm text-violet-700 hover:bg-violet-50"
            onClick={() => setDay(minskDayKey(new Date(Date.now() - 24 * 60 * 60 * 1000)))}
          >
            Вчера
          </button>
          <button
            type="button"
            className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-sm text-violet-700 hover:bg-violet-50"
            onClick={() => setDay(minskDayKey(new Date()))}
          >
            Сегодня
          </button>
          {day ? (
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
              onClick={() => setDay("")}
            >
              Сбросить день
            </button>
          ) : null}
        </div>
        <div className="flex rounded-xl border border-violet-200 bg-white p-1">
          {RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setDay("");
                setRange(item.id);
              }}
              className={
                !day && range === item.id
                  ? "rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-violet-50"
              }
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex rounded-xl border border-violet-200 bg-white p-1">
            {BUCKETS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setBucket(item.id)}
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
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="">Все агенты</option>
            {(report?.byAgent ?? []).map((agent) => (
              <option key={agent.agentId} value={agent.agentId}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
        </div>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Запросы", requests?.toLocaleString("ru-RU") ?? "—"],
          ["Входные токены", totals ? tokens(totals.inputTokens) : "—"],
          ["Выходные токены", totals ? tokens(totals.outputTokens) : "—"],
          ["Потрачено", spent ?? "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{loading && !report ? "…" : value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">По периодам и агентам</h2>
        <p className="mt-1 text-sm text-slate-500">
          Разбивка по минскому времени. Сумма — как записана в каждом запросе, без пересчёта.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">Период</th>
                <th className="py-2 pr-3">Агент</th>
                <th className="py-2 pr-3">Запросы</th>
                <th className="py-2 pr-3">Вход</th>
                <th className="py-2 pr-3">Выход</th>
                <th className="py-2">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {(report?.series ?? []).map((row) => (
                <tr key={`${row.key}-${row.agentId}`} className="border-t border-violet-50">
                  <td className="py-2 pr-3">{row.label}</td>
                  <td className="py-2 pr-3 font-medium text-slate-800">{row.agentName}</td>
                  <td className="py-2 pr-3">{row.requests}</td>
                  <td className="py-2 pr-3">{tokens(row.inputTokens)}</td>
                  <td className="py-2 pr-3">{tokens(row.outputTokens)}</td>
                  <td className="py-2 font-medium">{row.costLabel}</td>
                </tr>
              ))}
              {!report?.series?.length && (
                <tr>
                  <td colSpan={6} className="py-4 text-slate-500">
                    За выбранный период запросов не было.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Токены за 30 дней</h2>
        <p className="mt-1 text-sm text-slate-500">Каждый столбец — входные и выходные токены за день.</p>
        <div className="mt-4 flex h-36 items-end gap-1">
          {(report?.daily ?? []).map((day) => (
            <div key={day.date} className="group flex h-full min-w-0 flex-1 flex-col justify-end">
              <div
                className="rounded-t bg-violet-500/80"
                style={{ height: `${Math.max(2, (day.totalTokens / maxDay) * 100)}%` }}
                title={`${dayLabel(day.date)}: ${tokens(day.totalTokens)} токенов, ${day.costLabel}`}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-slate-400">
          <span>{report?.daily[0] ? dayLabel(report.daily[0].date) : ""}</span>
          <span>{report?.daily.at(-1) ? dayLabel(report.daily.at(-1)!.date) : ""}</span>
        </div>
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-medium text-slate-900">По агентам</h2>
        <p className="mb-4 text-sm text-slate-500">Кто сколько токенов потратил за выбранный период.</p>
        <PagedRows
          items={report?.byAgent ?? []}
          text={(row) => `${row.name} ${row.currentModel}`}
          placeholder="Поиск по агентам"
        >
          {(rows) => (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">Агент</th>
                <th className="py-2 pr-3">Модель сейчас</th>
                <th className="py-2 pr-3">Запросы</th>
                <th className="py-2 pr-3">Вход</th>
                <th className="py-2 pr-3">Выход</th>
                <th className="py-2 pr-3">Всего</th>
                <th className="py-2 pr-3">Доля</th>
                <th className="py-2">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.agentId} className="border-t border-violet-50">
                  <td className="py-2 pr-3 font-medium text-slate-800">
                    <Link href={`/admin/agents/${row.agentId}`} className="hover:text-violet-700">
                      {row.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-500">{row.currentModel || "—"}</td>
                  <td className="py-2 pr-3">{row.requests}</td>
                  <td className="py-2 pr-3">{tokens(row.inputTokens)}</td>
                  <td className="py-2 pr-3">{tokens(row.outputTokens)}</td>
                  <td className="py-2 pr-3 font-medium">{tokens(row.totalTokens)}</td>
                  <td className="py-2 pr-3 text-slate-500">
                    {row.totalTokens ? `${Math.round((row.totalTokens / tokenBase) * 100)}%` : "0%"}
                  </td>
                  <td className="py-2 font-medium">{row.costLabel}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={8} className="py-4 text-slate-500">
                    Агентов пока нет.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
          )}
        </PagedRows>
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-medium text-slate-900">Агент и модель</h2>
        <PagedRows
          items={report?.byAgentModel ?? []}
          text={(row) => `${row.agentName} ${row.displayName} ${row.model}`}
          placeholder="Поиск по агенту или модели"
        >
          {(rows) => (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">Агент</th>
                <th className="py-2 pr-3">Модель</th>
                <th className="py-2 pr-3">Запросы</th>
                <th className="py-2 pr-3">Вход</th>
                <th className="py-2 pr-3">Выход</th>
                <th className="py-2 pr-3">Всего</th>
                <th className="py-2">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.agentId}-${row.model}`} className="border-t border-violet-50">
                  <td className="py-2 pr-3">{row.agentName}</td>
                  <td className="py-2 pr-3">
                    <div>{row.displayName}</div>
                    <div className="font-mono text-xs text-slate-400">{row.model}</div>
                  </td>
                  <td className="py-2 pr-3">{row.requests}</td>
                  <td className="py-2 pr-3">{tokens(row.inputTokens)}</td>
                  <td className="py-2 pr-3">{tokens(row.outputTokens)}</td>
                  <td className="py-2 pr-3">{tokens(row.totalTokens)}</td>
                  <td className="py-2 font-medium">{row.costLabel}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="py-4 text-slate-500">
                    За выбранный период запросов не было.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
          )}
        </PagedRows>
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-medium text-slate-900">По моделям</h2>
        <PagedRows
          items={report?.byModel ?? []}
          text={(row) => `${row.displayName} ${row.model}`}
          placeholder="Поиск по модели"
        >
          {(rows) => (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">Модель</th>
                <th className="py-2 pr-3">Цена вход / выход</th>
                <th className="py-2 pr-3">Запросы</th>
                <th className="py-2 pr-3">Вход</th>
                <th className="py-2 pr-3">Выход</th>
                <th className="py-2">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.model} className="border-t border-violet-50">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{row.displayName}</div>
                    <div className="font-mono text-xs text-slate-400">{row.model}</div>
                  </td>
                  <td className="py-2 pr-3 text-slate-600">
                    {row.inputUsdPerM == null
                      ? "—"
                      : `$${formatExact(row.inputUsdPerM)} / $${formatExact(row.outputUsdPerM ?? 0)}`}
                  </td>
                  <td className="py-2 pr-3">{row.requests}</td>
                  <td className="py-2 pr-3">{tokens(row.inputTokens)}</td>
                  <td className="py-2 pr-3">{tokens(row.outputTokens)}</td>
                  <td className="py-2 font-medium">{row.costLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          )}
        </PagedRows>
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-medium text-slate-900">Последние запросы</h2>
        <PagedRows
          items={report?.recent ?? []}
          text={(row) => `${row.agentName} ${row.displayName} ${row.model}`}
          placeholder="Поиск по агенту или модели"
        >
          {(rows) => (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">Когда</th>
                <th className="py-2 pr-3">Агент</th>
                <th className="py-2 pr-3">Модель</th>
                <th className="py-2 pr-3">Вход</th>
                <th className="py-2 pr-3">Выход</th>
                <th className="py-2 pr-3">Всего</th>
                <th className="py-2">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-violet-50">
                  <td className="py-2 pr-3 text-slate-500">{when(row.createdAt)}</td>
                  <td className="py-2 pr-3">{row.agentName}</td>
                  <td className="py-2 pr-3">{row.displayName}</td>
                  <td className="py-2 pr-3">{tokens(row.inputTokens)}</td>
                  <td className="py-2 pr-3">{tokens(row.outputTokens)}</td>
                  <td className="py-2 pr-3">{tokens(row.totalTokens)}</td>
                  <td className="py-2">{row.costLabel}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="py-4 text-slate-500">
                    Запросов ещё не было.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
          )}
        </PagedRows>
      </section>
    </div>
  );
}
