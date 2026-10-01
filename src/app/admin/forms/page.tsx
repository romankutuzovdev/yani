"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type FormRow = {
  id: string;
  title: string;
  slug: string;
  enabled: boolean;
  updatedAt: string;
  _count: { fields: number; submissions: number };
};

export default function FormsPage() {
  const [forms, setForms] = useState<FormRow[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const appUrl = typeof window !== "undefined" ? window.location.origin : "";

  async function load() {
    const res = await fetch("/api/forms");
    const data = await res.json();
    setForms(data.forms ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    if (!title.trim()) return;
    setBusy(true);
    const res = await fetch("/api/forms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        fields: [
          {
            label: "Имя",
            name: "name",
            type: "TEXT",
            required: true,
            placeholder: "Как к вам обращаться",
          },
          {
            label: "Телефон",
            name: "phone",
            type: "PHONE",
            required: true,
            placeholder: "+7 …",
          },
        ],
      }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      setTitle("");
      window.location.href = `/admin/forms/${data.form.id}`;
      return;
    }
    await load();
  }

  async function remove(id: string) {
    if (!confirm("Удалить форму и все ответы?")) return;
    await fetch(`/api/forms/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">Формы</h1>
        <p className="mt-1 text-slate-500">
          Свои формы вместо Google/Яндекс. Ссылку вставляй в рабочий документ агента — откроется во фрейме чата.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Название новой формы"
          className="min-w-[240px] flex-1 rounded-xl border border-violet-200 bg-white px-4 py-2.5"
        />
        <button
          onClick={create}
          disabled={busy || !title.trim()}
          className="rounded-xl bg-violet-600 px-4 py-2.5 font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          Создать
        </button>
      </div>

      <div className="space-y-3">
        {forms.map((form) => (
          <div
            key={form.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-white px-5 py-4 shadow-sm"
          >
            <div>
              <Link
                href={`/admin/forms/${form.id}`}
                className="text-lg font-medium text-slate-900 hover:text-violet-700"
              >
                {form.title}
              </Link>
              <p className="text-xs text-slate-500">
                {form.enabled ? "вкл" : "выкл"} · полей {form._count.fields} · ответов{" "}
                {form._count.submissions}
              </p>
              <p className="mt-1 break-all font-mono text-xs text-violet-700">
                {appUrl}/f/{form.slug}
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                href={`/f/${form.slug}`}
                target="_blank"
                className="rounded-lg border border-violet-200 px-3 py-1.5 text-sm text-slate-700"
              >
                Открыть
              </Link>
              <Link
                href={`/admin/forms/${form.id}`}
                className="rounded-lg border border-violet-200 px-3 py-1.5 text-sm text-violet-700"
              >
                Редактировать
              </Link>
              <button
                onClick={() => remove(form.id)}
                className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-600"
              >
                Удалить
              </button>
            </div>
          </div>
        ))}
        {!forms.length && (
          <p className="rounded-2xl border border-dashed border-violet-200 bg-white p-8 text-center text-slate-500">
            Пока нет форм — создай первую
          </p>
        )}
      </div>
    </div>
  );
}
