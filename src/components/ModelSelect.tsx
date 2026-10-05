"use client";

import { useEffect, useMemo, useState } from "react";

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

const CUSTOM = "__custom__";

function priceLabel(model: ModelOption) {
  if (!model.pricing) return "";
  return `$${model.pricing.inputUsdPerM.toFixed(2)} / $${model.pricing.outputUsdPerM.toFixed(2)} за 1 млн`;
}

function optionLabel(model: ModelOption) {
  const price = priceLabel(model);
  return price ? `${model.displayName} · ${price}` : model.displayName;
}

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
  const [customOpen, setCustomOpen] = useState(false);

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

  const known = useMemo(() => new Set(models.map((m) => m.id)), [models]);
  const selected = models.find((m) => m.id === value);
  const showCustom =
    customOpen || Boolean(error) || (Boolean(value) && models.length > 0 && !known.has(value));
  const selectValue = showCustom ? CUSTOM : value;

  const hint = loading
    ? "Загрузка моделей…"
    : error
      ? error
      : selected
        ? `${selected.displayName}${priceLabel(selected) ? ` · ${priceLabel(selected)}` : ""}`
        : value.trim()
          ? `Свой id: ${value.trim()}`
          : provider
            ? `${models.length} моделей · ${provider}`
            : "Выберите модель";

  return (
    <div>
      <select
        id={id}
        className={className}
        value={selectValue}
        disabled={disabled || loading}
        onChange={(e) => {
          const next = e.target.value;
          if (next === CUSTOM) {
            setCustomOpen(true);
            return;
          }
          setCustomOpen(false);
          onChange(next);
        }}
      >
        {allowEmpty ? <option value="">{emptyLabel}</option> : null}
        {!allowEmpty && !value ? <option value="">Выберите модель</option> : null}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {optionLabel(m)}
          </option>
        ))}
        <option value={CUSTOM}>Вписать свой id…</option>
      </select>
      {showCustom ? (
        <input
          className={`${className} mt-2`}
          value={value}
          disabled={disabled || loading}
          placeholder="например gpt-5.5"
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}
