"use client";

import { useEffect, useState } from "react";
import { ModelSelect } from "@/components/ModelSelect";

type Usage = {
  totals: {
    allLabel: string;
    todayLabel: string;
    monthLabel: string;
    requests: number;
    todayRequests: number;
    monthRequests: number;
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
    costLabel: string;
  }>;
  prices: Array<{
    id: string;
    displayName: string;
    inputUsdPerM: number;
    outputUsdPerM: number;
  }>;
};

export default function SettingsPage() {
  const [model, setModel] = useState("");
  const [saved, setSaved] = useState("");
  const [message, setMessage] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageError, setUsageError] = useState("");

  useEffect(() => {
    void fetch("/api/llm/default-model")
      .then((r) => r.json())
      .then((d) => {
        setModel(d.model ?? "");
        setSaved(d.model ?? "");
      });
    void fetch("/api/llm/usage")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Не удалось посчитать расходы");
        setUsage(data);
      })
      .catch((e: unknown) => {
        setUsageError(e instanceof Error ? e.message : "Не удалось посчитать расходы");
      });
  }, []);

  async function saveModel() {
    setMessage("");
    const res = await fetch("/api/llm/default-model", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error ?? "Не сохранилось");
      return;
    }
    setSaved(data.model);
    setMessage("Модель по умолчанию сохранена. У каждого агента своя модель в его карточке.");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">Настройки</h1>
        <p className="mt-1 text-slate-500">Модель по умолчанию и сколько уже потрачено на запросы</p>
      </div>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Какую модель использовать</h2>
        <p className="mt-1 text-sm text-slate-500">
          Это модель для новых агентов. Уже созданным агентам модель задаётся отдельно на странице агента.
          В списке цена: вход / выход за 1 млн токенов.
        </p>
        <div className="mt-3 max-w-xl">
          <ModelSelect value={model} onChange={setModel} />
        </div>
        <button
          type="button"
          onClick={() => void saveModel()}
          disabled={!model || model === saved}
          className="mt-3 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          Сохранить модель по умолчанию
        </button>
        {message && <p className="mt-2 text-sm text-slate-600">{message}</p>}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ["Сегодня", usage?.totals.todayLabel, usage?.totals.todayRequests],
          ["Этот месяц", usage?.totals.monthLabel, usage?.totals.monthRequests],
          ["Всего", usage?.totals.allLabel, usage?.totals.requests],
        ].map(([label, money, requests]) => (
          <div key={String(label)} className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{money ?? "—"}</p>
            <p className="mt-1 text-xs text-slate-500">{requests ?? "—"} запросов</p>
          </div>
        ))}
      </section>

      {usageError && <p className="text-sm text-rose-600">{usageError}</p>}

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-medium text-slate-900">Потрачено по моделям</h2>
        <p className="mb-4 text-sm text-slate-500">
          Сумма считается по ценам vibecode: входные и выходные токены каждого запроса.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">Модель</th>
                <th className="py-2 pr-3">Цена вход / выход</th>
                <th className="py-2 pr-3">Запросы</th>
                <th className="py-2 pr-3">Токены</th>
                <th className="py-2">Потрачено</th>
              </tr>
            </thead>
            <tbody>
              {(usage?.byModel ?? []).map((row) => (
                <tr key={row.model} className="border-t border-violet-50">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-slate-800">{row.displayName}</div>
                    <div className="font-mono text-xs text-slate-400">{row.model}</div>
                  </td>
                  <td className="py-2 pr-3 text-slate-600">
                    {row.inputUsdPerM == null
                      ? "—"
                      : `$${row.inputUsdPerM.toFixed(2)} / $${row.outputUsdPerM?.toFixed(2)} за 1 млн`}
                  </td>
                  <td className="py-2 pr-3">{row.requests}</td>
                  <td className="py-2 pr-3 text-slate-600">
                    {row.inputTokens.toLocaleString("ru-RU")} → {row.outputTokens.toLocaleString("ru-RU")}
                  </td>
                  <td className="py-2 font-medium">{row.costLabel}</td>
                </tr>
              ))}
              {!usage?.byModel.length && (
                <tr>
                  <td colSpan={5} className="py-4 text-slate-500">
                    Запросов ещё не было — сумма появится после первого ответа в чате.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-medium text-slate-900">Потрачено по агентам</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">Агент</th>
                <th className="py-2 pr-3">Сейчас модель</th>
                <th className="py-2 pr-3">Запросы</th>
                <th className="py-2">Потрачено</th>
              </tr>
            </thead>
            <tbody>
              {(usage?.byAgent ?? []).map((row) => (
                <tr key={row.agentId} className="border-t border-violet-50">
                  <td className="py-2 pr-3 font-medium text-slate-800">{row.name}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-500">{row.currentModel || "—"}</td>
                  <td className="py-2 pr-3">{row.requests}</td>
                  <td className="py-2 font-medium">{row.costLabel}</td>
                </tr>
              ))}
              {!usage?.byAgent.length && (
                <tr>
                  <td colSpan={4} className="py-4 text-slate-500">
                    Пока нет расходов по агентам.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
