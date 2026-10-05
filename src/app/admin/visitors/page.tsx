"use client";

import { FormEvent, useEffect, useState } from "react";

type RequestRow = {
  id: string;
  ip: string;
  agentName: string;
  message: string;
  createdAt: string;
};

type BlockRow = {
  ip: string;
  reason: string;
  source: string;
  blockedUntil: string | null;
  createdAt: string;
};

type IpCount = { ip: string; count: number };

export default function VisitorsPage() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [ips, setIps] = useState<IpCount[]>([]);
  const [filter, setFilter] = useState("");
  const [applied, setApplied] = useState("");
  const [message, setMessage] = useState("");

  async function load(ip = applied) {
    const query = ip ? `?ip=${encodeURIComponent(ip)}` : "";
    const res = await fetch(`/api/visitors${query}`);
    const data = await res.json();
    setRequests(data.requests ?? []);
    setBlocks(data.blocks ?? []);
    setIps(data.ips ?? []);
  }

  useEffect(() => {
    void load("");
    // first paint only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function search(e: FormEvent) {
    e.preventDefault();
    const next = filter.trim();
    setApplied(next);
    void load(next);
  }

  async function block(ip: string) {
    setMessage("");
    const res = await fetch("/api/visitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip }),
    });
    setMessage(res.ok ? `IP ${ip} заблокирован` : "Не удалось заблокировать");
    await load();
  }

  async function unblock(ip: string) {
    setMessage("");
    const res = await fetch("/api/visitors", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip }),
    });
    setMessage(res.ok ? `Блок снят: ${ip}` : "Не удалось снять блок");
    await load();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">Запросы</h1>
        <p className="mt-1 max-w-3xl text-slate-500">
          IP и текст сообщений в чат. История хранится 90 дней. Если с одного IP запросы идут каждую
          секунду, адрес закрывается на 30 минут. Подозрительный IP можно закрыть вручную.
        </p>
      </div>

      {message && <p className="text-sm text-violet-700">{message}</p>}

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Закрытые IP</h2>
        {!blocks.length && <p className="mt-3 text-sm text-slate-400">Сейчас никого нет</p>}
        <div className="mt-3 space-y-2">
          {blocks.map((block) => (
            <div
              key={block.ip}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3 text-sm"
            >
              <div>
                <p className="font-medium text-slate-900">{block.ip}</p>
                <p className="text-slate-500">
                  {block.source === "bot" ? "Автоблок" : "Вручную"}
                  {block.reason ? ` · ${block.reason}` : ""}
                  {block.blockedUntil
                    ? ` · до ${new Date(block.blockedUntil).toLocaleString("ru-RU")}`
                    : " · пока не снимете"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void unblock(block.ip)}
                className="rounded-lg px-3 py-1.5 text-violet-700 hover:bg-violet-50"
              >
                Снять блок
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">За сутки</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {ips.map((row) => (
            <button
              key={row.ip}
              type="button"
              onClick={() => {
                setFilter(row.ip);
                setApplied(row.ip);
                void load(row.ip);
              }}
              className="rounded-full bg-violet-50 px-3 py-1.5 text-sm text-violet-800 hover:bg-violet-100"
            >
              {row.ip} · {row.count}
            </button>
          ))}
          {!ips.length && <p className="text-sm text-slate-400">Запросов за сутки нет</p>}
        </div>
      </section>

      <form onSubmit={search} className="flex gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Фильтр по IP"
          className="w-full max-w-sm rounded-xl border border-violet-200 bg-white px-4 py-2.5"
        />
        <button className="rounded-xl bg-violet-600 px-4 py-2.5 font-medium text-white hover:bg-violet-500">
          Показать
        </button>
        {applied && (
          <button
            type="button"
            onClick={() => {
              setFilter("");
              setApplied("");
              void load("");
            }}
            className="rounded-xl px-3 py-2.5 text-sm text-slate-500 hover:bg-violet-50"
          >
            Сбросить
          </button>
        )}
      </form>

      <div className="overflow-x-auto rounded-2xl border border-violet-100 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-violet-100 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Время</th>
              <th className="px-4 py-3 font-medium">IP</th>
              <th className="px-4 py-3 font-medium">Агент</th>
              <th className="px-4 py-3 font-medium">Запрос</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {requests.map((row) => (
              <tr key={row.id} className="border-b border-violet-50 align-top">
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                  {new Date(row.createdAt).toLocaleString("ru-RU")}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{row.ip}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{row.agentName || "—"}</td>
                <td className="max-w-xl px-4 py-3 text-slate-700">{row.message}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => void block(row.ip)}
                    className="whitespace-nowrap text-red-600 hover:underline"
                  >
                    Заблокировать
                  </button>
                </td>
              </tr>
            ))}
            {!requests.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Пока пусто
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
