"use client";

import { useState } from "react";

type Day = {
  day: string;
  label: string;
  workMinutes: number;
  chats: number;
  messages: number;
  clients: number;
};

type Totals = {
  workMinutes: number;
  chats: number;
  messages: number;
  clients: number;
};

const SERIES: Array<{
  key: keyof Omit<Day, "day" | "label">;
  title: string;
  hint: string;
  unit: string;
  color: string;
  formatValue?: (n: number) => string;
  formatTotal?: (n: number) => string;
}> = [
  {
    key: "chats",
    title: "Контакты",
    hint: "Уникальные люди (диалоги) за день",
    unit: "контактов",
    color: "bg-sky-500",
  },
  {
    key: "clients",
    title: "Клиенты",
    hint: "Доведено до стадии «Клиент»",
    unit: "клиентов",
    color: "bg-emerald-500",
  },
  {
    key: "workMinutes",
    title: "Работа агента",
    hint: "Минуты с запросами к модели",
    unit: "мин",
    color: "bg-violet-500",
    formatValue: (n) => `${n.toLocaleString("ru-RU")} мин`,
    formatTotal: (n) => `${n.toLocaleString("ru-RU")} мин`,
  },
  {
    key: "messages",
    title: "Сообщения",
    hint: "Входящие тексты (для справки, не люди)",
    unit: "сообщ.",
    color: "bg-indigo-400",
  },
];

function formatDayTitle(day: Day) {
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Minsk",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (day.day === todayKey) return `Сегодня · ${day.label}`;
  return day.label;
}

function MiniBars({
  daily,
  metric,
  color,
  unit,
  formatValue,
}: {
  daily: Day[];
  metric: keyof Omit<Day, "day" | "label">;
  color: string;
  unit: string;
  formatValue?: (n: number) => string;
}) {
  const max = Math.max(1, ...daily.map((d) => d[metric]));
  const [hover, setHover] = useState<string | null>(null);
  const hovered = daily.find((d) => d.day === hover) ?? null;

  return (
    <div className="relative mt-4">
      {hovered && (
        <div className="pointer-events-none absolute -top-1 left-1/2 z-10 w-max max-w-[90%] -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-2.5 py-1.5 text-center text-[11px] text-white shadow-lg">
          <p className="font-medium">{formatDayTitle(hovered)}</p>
          <p className="mt-0.5 text-slate-200">
            {formatValue
              ? formatValue(hovered[metric])
              : `${hovered[metric].toLocaleString("ru-RU")} ${unit}`}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">
            {hovered.chats.toLocaleString("ru-RU")} контактов ·{" "}
            {hovered.messages.toLocaleString("ru-RU")} сообщ. ·{" "}
            {hovered.clients.toLocaleString("ru-RU")} клиентов
          </p>
        </div>
      )}
      <div className="flex h-28 items-end gap-0.5 sm:gap-1">
        {daily.map((day) => {
          const value = day[metric];
          const active = hover === day.day;
          return (
            <div
              key={day.day}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
              onMouseEnter={() => setHover(day.day)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(day.day)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${formatDayTitle(day)}: ${value} ${unit}`}
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
    </div>
  );
}

export function MiniActivityCharts({
  daily,
  totals,
  loading,
}: {
  daily: Day[];
  totals?: Totals | null;
  loading?: boolean;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-medium text-slate-900">Активность по дням</h2>
        <p className="mt-1 text-sm text-slate-500">
          Главное — число людей (контактов). Наведите на столбец дня, чтобы увидеть метрики.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {SERIES.map((series) => {
          const total = totals?.[series.key] ?? 0;
          const totalLabel = series.formatTotal
            ? series.formatTotal(total)
            : `${total.toLocaleString("ru-RU")} ${series.unit}`;
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
                  {loading && !daily.length ? "…" : totalLabel}
                </p>
              </div>
              {daily.length ? (
                <>
                  <MiniBars
                    daily={daily}
                    metric={series.key}
                    color={series.color}
                    unit={series.unit}
                    formatValue={series.formatValue}
                  />
                  <div className="mt-1.5 flex justify-between text-[10px] text-slate-400">
                    <span>{daily[0]?.label}</span>
                    <span>{daily.at(-1)?.label}</span>
                  </div>
                </>
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
  );
}
