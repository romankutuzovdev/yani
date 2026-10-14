"use client";

import { useState } from "react";
import { PAGE_SIZE, matchesWords, slicePage } from "@/lib/paging";

export function ListBar({
  query,
  onQuery,
  page,
  pages,
  total,
  onPage,
  placeholder,
}: {
  query: string;
  onQuery: (value: string) => void;
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
  placeholder: string;
}) {
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={placeholder}
        className="w-full min-w-[12rem] flex-1 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400"
      />
      <p className="text-sm text-slate-500">
        {total === 0 ? (query.trim() ? "Ничего не найдено" : "Пока пусто") : `${from}–${to} из ${total}`}
      </p>
      {pages > 1 ? (
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            className="rounded-lg px-2.5 py-1.5 text-sm text-slate-600 hover:bg-violet-50 disabled:opacity-40"
          >
            Назад
          </button>
          <span className="px-1 text-sm text-slate-500">
            {page} / {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
            className="rounded-lg px-2.5 py-1.5 text-sm text-slate-600 hover:bg-violet-50 disabled:opacity-40"
          >
            Дальше
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function PagedRows<T>({
  items,
  text,
  placeholder,
  children,
}: {
  items: T[];
  text: (item: T) => string;
  placeholder: string;
  children: (rows: T[]) => React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filtered = items.filter((item) => matchesWords(query, text(item)));
  const view = slicePage(filtered, page);

  return (
    <div>
      <ListBar
        query={query}
        onQuery={(value) => {
          setQuery(value);
          setPage(1);
        }}
        page={view.page}
        pages={view.pages}
        total={view.total}
        onPage={setPage}
        placeholder={placeholder}
      />
      {children(view.items)}
    </div>
  );
}
