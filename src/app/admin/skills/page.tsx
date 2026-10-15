"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, Trash2 } from "lucide-react";
import { ModelSelect } from "@/components/ModelSelect";
import { ListBar } from "@/components/PagedRows";
import { SkillDocs } from "@/components/SkillDocs";

type Skill = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  documentName: string;
  iconUrl: string;
  enabled: boolean;
};

const emptyForm = { name: "", description: "", systemPrompt: "", model: "" };

const fieldClass = "mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 text-sm";

function postFile(
  url: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
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
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, data: { error: "Сеть недоступна" } });
    const body = new FormData();
    body.set("file", file);
    xhr.send(body);
  });
}

export default function SkillsPage() {
  const orgMode = usePathname().startsWith("/org");
  const apiBase = orgMode ? "/api/org/skills" : "/api/skills";
  const [skills, setSkills] = useState<Skill[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [uploadingSkillId, setUploadingSkillId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  async function load(nextPage = page, nextQuery = query) {
    const params = new URLSearchParams({ page: String(nextPage), q: nextQuery });
    const res = await fetch(`${apiBase}?${params}`);
    const data = await res.json();
    setSkills(data.skills ?? []);
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

  async function create() {
    if (!form.name.trim()) {
      setMessage("Укажите название навыка");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim(),
          systemPrompt: form.systemPrompt,
          ...(orgMode ? {} : { model: form.model.trim() }),
          tools: [],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Не удалось создать");
        return;
      }
      const skillId = typeof data.skill?.id === "string" ? data.skill.id : "";
      const files = createFiles.slice(0, 15);
      setForm(emptyForm);
      setCreateFiles([]);
      setFileInputKey((key) => key + 1);
      if (files.length && skillId) {
        setUploadingSkillId(skillId);
        let attached = 0;
        let failed = "";
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i]!;
          setUploadPercent(0);
          setMessage(`Загрузка ${i + 1} из ${files.length}: ${file.name}`);
          const docRes = await postFile(`${apiBase}/${skillId}/docs`, file, setUploadPercent);
          if (!docRes.ok) {
            failed =
              typeof docRes.data.error === "string"
                ? docRes.data.error
                : `не загрузился ${file.name}`;
            break;
          }
          attached += 1;
        }
        if (failed) {
          setMessage(
            attached
              ? `Навык создан, прикреплено ${attached} из ${files.length}. ${failed}`
              : `Навык создан, но документ не загрузился: ${failed}`,
          );
          await load();
          return;
        }
        setMessage(
          attached > 1 ? `Навык создан, прикреплено файлов: ${attached}` : "Навык создан, документ прикреплён",
        );
      } else {
        setMessage("Навык создан");
      }
      await load();
    } finally {
      setBusy(false);
      setUploadPercent(null);
      setUploadingSkillId(null);
    }
  }

  async function saveEdit(id: string) {
    if (!edit.name.trim()) {
      setMessage("Укажите название навыка");
      return;
    }
    setBusy(true);
    setMessage("");
    const res = await fetch(`${apiBase}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: edit.name.trim(),
        description: edit.description.trim(),
        systemPrompt: edit.systemPrompt,
        ...(orgMode ? {} : { model: edit.model.trim() }),
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMessage(data.error ?? "Не удалось сохранить");
      return;
    }
    setEditingId(null);
    setMessage("Сохранено");
    await load();
  }

  async function remove(id: string) {
    await fetch(`${apiBase}/${id}`, { method: "DELETE" });
    await load();
  }

  async function uploadIcon(id: string, file: File) {
    setBusy(true);
    setMessage("");
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch(`${apiBase}/${id}/icon`, { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Не удалось загрузить иконку");
        return;
      }
      setMessage("Иконка загружена");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function removeIcon(id: string) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`${apiBase}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iconUrl: "" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Не удалось убрать иконку");
        return;
      }
      setMessage("Иконка убрана");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">Навыки</h1>
        <p className="mt-1 text-slate-500">
          {orgMode
            ? "Название, описание, промпт, иконка и документ навыка."
            : "Название, описание, промпт, модель, иконка и документ навыка."}
        </p>
      </div>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-medium text-slate-900">Новый навык</h2>
        <label className="block text-sm text-slate-700">
          Название навыка
          <input
            className={fieldClass}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="mt-3 block text-sm text-slate-700">
          Описание
          <textarea
            className={fieldClass}
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label className="mt-3 block text-sm text-slate-700">
          Промпт навыка
          <textarea
            className={fieldClass}
            rows={6}
            placeholder="Например: если пользователь хочет оставить заявку, предложи [[кнопка:Заявка|https://yani.by/f/zayavka|попап]]"
            value={form.systemPrompt}
            onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
          />
          <span className="mt-1 block text-xs leading-relaxed text-slate-500">
            Кнопка: [[кнопка:Подпись|https://ссылка]] — новая вкладка. Добавьте |попап, чтобы открыть в окне:
            [[кнопка:Подпись|https://ссылка|попап]]. Для другого вопроса — отдельная строка.
          </span>
        </label>
        {!orgMode && (
        <label className="mt-3 block text-sm text-slate-700">
          Модель навыка
          <ModelSelect
            value={form.model}
            allowEmpty
            emptyLabel="Как у агента"
            onChange={(model) => setForm({ ...form, model })}
          />
        </label>
        )}
        <div className="mt-3 rounded-2xl border-2 border-violet-300 bg-violet-50/60 p-4 ring-1 ring-violet-200">
          <p className="text-sm font-medium text-violet-950">Документ навыка</p>
          <p className="mt-1 text-xs leading-relaxed text-violet-900/70">
            Можно сразу несколько файлов, до 15 штук по 15 МБ (Word, txt, md). Тот же блок есть в
            «Изменить» у уже созданного навыка.
          </p>
          <input
            key={fileInputKey}
            type="file"
            multiple
            accept=".docx,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            className={`${fieldClass} file:mr-3 file:rounded-lg file:border-0 file:bg-violet-100 file:px-3 file:py-1 file:text-sm file:text-violet-800`}
            disabled={busy}
            onChange={(e) => setCreateFiles(Array.from(e.target.files ?? []).slice(0, 15))}
          />
          {createFiles.length ? (
            <ul className="mt-2 space-y-1 text-xs text-violet-800">
              {createFiles.map((file) => (
                <li key={`${file.name}-${file.size}`}>{file.name}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <button
          onClick={create}
          disabled={busy}
          className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 font-medium text-white hover:bg-violet-500 disabled:opacity-60"
        >
          {busy
            ? uploadPercent != null
              ? `Загрузка документа ${uploadPercent}%`
              : "Создание…"
            : "Создать навык"}
        </button>
        {uploadPercent != null && !editingId ? (
          <div className="mt-2">
            <p className="text-sm text-violet-700">Загрузка документа: {uploadPercent}%</p>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-violet-100">
              <div
                className="h-full rounded-full bg-violet-600 transition-[width] duration-150"
                style={{ width: `${uploadPercent}%` }}
              />
            </div>
          </div>
        ) : null}
        {message && <p className="mt-2 text-sm text-slate-600">{message}</p>}
      </section>

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
        placeholder="Поиск по названию или описанию навыка"
      />

      <div className="space-y-3">
        {skills.map((skill) => (
          <div key={skill.id} className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-violet-50">
                  {skill.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={skill.iconUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Sparkles size={18} className="text-violet-400" />
                  )}
                </div>
                <div className="min-w-0">
                <h3 className="text-lg font-medium text-slate-900">{skill.name}</h3>
                <p className="mt-1 text-sm text-slate-600">{skill.description || "Без описания"}</p>
                <p className="mt-2 line-clamp-3 text-sm text-slate-500">
                  {skill.systemPrompt?.trim() || "Промпт не задан"}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  {!orgMode && <>Модель: {skill.model?.trim() || "как у агента"}</>}
                  {!orgMode && skill.documentName?.trim() ? " · " : ""}
                  {skill.documentName?.trim() ? `Документ: ${skill.documentName}` : ""}
                </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (editingId === skill.id) {
                      setEditingId(null);
                      return;
                    }
                    setEditingId(skill.id);
                    setEdit({
                      name: skill.name,
                      description: skill.description || "",
                      systemPrompt: skill.systemPrompt || "",
                      model: skill.model || "",
                    });
                  }}
                  className="rounded-lg border border-violet-200 px-3 py-1.5 text-sm text-slate-700"
                >
                  {editingId === skill.id ? "Закрыть" : "Изменить"}
                </button>
                <button
                  type="button"
                  onClick={() => remove(skill.id)}
                  className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-600"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {editingId === skill.id && (
              <div className="mt-4 space-y-3">
                <SkillDocs
                  skillId={skill.id}
                  apiBase={apiBase}
                  onChanged={() => void load(page, query)}
                />
                <label className="block text-sm text-slate-700">
                  Название навыка
                  <input
                    className={fieldClass}
                    value={edit.name}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  Описание
                  <textarea
                    className={fieldClass}
                    rows={3}
                    value={edit.description}
                    onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  Промпт навыка
                  <textarea
                    className={fieldClass}
                    rows={6}
                    placeholder="Если пользователь хочет оставить заявку, предложи [[кнопка:Заявка|https://yani.by/f/zayavka|попап]]"
                    value={edit.systemPrompt}
                    onChange={(e) => setEdit({ ...edit, systemPrompt: e.target.value })}
                  />
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                    Кнопка: [[кнопка:Подпись|https://ссылка]] открывается в новой вкладке. С |попап — во всплывающем
                    окне: [[кнопка:Подпись|https://ссылка|попап]].
                  </span>
                </label>
                {!orgMode && (
                <label className="block text-sm text-slate-700">
                  Модель навыка
                  <ModelSelect
                    value={edit.model}
                    allowEmpty
                    emptyLabel="Как у агента"
                    onChange={(model) => setEdit({ ...edit, model })}
                  />
                  <span className="mt-1 block text-xs text-slate-500">
                    Когда в чате выбран этот навык, ответ идёт этой моделью.
                  </span>
                </label>
                )}
                <IconField
                  busy={busy}
                  iconUrl={skill.iconUrl}
                  onUpload={(file) => void uploadIcon(skill.id, file)}
                  onRemove={() => void removeIcon(skill.id)}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveEdit(skill.id)}
                  className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm text-white disabled:opacity-60"
                >
                  Сохранить
                </button>
              </div>
            )}
          </div>
        ))}
        {!skills.length && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Sparkles size={14} /> Пока нет навыков
          </p>
        )}
      </div>
    </div>
  );
}

function IconField({
  busy,
  iconUrl,
  onUpload,
  onRemove,
}: {
  busy: boolean;
  iconUrl: string;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-violet-100 bg-violet-50/30 p-3">
      <p className="text-sm text-slate-700">Иконка навыка</p>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-white">
          {iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={iconUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Sparkles size={18} className="text-violet-300" />
          )}
        </div>
        <div>
          <p className="text-xs text-slate-500">PNG, JPG, WebP или GIF. Видна на плитке навыка в чате.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <label className="cursor-pointer rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-sm text-slate-700">
              Загрузить свою
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(file);
                  e.target.value = "";
                }}
              />
            </label>
            {iconUrl ? (
              <button
                type="button"
                disabled={busy}
                onClick={onRemove}
                className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-600 disabled:opacity-60"
              >
                Убрать
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
