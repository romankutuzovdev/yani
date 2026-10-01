"use client";

import { useEffect, useState } from "react";

type Key = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  rateLimit: number;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
};

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [name, setName] = useState("");
  const [rawKey, setRawKey] = useState("");

  async function load() {
    const res = await fetch("/api/api-keys");
    const data = await res.json();
    setKeys(data.keys ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    const res = await fetch("/api/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.rawKey) setRawKey(data.rawKey);
    setName("");
    await load();
  }

  async function revoke(id: string) {
    await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">API-ключи</h1>
        <p className="mt-1 text-slate-500">Ключи хранятся хешированными. Скопируйте raw-ключ сразу.</p>
      </div>

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Название ключа"
          className="rounded-xl border border-violet-200 bg-white px-4 py-2.5"
        />
        <button
          onClick={create}
          className="rounded-xl bg-violet-600 px-4 py-2.5 font-medium text-white hover:bg-violet-500"
        >
          Создать ключ
        </button>
      </div>

      {rawKey && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="mb-2 font-medium text-amber-900">Скопируйте сейчас — больше не покажем</p>
          <code className="break-all text-amber-950">{rawKey}</code>
        </div>
      )}

      <div className="space-y-3">
        {keys.map((key) => (
          <div
            key={key.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-white px-5 py-4 shadow-sm"
          >
            <div>
              <p className="font-medium text-slate-900">{key.name}</p>
              <p className="text-xs text-slate-500">
                {key.keyPrefix}… · {key.scopes.join(", ")} · {key.rateLimit}/мин
              </p>
              <p className="text-xs text-slate-500">
                Создан {new Date(key.createdAt).toLocaleString("ru-RU")}
                {key.lastUsedAt
                  ? ` · Использован ${new Date(key.lastUsedAt).toLocaleString("ru-RU")}`
                  : ""}
                {key.revokedAt ? " · ОТОЗВАН" : ""}
              </p>
            </div>
            {!key.revokedAt && (
              <button
                onClick={() => revoke(key.id)}
                className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-600"
              >
                Отозвать
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
