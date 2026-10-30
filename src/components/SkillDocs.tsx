"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { fileDownloadUrl } from "@/lib/downloadUrl";

/** Same limit as server MAX_SKILL_DOCS. */
const DEFAULT_MAX = 15;

type DocRow = {
  id: string;
  fileName: string;
  url: string;
};

function postFile(
  url: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable || !onProgress) return;
      onProgress(Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
    };
    xhr.onload = () => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
      onProgress?.(100);
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, data });
    };
    xhr.onerror = () => resolve({ ok: false, data: { error: "Сеть недоступна" } });
    const body = new FormData();
    body.set("file", file);
    xhr.send(body);
  });
}

export function SkillDocs({
  skillId,
  apiBase,
  onChanged,
}: {
  skillId: string;
  apiBase: string;
  onChanged?: () => void;
}) {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [max, setMax] = useState(DEFAULT_MAX);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [progressLabel, setProgressLabel] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const res = await fetch(`${apiBase}/${skillId}/docs`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(typeof data.error === "string" ? data.error : "Не удалось загрузить список файлов");
      return;
    }
    setDocs(data.docs ?? []);
    if (typeof data.max === "number") setMax(data.max);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillId, apiBase]);

  async function uploadMany(files: File[]) {
    const queue = files.filter(Boolean);
    if (!queue.length) return;
    const room = max - docs.length;
    if (room <= 0) {
      setMessage(`Уже ${max} файлов — больше нельзя`);
      return;
    }
    const batch = queue.slice(0, room);
    const skipped = queue.length - batch.length;
    setBusy(true);
    setMessage("");
    const added: DocRow[] = [];
    let failed = "";
    for (let i = 0; i < batch.length; i += 1) {
      const file = batch[i]!;
      setProgressLabel(batch.length > 1 ? `${i + 1} из ${batch.length}: ${file.name}` : file.name);
      setPercent(0);
      const res = await postFile(`${apiBase}/${skillId}/docs`, file, setPercent);
      if (!res.ok) {
        failed = typeof res.data.error === "string" ? res.data.error : `Не удалось прикрепить ${file.name}`;
        break;
      }
      const doc = res.data.doc as DocRow | undefined;
      if (doc) added.push(doc);
    }
    if (added.length) setDocs((prev) => [...prev, ...added]);
    else await load();
    setBusy(false);
    setPercent(null);
    setProgressLabel("");
    if (failed) {
      setMessage(added.length ? `Часть файлов не загрузилась: ${failed}` : failed);
    } else if (skipped > 0) {
      setMessage(`Прикреплено ${added.length}. Ещё ${skipped} не влезли в лимит ${max}.`);
    } else {
      setMessage(added.length > 1 ? `Прикреплено файлов: ${added.length}` : "Документ прикреплён");
    }
    if (added.length) onChanged?.();
  }

  async function remove(doc: DocRow) {
    setBusy(true);
    setMessage("");
    const res = await fetch(`${apiBase}/${skillId}/docs/${doc.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage(data.error ?? "Не удалось убрать");
      return;
    }
    setDocs((prev) => prev.filter((row) => row.id !== doc.id));
    onChanged?.();
  }

  const full = docs.length >= max;

  return (
    <section className="rounded-2xl border-2 border-violet-300 bg-violet-50/60 p-5 shadow-sm ring-1 ring-violet-200">
      <h2 className="font-medium text-violet-950">Документ навыка</h2>
      <p className="mt-1 text-sm text-violet-900/70">
        Прикрепите файлы сюда — текст попадёт в ответы навыка. Word (.docx), txt и md. До {max}{" "}
        файлов, каждый до 15 МБ.
      </p>
      <div
        className={`mt-4 rounded-2xl border-2 border-dashed px-4 py-6 text-center ${
          dragging ? "border-violet-500 bg-violet-100" : "border-violet-300 bg-white/70"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length && !full) void uploadMany(files);
        }}
      >
        <p className="text-sm text-slate-600">Перетащите один или несколько файлов, либо прикрепите кнопкой</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <label
            className={`cursor-pointer rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white ${
              busy || full ? "pointer-events-none opacity-60" : ""
            }`}
          >
            {percent != null
              ? `Загрузка ${percent}%${progressLabel ? ` · ${progressLabel}` : ""}`
              : full
                ? `Лимит ${max}`
                : "Прикрепить файлы"}
            <input
              type="file"
              multiple
              accept=".docx,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              className="hidden"
              disabled={busy || full}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) void uploadMany(files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {percent != null ? (
          <div className="mx-auto mt-3 h-2 max-w-xs overflow-hidden rounded-full bg-violet-100">
            <div
              className="h-full rounded-full bg-violet-600 transition-[width] duration-150"
              style={{ width: `${percent}%` }}
            />
          </div>
        ) : null}
      </div>

      <div className="mt-4 space-y-2">
        {!docs.length && <p className="text-sm text-slate-400">Пока ничего не прикреплено</p>}
        {docs.map((doc) => (
          <div
            key={doc.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm"
          >
            <p className="min-w-0 truncate font-medium text-slate-800">{doc.fileName}</p>
            <div className="flex shrink-0 items-center gap-2">
              <a
                href={fileDownloadUrl(doc.url, doc.fileName)}
                download={doc.fileName}
                className="inline-flex items-center gap-1 rounded-lg border border-violet-200 px-2.5 py-1 text-violet-700 hover:bg-violet-50"
              >
                <Download size={14} />
                Скачать
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(doc)}
                className="rounded-lg border border-rose-200 px-2.5 py-1 text-rose-600 disabled:opacity-60"
              >
                Убрать
              </button>
            </div>
          </div>
        ))}
      </div>
      {message ? <p className="mt-3 text-sm text-violet-800">{message}</p> : null}
    </section>
  );
}
