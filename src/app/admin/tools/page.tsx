"use client";

import { useEffect, useState } from "react";
import {
  Calculator,
  Clock,
  Globe,
  HardDrive,
  Network,
  Wrench,
} from "lucide-react";

type Tool = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  builtIn: boolean;
  inputSchema: unknown;
};

const ICONS: Record<string, typeof Wrench> = {
  web_search: Globe,
  http_request: Network,
  calculator: Calculator,
  datetime: Clock,
  memory_search: HardDrive,
};

const NAME_RU: Record<string, string> = {
  web_search: "Поиск в интернете",
  http_request: "HTTP-запрос",
  calculator: "Калькулятор",
  datetime: "Дата и время",
  memory_search: "Поиск по памяти",
};

export default function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetch("/api/tools")
      .then((r) => r.json())
      .then((d) => setTools(d.tools ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Инструменты</h1>
        <p className="mt-1 text-slate-500">
          Возможности, которые Agent Engine может вызывать во время задач
        </p>
      </div>

      {loading && <p className="text-sm text-slate-500">Загрузка…</p>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tools.map((tool) => {
          const Icon = ICONS[tool.name] ?? Wrench;
          const props =
            tool.inputSchema &&
            typeof tool.inputSchema === "object" &&
            "properties" in (tool.inputSchema as object)
              ? Object.keys(
                  ((tool.inputSchema as { properties?: Record<string, unknown> })
                    .properties ?? {}) as Record<string, unknown>,
                )
              : [];

          return (
            <div
              key={tool.id}
              className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm transition hover:border-violet-200"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                    <Icon size={18} />
                  </div>
                  <div>
                    <h3 className="font-medium text-slate-900">
                      {NAME_RU[tool.name] ?? tool.name}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {tool.builtIn ? "Встроенный" : "Кастомный"} · {tool.name}
                    </p>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wide ${
                    tool.enabled
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {tool.enabled ? "вкл" : "выкл"}
                </span>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-slate-600">{tool.description}</p>
              {props.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {props.map((p) => (
                    <span
                      key={p}
                      className="rounded-lg border border-violet-100 bg-violet-50 px-2 py-1 font-mono text-[11px] text-violet-700"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-violet-600 hover:text-violet-800">
                  Схема входа
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600">
                  {JSON.stringify(tool.inputSchema, null, 2)}
                </pre>
              </details>
            </div>
          );
        })}
      </div>

      {!loading && !tools.length && (
        <p className="text-sm text-slate-500">Инструменты ещё не зарегистрированы.</p>
      )}
    </div>
  );
}
