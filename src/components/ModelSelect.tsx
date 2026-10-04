"use client";

import { useEffect, useState } from "react";

type ModelOption = {
  id: string;
  displayName: string;
  isImage?: boolean;
  pricing?: {
    inputUsdPerM: number;
    outputUsdPerM: number;
  };
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
};

export function ModelSelect({
  value,
  onChange,
  allowEmpty = false,
  emptyLabel = "Как у агента",
  className = "mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 text-sm text-slate-800",
  id,
  disabled,
}: Props) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [provider, setProvider] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/llm/models?kind=chat");
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? "Не удалось загрузить модели");
        }
        if (cancelled) return;
        setProvider(data.provider ?? "");
        setModels(data.models ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Ошибка загрузки моделей");
          setModels([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const known = new Set(models.map((m) => m.id));
  const orphan = value && !known.has(value) ? value : "";

  return (
    <div>
      <select
        id={id}
        className={className}
        value={value}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value)}
      >
        {allowEmpty ? <option value="">{emptyLabel}</option> : null}
        {!allowEmpty && !value ? <option value="">Выберите модель</option> : null}
        {orphan ? <option value={orphan}>{orphan} (текущая)</option> : null}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.displayName}
            {m.pricing ? ` · $${m.pricing.inputUsdPerM.toFixed(2)} / $${m.pricing.outputUsdPerM.toFixed(2)} за 1 млн` : ""}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-slate-500">
        {loading
          ? "Загрузка моделей…"
          : error
            ? error
            : provider
              ? `${models.length} моделей · ${provider}`
              : null}
      </p>
    </div>
  );
}
