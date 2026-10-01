"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Field = {
  id: string;
  label: string;
  name: string;
  type: string;
  required: boolean;
  placeholder: string;
  options: string[];
};

type PublicForm = {
  title: string;
  description: string;
  successText: string;
  fields: Field[];
};

export default function PublicFormPage() {
  const params = useParams<{ slug: string }>();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetch(`/api/public/forms/${params.slug}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.form) {
          setError(data.error ?? "Форма не найдена");
          return;
        }
        setForm(data.form);
        const initial: Record<string, string | boolean> = {};
        for (const f of data.form.fields as Field[]) {
          initial[f.name] = f.type === "CHECKBOX" ? false : "";
        }
        setAnswers(initial);
      })
      .catch(() => setError("Не удалось загрузить форму"))
      .finally(() => setLoading(false));
  }, [params.slug]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/public/forms/${params.slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Ошибка отправки");
      } else {
        setDone(data.message ?? form.successText);
      }
    } catch {
      setError("Сетевая ошибка");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-violet-50 text-slate-500">
        Загрузка формы…
      </div>
    );
  }

  if (error && !form) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-violet-50 px-4 text-rose-600">
        {error}
      </div>
    );
  }

  if (!form) return null;

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_#f5f3ff_0%,_#ffffff_60%)] px-4">
        <div className="w-full max-w-lg rounded-3xl border border-violet-100 bg-white p-8 text-center shadow-lg">
          <p className="text-2xl font-semibold text-slate-900">Готово</p>
          <p className="mt-3 text-slate-600">{done}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#f5f3ff_0%,_#ffffff_60%)] px-4 py-8 text-slate-800">
      <form
        onSubmit={onSubmit}
        className="mx-auto w-full max-w-lg space-y-5 rounded-3xl border border-violet-100 bg-white p-6 shadow-lg md:p-8"
      >
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{form.title}</h1>
          {form.description && (
            <p className="mt-2 text-sm text-slate-500">{form.description}</p>
          )}
        </div>

        {form.fields.map((field) => (
          <label key={field.id} className="block text-sm text-slate-700">
            <span>
              {field.label}
              {field.required ? " *" : ""}
            </span>
            {field.type === "TEXTAREA" ? (
              <textarea
                required={field.required}
                placeholder={field.placeholder}
                className="mt-2 min-h-28 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-4 py-3 outline-none focus:border-violet-400"
                value={String(answers[field.name] ?? "")}
                onChange={(e) =>
                  setAnswers((prev) => ({ ...prev, [field.name]: e.target.value }))
                }
              />
            ) : field.type === "SELECT" ? (
              <select
                required={field.required}
                className="mt-2 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-4 py-3 outline-none focus:border-violet-400"
                value={String(answers[field.name] ?? "")}
                onChange={(e) =>
                  setAnswers((prev) => ({ ...prev, [field.name]: e.target.value }))
                }
              >
                <option value="">Выберите…</option>
                {field.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : field.type === "CHECKBOX" ? (
              <span className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(answers[field.name])}
                  onChange={(e) =>
                    setAnswers((prev) => ({ ...prev, [field.name]: e.target.checked }))
                  }
                />
                <span className="text-slate-600">{field.placeholder || field.label}</span>
              </span>
            ) : (
              <input
                required={field.required}
                type={
                  field.type === "EMAIL"
                    ? "email"
                    : field.type === "NUMBER"
                      ? "number"
                      : field.type === "DATE"
                        ? "date"
                        : field.type === "PHONE"
                          ? "tel"
                          : "text"
                }
                placeholder={field.placeholder}
                className="mt-2 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-4 py-3 outline-none focus:border-violet-400"
                value={String(answers[field.name] ?? "")}
                onChange={(e) =>
                  setAnswers((prev) => ({ ...prev, [field.name]: e.target.value }))
                }
              />
            )}
          </label>
        ))}

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <button
          disabled={busy}
          className="w-full rounded-xl bg-violet-600 px-4 py-3 font-medium text-white hover:bg-violet-500 disabled:opacity-60"
        >
          {busy ? "Отправка…" : "Отправить"}
        </button>
      </form>
    </div>
  );
}
