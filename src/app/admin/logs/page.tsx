"use client";

import { useEffect, useState } from "react";

type LogRow = {
  id: string;
  level: string;
  type: string;
  message: string;
  agentId: string | null;
  createdAt: string;
  meta: string;
};

function when(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ru-RU", { timeZone: "Europe/Minsk" });
}

function preview(meta: string) {
  try {
    const parsed = JSON.parse(meta) as { message?: string };
    return typeof parsed.message === "string" ? parsed.message : "";
  } catch {
    return "";
  }
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [onlyErrors, setOnlyErrors] = useState(true);
  const [note, setNote] = useState("");

  async function load(errorsOnly: boolean) {
    setNote("");
    const params = errorsOnly ? "?level=ERROR" : "";
    const res = await fetch(`/api/logs${params}`);
    if (!res.ok) {
      setNote("Не удалось загрузить журнал");
      return;
    }
    const data = await res.json();
    setLogs(data.logs ?? []);
  }

  useEffect(() => {
    void load(onlyErrors);
  }, [onlyErrors]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Журнал</h1>
          <p className="mt-1 max-w-3xl text-slate-500">
            Сырой текст ошибки чата. Посетителю по-прежнему показывается короткая фраза.
          </p>
        </div>
        <button
          type="button"
          className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-slate-700"
          onClick={() => setOnlyErrors((value) => !value)}
        >
          {onlyErrors ? "Только ошибки" : "Все записи"}
        </button>
      </div>

      {note && <p className="text-sm text-rose-600">{note}</p>}

      <div className="space-y-2">
        {!logs.length && <p className="text-sm text-slate-400">Записей пока нет</p>}
        {logs.map((row) => {
          const asked = preview(row.meta);
          return (
            <article key={row.id} className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-400">
                {when(row.createdAt)} · {row.level} · {row.type}
              </p>
              {asked && <p className="mt-2 text-sm text-slate-500">Запрос: {asked}</p>}
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900">{row.message}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
