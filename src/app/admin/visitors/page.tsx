"use client";

import { useEffect, useState } from "react";
import { ListBar, PagedRows } from "@/components/PagedRows";

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
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState("");

  async function load(nextPage = page, nextQuery = query) {
    const params = new URLSearchParams({ page: String(nextPage), q: nextQuery });
    const res = await fetch(`/api/visitors?${params}`);
    const data = await res.json();
    setRequests(data.requests ?? []);
    setBlocks(data.blocks ?? []);
    setIps(data.ips ?? []);
    setPage(data.page ?? nextPage);
    setPages(data.pages ?? 1);
    setTotal(data.total ?? 0);
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void load(1, query);
    }, 250);
    return () => clearTimeout(timer);
    // reload when the search text changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function block(ip: string) {
    setMessage("");
    const res = await fetch("/api/visitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip }),
    });
    setMessage(res.ok ? `IP ${ip} заблокирован` : "Не удалось заблокировать");
    await load(page, query);
  }

  async function unblock(ip: string) {
    setMessage("");
    const res = await fetch("/api/visitors", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip }),
    });
    setMessage(res.ok ? `Блок снят: ${ip}` : "Не удалось снять блок");
    await load(page, query);
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

      <ListBar
        query={query}
        onQuery={setQuery}
        page={page}
        pages={pages}
        total={total}
        onPage={(next) => {
          setPage(next);
          void load(next, query);
        }}
        placeholder="Поиск по словам, IP или агенту"
      />

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Закрытые IP</h2>
        <div className="mt-3">
          <PagedRows items={blocks} text={(block) => `${block.ip} ${block.reason}`} placeholder="Поиск по закрытым IP">
            {(rows) => (
              <div className="space-y-2">
                {!rows.length && <p className="text-sm text-slate-400">Сейчас никого нет</p>}
                {rows.map((block) => (
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
            )}
          </PagedRows>
        </div>
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">За сутки</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {ips.map((row) => (
            <button
              key={row.ip}
              type="button"
              onClick={() => setQuery(row.ip)}
              className="rounded-full bg-violet-50 px-3 py-1.5 text-sm text-violet-800 hover:bg-violet-100"
            >
              {row.ip} · {row.count}
            </button>
          ))}
          {!ips.length && <p className="text-sm text-slate-400">Запросов за сутки нет</p>}
        </div>
      </section>

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
