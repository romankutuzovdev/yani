"use client";

import { useEffect, useState } from "react";

type DocRow = {
  id: string;
  title: string;
  fileName: string;
  url: string;
  openMode: "preview" | "direct";
};

export function AgentDocs({ agentId }: { agentId: string; slug?: string }) {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [openMode, setOpenMode] = useState<"preview" | "direct">("preview");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const res = await fetch(`/api/agents/${agentId}/docs`);
    const data = await res.json();
    if (res.ok) setDocs(data.docs ?? []);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function upload(file: File) {
    setBusy(true);
    setMessage("");
    const body = new FormData();
    body.set("file", file);
    body.set("openMode", openMode);
    const res = await fetch(`/api/agents/${agentId}/docs`, { method: "POST", body });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMessage(data.error ?? "Не удалось прикрепить файл");
      return;
    }
    setDocs((prev) => [...prev, data.doc]);
    setMessage("Файл прикреплён — он в меню чата «Документация»");
  }

  async function save(doc: DocRow, patch: Partial<Pick<DocRow, "title" | "openMode">>) {
    const res = await fetch(`/api/agents/${agentId}/docs/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error ?? "Не удалось сохранить");
      return;
    }
    setDocs((prev) => prev.map((row) => (row.id === doc.id ? { ...row, ...data.doc } : row)));
  }

  async function remove(doc: DocRow) {
    setBusy(true);
    const res = await fetch(`/api/agents/${agentId}/docs/${doc.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage(data.error ?? "Не удалось убрать файл");
      return;
    }
    setDocs((prev) => prev.filter((row) => row.id !== doc.id));
  }

  return (
    <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
      <h2 className="font-medium">Документация в чате</h2>
      <p className="mt-1 text-sm text-slate-500">
        Прикрепите файлы здесь — они появятся у посетителя в меню чата → Документация. TXT, MD, Word, PDF.
      </p>
      <div
        className={`mt-4 rounded-2xl border-2 border-dashed px-4 py-6 text-center ${
          dragging ? "border-violet-400 bg-violet-50" : "border-violet-200 bg-violet-50/40"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void upload(file);
        }}
      >
        <p className="text-sm text-slate-600">Перетащите файл сюда или прикрепите кнопкой</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <select
            value={openMode}
            onChange={(e) => setOpenMode(e.target.value === "direct" ? "direct" : "preview")}
            className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-sm"
          >
            <option value="preview">Предпросмотр</option>
            <option value="direct">Сразу</option>
          </select>
          <label className="cursor-pointer rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white">
            {busy ? "Загрузка…" : "Прикрепить файл"}
            <input
              type="file"
              accept=".txt,.md,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>
      {message ? <p className="mt-2 text-sm text-slate-600">{message}</p> : null}
      <ul className="mt-4 space-y-2">
        {docs.map((doc) => (
          <li key={doc.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-100 px-3 py-2">
            <input
              value={doc.title}
              onChange={(e) =>
                setDocs((prev) => prev.map((row) => (row.id === doc.id ? { ...row, title: e.target.value } : row)))
              }
              onBlur={() => {
                const title = doc.title.trim();
                if (title) void save(doc, { title });
              }}
              className="min-w-0 flex-1 rounded-lg border border-violet-100 px-2 py-1.5 text-sm outline-none focus:border-violet-300"
            />
            <select
              value={doc.openMode}
              onChange={(e) => {
                const next = e.target.value === "direct" ? "direct" : "preview";
                setDocs((prev) => prev.map((row) => (row.id === doc.id ? { ...row, openMode: next } : row)));
                void save(doc, { openMode: next });
              }}
              className="rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-sm"
            >
              <option value="preview">Предпросмотр</option>
              <option value="direct">Сразу</option>
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove(doc)}
              className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-600 disabled:opacity-60"
            >
              Убрать
            </button>
          </li>
        ))}
        {!docs.length ? <li className="text-sm text-slate-500">Пока ничего не прикреплено</li> : null}
      </ul>
    </section>
  );
}
