"use client";

import { useEffect, useState } from "react";
import { ListBar, PagedRows } from "@/components/PagedRows";

type Row = { id: string; ip: string; message: string; createdAt: string };
type Block = { ip: string; reason: string; createdAt: string };

export function OrgRequests({ asPage = false }: { asPage?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState("");

  async function load(nextPage = page, nextQuery = query) {
    const params = new URLSearchParams({ page: String(nextPage), q: nextQuery });
    const res = await fetch(`/api/org/requests?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNote(data.error ?? "Не удалось загрузить запросы");
      return;
    }
    setRows(data.requests ?? []);
    setBlocks(data.blocks ?? []);
    setPage(data.page ?? nextPage);
    setPages(data.pages ?? 1);
    setTotal(data.total ?? 0);
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void load(1, query);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function block(ip: string) {
    setNote("");
    const res = await fetch("/api/org/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip }),
    });
    setNote(res.ok ? `IP ${ip} закрыт для этого агента` : "Не удалось закрыть IP");
    await load(page, query);
  }

  async function unblock(ip: string) {
    setNote("");
    const res = await fetch("/api/org/requests", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip }),
    });
    setNote(res.ok ? `Блок снят: ${ip}` : "Не удалось снять блок");
    await load(page, query);
  }

  const blocked = new Set(blocks.map((row) => row.ip));

  return (
    <section className={asPage ? "" : "mt-8"}>
      <h2 className={asPage ? "text-3xl font-semibold text-slate-900" : "text-lg font-semibold"}>Запросы</h2>
      <p className="mt-1 text-sm text-slate-500">
        Сообщения к вашему агенту. Закрытый IP больше не сможет писать этому агенту.
      </p>
      {note ? <p className="mt-3 text-sm text-violet-700">{note}</p> : null}
      {blocks.length ? (
      <div className="mt-4">
        <PagedRows items={blocks} text={(row) => `${row.ip} ${row.reason}`} placeholder="Поиск по закрытым IP">
          {(list) => (
            <div className="space-y-2">
              {list.map((row) => (
                <div
                  key={row.ip}
                  className="flex items-center justify-between gap-3 rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm"
                >
                  <span className="font-medium">{row.ip}</span>
                  <button type="button" className="text-violet-700" onClick={() => void unblock(row.ip)}>
                    Снять блок
                  </button>
                </div>
              ))}
            </div>
          )}
        </PagedRows>
      </div>
      ) : null}
      <div className="mt-4">
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
          placeholder="Поиск по словам или IP"
        />
        <div className="space-y-2">
          {rows.map((row) => (
            <article key={row.id} className="rounded-2xl border border-violet-100 bg-white p-3 text-sm shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{row.ip}</p>
                  <p className="text-xs text-slate-400">{new Date(row.createdAt).toLocaleString("ru-RU")}</p>
                </div>
                {blocked.has(row.ip) ? (
                  <button type="button" className="text-violet-700" onClick={() => void unblock(row.ip)}>
                    Снять блок
                  </button>
                ) : (
                  <button type="button" className="text-rose-600" onClick={() => void block(row.ip)}>
                    Заблокировать
                  </button>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-slate-700">{row.message}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
