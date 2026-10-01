"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type FieldType =
  | "TEXT"
  | "TEXTAREA"
  | "EMAIL"
  | "PHONE"
  | "NUMBER"
  | "SELECT"
  | "CHECKBOX"
  | "DATE";

type Field = {
  id?: string;
  label: string;
  name: string;
  type: FieldType;
  required: boolean;
  placeholder: string;
  options: string[];
};

type Submission = {
  id: string;
  answers: Record<string, unknown>;
  createdAt: string;
};

type FormDetail = {
  id: string;
  title: string;
  slug: string;
  description: string;
  enabled: boolean;
  successText: string;
  fields: Field[];
  submissions: Submission[];
};

const FIELD_TYPES: Array<{ value: FieldType; label: string }> = [
  { value: "TEXT", label: "Текст" },
  { value: "TEXTAREA", label: "Многострочный" },
  { value: "EMAIL", label: "Email" },
  { value: "PHONE", label: "Телефон" },
  { value: "NUMBER", label: "Число" },
  { value: "SELECT", label: "Список" },
  { value: "CHECKBOX", label: "Галочка" },
  { value: "DATE", label: "Дата" },
];

function emptyField(): Field {
  return {
    label: "Новое поле",
    name: `field_${Date.now().toString(36)}`,
    type: "TEXT",
    required: false,
    placeholder: "",
    options: [],
  };
}

export default function FormEditPage() {
  const params = useParams<{ id: string }>();
  const [form, setForm] = useState<FormDetail | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"edit" | "answers">("edit");

  const publicUrl = useMemo(() => {
    if (!form) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/f/${form.slug}`;
  }, [form]);

  async function load() {
    const res = await fetch(`/api/forms/${params.id}`);
    const data = await res.json();
    if (data.form) setForm(data.form);
  }

  useEffect(() => {
    void load();
  }, [params.id]);

  async function save() {
    if (!form) return;
    setSaving(true);
    const res = await fetch(`/api/forms/${form.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        slug: form.slug,
        description: form.description,
        enabled: form.enabled,
        successText: form.successText,
        fields: form.fields.map((f, i) => ({
          ...f,
          sortOrder: i,
        })),
      }),
    });
    setSaving(false);
    setMessage(res.ok ? "Сохранено" : "Ошибка сохранения");
    await load();
  }

  function updateField(index: number, patch: Partial<Field>) {
    if (!form) return;
    const fields = form.fields.map((f, i) => (i === index ? { ...f, ...patch } : f));
    setForm({ ...form, fields });
  }

  if (!form) {
    return <p className="text-slate-500">Загрузка формы…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/forms" className="text-sm text-violet-600 hover:underline">
            ← Все формы
          </Link>
          <h1 className="mt-1 text-3xl font-semibold text-slate-900">{form.title}</h1>
          <p className="mt-1 break-all font-mono text-xs text-violet-700">{publicUrl}</p>
        </div>
        <div className="flex gap-2">
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-violet-200 px-4 py-2.5 text-sm text-slate-700"
          >
            Открыть
          </a>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-violet-600 px-4 py-2.5 font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>

      {message && <p className="text-sm text-violet-600">{message}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => setTab("edit")}
          className={`rounded-xl px-4 py-2 text-sm ${
            tab === "edit" ? "bg-violet-100 text-violet-800" : "bg-white text-slate-600"
          }`}
        >
          Конструктор
        </button>
        <button
          onClick={() => setTab("answers")}
          className={`rounded-xl px-4 py-2 text-sm ${
            tab === "answers" ? "bg-violet-100 text-violet-800" : "bg-white text-slate-600"
          }`}
        >
          Ответы ({form.submissions.length})
        </button>
      </div>

      {tab === "edit" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="space-y-4 rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm text-slate-700">
                Название
                <input
                  className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </label>
              <label className="text-sm text-slate-700">
                Slug (в URL)
                <input
                  className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 font-mono text-sm"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                />
              </label>
            </div>
            <label className="block text-sm text-slate-700">
              Описание
              <textarea
                className="mt-1 min-h-20 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
            <label className="block text-sm text-slate-700">
              Текст после отправки
              <input
                className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
                value={form.successText}
                onChange={(e) => setForm({ ...form, successText: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Форма включена
            </label>

            <div className="border-t border-violet-100 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-medium text-slate-900">Поля</h2>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, fields: [...form.fields, emptyField()] })}
                  className="rounded-lg border border-violet-200 px-3 py-1.5 text-sm text-violet-700"
                >
                  + Поле
                </button>
              </div>
              <div className="space-y-3">
                {form.fields.map((field, index) => (
                  <div
                    key={`${field.name}-${index}`}
                    className="rounded-xl border border-violet-100 bg-violet-50/30 p-4"
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="text-sm">
                        Подпись
                        <input
                          className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2"
                          value={field.label}
                          onChange={(e) => updateField(index, { label: e.target.value })}
                        />
                      </label>
                      <label className="text-sm">
                        Тип
                        <select
                          className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2"
                          value={field.type}
                          onChange={(e) =>
                            updateField(index, { type: e.target.value as FieldType })
                          }
                        >
                          {FIELD_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm">
                        Имя поля (техн.)
                        <input
                          className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 font-mono text-xs"
                          value={field.name}
                          onChange={(e) => updateField(index, { name: e.target.value })}
                        />
                      </label>
                      <label className="text-sm">
                        Placeholder
                        <input
                          className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2"
                          value={field.placeholder}
                          onChange={(e) => updateField(index, { placeholder: e.target.value })}
                        />
                      </label>
                    </div>
                    {field.type === "SELECT" && (
                      <label className="mt-3 block text-sm">
                        Варианты (через запятую)
                        <input
                          className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2"
                          value={field.options.join(", ")}
                          onChange={(e) =>
                            updateField(index, {
                              options: e.target.value
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      </label>
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) => updateField(index, { required: e.target.checked })}
                        />
                        Обязательное
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            fields: form.fields.filter((_, i) => i !== index),
                          })
                        }
                        className="text-sm text-rose-600"
                      >
                        Удалить поле
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <aside className="h-fit rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
            <h2 className="font-medium text-slate-900">Для агента</h2>
            <p className="mt-2 text-sm text-slate-500">
              Вставь в «Рабочий документ» агента:
            </p>
            <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-violet-50 p-3 text-xs text-slate-700">
              {`Если пользователь просит заявку — предложи форму:
${publicUrl}
Название: «${form.title}».`}
            </pre>
            <button
              type="button"
              className="mt-3 w-full rounded-xl border border-violet-200 px-3 py-2 text-sm text-violet-700"
              onClick={() => {
                void navigator.clipboard.writeText(
                  `Если пользователь просит заявку — предложи форму:\n${publicUrl}\nНазвание: «${form.title}».`,
                );
                setMessage("Текст скопирован");
              }}
            >
              Скопировать подсказку
            </button>
          </aside>
        </div>
      ) : (
        <section className="space-y-3">
          {form.submissions.map((s) => (
            <div
              key={s.id}
              className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm"
            >
              <p className="text-xs text-slate-500">
                {new Date(s.createdAt).toLocaleString("ru-RU")}
              </p>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                {Object.entries(s.answers).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-xs uppercase tracking-wide text-slate-400">{key}</dt>
                    <dd className="text-sm text-slate-800">
                      {typeof value === "boolean"
                        ? value
                          ? "Да"
                          : "Нет"
                        : String(value ?? "")}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          {!form.submissions.length && (
            <p className="rounded-2xl border border-dashed border-violet-200 bg-white p-8 text-center text-slate-500">
              Ответов пока нет
            </p>
          )}
        </section>
      )}
    </div>
  );
}
