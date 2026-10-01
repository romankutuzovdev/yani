"use client";

import { useEffect, useState } from "react";

type Log = {
  id: string;
  level: string;
  type: string;
  message: string;
  createdAt: string;
};

export default function LogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [level, setLevel] = useState("");
  const [type, setType] = useState("");

  async function load() {
    const qs = new URLSearchParams();
    if (level) qs.set("level", level);
    if (type) qs.set("type", type);
    const res = await fetch(`/api/logs?${qs}`);
    const data = await res.json();
    setLogs(data.logs ?? []);
  }

  useEffect(() => {
    void load();
  }, [level, type]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">Системные логи</h1>
        <p className="mt-1 text-slate-500">Фильтр по уровню и типу</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="rounded-xl border border-violet-200 bg-white px-3 py-2"
        >
          <option value="">Все уровни</option>
          <option value="DEBUG">DEBUG</option>
          <option value="INFO">INFO</option>
          <option value="WARN">WARN</option>
          <option value="ERROR">ERROR</option>
        </select>
        <input
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder="Фильтр типа"
          className="rounded-xl border border-violet-200 bg-white px-3 py-2"
        />
      </div>
      <div className="space-y-2">
        {logs.map((log) => (
          <div key={log.id} className="rounded-xl border border-violet-100 bg-white px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                {log.level} · {log.type}
              </span>
              <span>{new Date(log.createdAt).toLocaleString("ru-RU")}</span>
            </div>
            <p className="mt-1 text-sm text-slate-800">{log.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
