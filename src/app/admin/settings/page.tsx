"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ModelSelect } from "@/components/ModelSelect";
import { formatExact } from "@/lib/money";
import { PagedRows } from "@/components/PagedRows";
import { minskDayKey } from "@/lib/minskTime";

type Usage = {
  totals: {
    allLabel: string;
    todayLabel: string;
    monthLabel: string;
    requests: number;
    todayRequests: number;
    monthRequests: number;
    selectedDay?: string | null;
    selectedDayLabel?: string | null;
    selectedDayRequests?: number | null;
    selectedDayCostLabel?: string | null;
  };
  byModel: Array<{
    model: string;
    displayName: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    costLabel: string;
    inputUsdPerM: number | null;
    outputUsdPerM: number | null;
  }>;
  byAgent: Array<{
    agentId: string;
    name: string;
    currentModel: string;
    requests: number;
    costLabel: string;
  }>;
  prices: Array<{
    id: string;
    displayName: string;
    inputUsdPerM: number;
    outputUsdPerM: number;
  }>;
};

type SiteSeo = {
  title: string;
  description: string;
  keywords: string;
  siteName: string;
  faviconUrl: string;
  ogImageUrl: string;
};

const emptySeo: SiteSeo = {
  title: "",
  description: "",
  keywords: "",
  siteName: "",
  faviconUrl: "",
  ogImageUrl: "",
};

export default function SettingsPage() {
  const orgMode = usePathname().startsWith("/org");
  const [model, setModel] = useState("");
  const [saved, setSaved] = useState("");
  const [message, setMessage] = useState("");
  const [provider, setProvider] = useState("vibecode");
  const [providerOptions, setProviderOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [providerNote, setProviderNote] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageError, setUsageError] = useState("");
  const [seo, setSeo] = useState<SiteSeo>(emptySeo);
  const [seoNote, setSeoNote] = useState("");
  const [sitemapUrl, setSitemapUrl] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [accountNote, setAccountNote] = useState("");
  const [accountSaving, setAccountSaving] = useState(false);
  const [yandexKey, setYandexKey] = useState("");
  const [yandexFolder, setYandexFolder] = useState("");
  const [yandexDayPrice, setYandexDayPrice] = useState("488");
  const [yandexNightPrice, setYandexNightPrice] = useState("366");
  const [yandexHint, setYandexHint] = useState("");
  const [yandexSource, setYandexSource] = useState<"admin" | "env" | "none">("none");
  const [yandexNote, setYandexNote] = useState("");
  const [yandexSaving, setYandexSaving] = useState(false);
  const [yandexSpend, setYandexSpend] = useState<{
    today: { label: string; requests: number };
    month: { label: string; requests: number };
    all: { label: string; requests: number };
    selected?: { label: string; requests: number; day: string; dayLabel: string };
  } | null>(null);
  const [yandexDay, setYandexDay] = useState(() => minskDayKey(new Date()));
  const [usageDay, setUsageDay] = useState(() => minskDayKey(new Date()));

  useEffect(() => {
    if (!orgMode) {
      void fetch("/api/auth/account")
        .then((r) => r.json())
        .then((d) => {
          if (d.email) setAccountEmail(d.email);
        });
      void fetch("/api/llm/default-model")
        .then((r) => r.json())
        .then((d) => {
          setModel(d.model ?? "");
          setSaved(d.model ?? "");
        });
      void fetch("/api/llm/provider")
        .then((r) => r.json())
        .then((d) => {
          setProvider(d.provider ?? "vibecode");
          setProviderOptions(d.options ?? []);
        });
    }
    void fetch("/api/site/seo")
      .then((r) => r.json())
      .then((d) => {
        if (d.seo) setSeo(d.seo);
        if (d.sitemapUrl) setSitemapUrl(d.sitemapUrl);
      });
  }, [orgMode]);

  useEffect(() => {
    if (orgMode) return;
    let cancelled = false;
    void fetch(`/api/admin/yandex-search?day=${encodeURIComponent(yandexDay)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.settings) return;
        setYandexFolder(d.settings.folderId ?? "");
        setYandexDayPrice(String(d.settings.dayRubPer1000 ?? 488));
        setYandexNightPrice(String(d.settings.nightRubPer1000 ?? 366));
        setYandexHint(d.settings.keyHint ?? "");
        setYandexSource(d.settings.source ?? "none");
        setYandexSpend(d.spend ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgMode, yandexDay]);

  useEffect(() => {
    if (orgMode) return;
    let cancelled = false;
    setUsageError("");
    void fetch(`/api/llm/usage?day=${encodeURIComponent(usageDay)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Не удалось посчитать расходы");
        if (!cancelled) setUsage(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setUsageError(e instanceof Error ? e.message : "Не удалось посчитать расходы");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orgMode, usageDay]);

  async function saveAccount() {
    setAccountNote("");
    if (newPassword && newPassword !== newPassword2) {
      setAccountNote("Новые пароли не совпадают");
      return;
    }
    setAccountSaving(true);
    try {
      const res = await fetch("/api/auth/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: accountEmail,
          currentPassword,
          newPassword: newPassword || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAccountNote(data.error ?? "Не удалось сохранить");
        return;
      }
      setAccountEmail(data.email ?? accountEmail);
      setCurrentPassword("");
      setNewPassword("");
      setNewPassword2("");
      setAccountNote(
        data.passwordChanged
          ? "Логин и пароль обновлены"
          : "Логин обновлён. Пароль не менялся.",
      );
    } finally {
      setAccountSaving(false);
    }
  }

  async function saveModel() {
    setMessage("");
    const res = await fetch("/api/llm/default-model", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error ?? "Не сохранилось");
      return;
    }
    setSaved(data.model);
    setMessage("Модель по умолчанию сохранена. У каждого агента своя модель в его карточке.");
  }

  async function saveProvider(next: string) {
    setProviderNote("");
    setProvider(next);
    const res = await fetch("/api/llm/provider", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: next,
        defaultModel: next === "hoster" ? "qwen3.8-27b" : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setProviderNote(data.error ?? "Не удалось переключить");
      return;
    }
    setProvider(data.provider ?? next);
    if (next === "hoster") {
      setModel("qwen3.8-27b");
      setSaved("qwen3.8-27b");
    }
    setProviderNote(
      next === "hoster"
        ? "Сейчас ответы идут через hoster.by AI (qwen3.8-27b)."
        : `Сейчас провайдер: ${data.provider ?? next}`,
    );
  }

  async function saveYandex() {
    setYandexNote("");
    setYandexSaving(true);
    try {
      const res = await fetch("/api/admin/yandex-search", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: yandexKey.trim() || undefined,
          folderId: yandexFolder,
          dayRubPer1000: Number(yandexDayPrice.replace(",", ".")) || 0,
          nightRubPer1000: Number(yandexNightPrice.replace(",", ".")) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setYandexNote(data.error ?? "Не удалось сохранить");
        return;
      }
      setYandexKey("");
      setYandexFolder(data.settings?.folderId ?? yandexFolder);
      setYandexHint(data.settings?.keyHint ?? "");
      setYandexSource(data.settings?.source ?? "none");
      setYandexSpend(data.spend ?? null);
      setYandexNote("Ключи Яндекса сохранены");
    } finally {
      setYandexSaving(false);
    }
  }

  async function saveSeo() {
    setSeoNote("");
    const res = await fetch("/api/site/seo", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: seo.title,
        description: seo.description,
        keywords: seo.keywords,
        siteName: seo.siteName,
      }),
    });
    const data = await res.json();
    setSeoNote(res.ok ? "SEO сохранено" : (data.error ?? "Не сохранилось"));
    if (data.seo) setSeo(data.seo);
  }

  async function uploadSiteImage(kind: "favicon" | "og", file: File) {
    setSeoNote("");
    const body = new FormData();
    body.set("file", file);
    const res = await fetch(`/api/site/seo?kind=${kind}`, { method: "POST", body });
    const data = await res.json();
    setSeoNote(res.ok ? "Картинка сохранена" : (data.error ?? "Не загрузилось"));
    if (data.seo) setSeo(data.seo);
  }

  const fieldClass =
    "mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 text-sm outline-none focus:border-violet-400";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">Настройки</h1>
        <p className="mt-1 text-slate-500">
          {orgMode
            ? "Иконка сайта и тексты для поиска"
            : "Вход в админку, модель, иконка сайта и тексты для поиска"}
        </p>
      </div>

      {!orgMode && (
        <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
          <h2 className="font-medium text-slate-900">Вход в админку</h2>
          <p className="mt-1 text-sm text-slate-500">
            Email для входа и пароль. Чтобы сменить пароль, заполните новый и подтверждение. Текущий
            пароль нужен всегда.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block text-sm text-slate-700 md:col-span-2">
              Email (логин)
              <input
                className={fieldClass}
                type="email"
                autoComplete="username"
                value={accountEmail}
                onChange={(e) => setAccountEmail(e.target.value)}
              />
            </label>
            <label className="block text-sm text-slate-700">
              Текущий пароль
              <input
                className={fieldClass}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </label>
            <div className="hidden md:block" />
            <label className="block text-sm text-slate-700">
              Новый пароль
              <input
                className={fieldClass}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Необязательно"
              />
            </label>
            <label className="block text-sm text-slate-700">
              Повтор нового пароля
              <input
                className={fieldClass}
                type="password"
                autoComplete="new-password"
                value={newPassword2}
                onChange={(e) => setNewPassword2(e.target.value)}
                placeholder="Необязательно"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={accountSaving || !accountEmail.trim() || !currentPassword}
            onClick={() => void saveAccount()}
            className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500 disabled:bg-slate-200 disabled:text-slate-400"
          >
            {accountSaving ? "Сохраняю…" : "Сохранить вход"}
          </button>
          {accountNote && <p className="mt-2 text-sm text-slate-600">{accountNote}</p>}
        </section>
      )}

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Иконка и SEO</h2>
        <p className="mt-1 text-sm text-slate-500">
          Фавикон виден во вкладке браузера. Название, описание и ключевые слова попадают в выдачу.
          Карта сайта собирается сама.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-[160px_1fr]">
          <div className="space-y-4">
            <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-violet-200 bg-violet-50 text-center text-xs text-violet-700">
              {seo.faviconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={seo.faviconUrl} alt="Фавикон" className="h-12 w-12 object-contain" />
              ) : (
                <span>Фавикон</span>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon,.ico"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadSiteImage("favicon", file);
                  e.target.value = "";
                }}
              />
            </label>
            <label className="flex h-24 w-40 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-violet-200 bg-violet-50 text-center text-xs text-violet-700">
              {seo.ogImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={seo.ogImageUrl} alt="Картинка для поиска" className="h-full w-full object-cover" />
              ) : (
                <span className="px-2">Картинка для поиска</span>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadSiteImage("og", file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <div className="space-y-3">
            <label className="block text-sm text-slate-700">
              Название сайта
              <input
                className={fieldClass}
                value={seo.siteName}
                onChange={(e) => setSeo({ ...seo, siteName: e.target.value })}
              />
            </label>
            <label className="block text-sm text-slate-700">
              Заголовок в поиске
              <input
                className={fieldClass}
                value={seo.title}
                onChange={(e) => setSeo({ ...seo, title: e.target.value })}
              />
            </label>
            <label className="block text-sm text-slate-700">
              Описание
              <textarea
                className={fieldClass}
                rows={3}
                value={seo.description}
                onChange={(e) => setSeo({ ...seo, description: e.target.value })}
              />
            </label>
            <label className="block text-sm text-slate-700">
              Ключевые слова через запятую
              <input
                className={fieldClass}
                value={seo.keywords}
                onChange={(e) => setSeo({ ...seo, keywords: e.target.value })}
              />
            </label>
            <button
              type="button"
              onClick={() => void saveSeo()}
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
            >
              Сохранить SEO
            </button>
            {seoNote && <p className="text-sm text-slate-600">{seoNote}</p>}
            {sitemapUrl && (
              <p className="text-xs text-slate-500">
                Карта сайта:{" "}
                <a href={sitemapUrl} className="font-medium text-violet-700 hover:underline" target="_blank" rel="noreferrer">
                  {sitemapUrl}
                </a>
              </p>
            )}
          </div>
        </div>
      </section>

      {!orgMode && (
      <>
      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Яндекс Поиск</h2>
        <p className="mt-1 text-sm text-slate-500">
          API-ключ сервисного аккаунта (scope yc.search-api.execute) и ID каталога. Ключ хранится
          зашифрованным. Расход считается по успешным запросам синхронного поиска: днём и ночью
          (00:00–07:59 по Москве) разные тарифы.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-700">
            День (календарь, Минск)
            <input
              type="date"
              className={fieldClass}
              value={yandexDay}
              max={minskDayKey(new Date())}
              onChange={(e) => setYandexDay(e.target.value || minskDayKey(new Date()))}
            />
          </label>
          <button
            type="button"
            className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-violet-700 hover:bg-violet-50"
            onClick={() => {
              const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
              setYandexDay(minskDayKey(yesterday));
            }}
          >
            Вчера
          </button>
          <button
            type="button"
            className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-violet-700 hover:bg-violet-50"
            onClick={() => setYandexDay(minskDayKey(new Date()))}
          >
            Сегодня
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [
              yandexSpend?.selected?.dayLabel ?? "Выбранный день",
              yandexSpend?.selected?.label,
              yandexSpend?.selected?.requests,
            ],
            ["Сегодня", yandexSpend?.today.label, yandexSpend?.today.requests],
            ["Этот месяц", yandexSpend?.month.label, yandexSpend?.month.requests],
            ["Всего", yandexSpend?.all.label, yandexSpend?.all.requests],
          ].map(([label, money, requests]) => (
            <div key={String(label)} className="rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{money ?? "—"}</p>
              <p className="mt-1 text-xs text-slate-500">{requests ?? "—"} запросов</p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-slate-700">
            API-ключ
            <input
              className={fieldClass}
              type="password"
              autoComplete="off"
              value={yandexKey}
              onChange={(e) => setYandexKey(e.target.value)}
              placeholder={yandexHint ? `Сохранён ${yandexHint}` : "Вставьте ключ"}
            />
          </label>
          <label className="block text-sm text-slate-700">
            ID каталога (folder id)
            <input
              className={fieldClass}
              value={yandexFolder}
              onChange={(e) => setYandexFolder(e.target.value)}
              placeholder="b1g..."
            />
          </label>
          <label className="block text-sm text-slate-700">
            ₽ за 1000 запросов днём
            <input
              className={fieldClass}
              inputMode="decimal"
              value={yandexDayPrice}
              onChange={(e) => setYandexDayPrice(e.target.value)}
            />
          </label>
          <label className="block text-sm text-slate-700">
            ₽ за 1000 запросов ночью
            <input
              className={fieldClass}
              inputMode="decimal"
              value={yandexNightPrice}
              onChange={(e) => setYandexNightPrice(e.target.value)}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {yandexSource === "admin"
            ? "Сейчас используется ключ из админки."
            : yandexSource === "env"
              ? "Ключ пока берётся из .env на сервере. Сохранение здесь его заменит."
              : "Ключ ещё не задан."}
          {yandexHint ? ` Последние символы: ${yandexHint}.` : ""} Пустое поле ключа его не стирает.
        </p>
        <button
          type="button"
          disabled={yandexSaving || !yandexFolder.trim()}
          onClick={() => void saveYandex()}
          className="mt-3 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {yandexSaving ? "Сохраняю…" : "Сохранить Яндекс"}
        </button>
        {yandexNote && <p className="mt-2 text-sm text-slate-600">{yandexNote}</p>}
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Провайдер ИИ</h2>
        <p className="mt-1 text-sm text-slate-500">
          vibecode.moe или ИИ hoster.by. Ключ hoster берётся из HOSTER_API_KEY на сервере.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(providerOptions.length
            ? providerOptions
            : [
                { id: "vibecode", label: "vibecode.moe" },
                { id: "hoster", label: "hoster.by AI" },
              ]
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => void saveProvider(opt.id)}
              className={`rounded-xl px-4 py-2 text-sm font-medium ${
                provider === opt.id
                  ? "bg-violet-600 text-white"
                  : "border border-violet-200 bg-white text-slate-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {providerNote && <p className="mt-2 text-sm text-slate-600">{providerNote}</p>}
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Какую модель использовать</h2>
        <p className="mt-1 text-sm text-slate-500">
          Это модель для новых агентов. Уже созданным агентам модель задаётся отдельно на странице агента.
          Выберите модель из списка. Цена в пункте: вход / выход за 1 млн токенов. Свой id можно вписать отдельно.
        </p>
        <div className="mt-3 max-w-xl">
          <ModelSelect value={model} onChange={setModel} />
        </div>
        <button
          type="button"
          onClick={() => void saveModel()}
          disabled={!model || model === saved}
          className="mt-3 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          Сохранить модель по умолчанию
        </button>
        {message && <p className="mt-2 text-sm text-slate-600">{message}</p>}
      </section>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-slate-700">
          День расходов LLM (календарь, Минск)
          <input
            type="date"
            className={fieldClass}
            value={usageDay}
            max={minskDayKey(new Date())}
            onChange={(e) => setUsageDay(e.target.value || minskDayKey(new Date()))}
          />
        </label>
        <button
          type="button"
          className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-violet-700 hover:bg-violet-50"
          onClick={() => setUsageDay(minskDayKey(new Date(Date.now() - 24 * 60 * 60 * 1000)))}
        >
          Вчера
        </button>
        <button
          type="button"
          className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-violet-700 hover:bg-violet-50"
          onClick={() => setUsageDay(minskDayKey(new Date()))}
        >
          Сегодня
        </button>
      </div>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [
            usage?.totals.selectedDayLabel ?? "Выбранный день",
            usage?.totals.selectedDayCostLabel,
            usage?.totals.selectedDayRequests,
          ],
          ["Сегодня", usage?.totals.todayLabel, usage?.totals.todayRequests],
          ["Этот месяц", usage?.totals.monthLabel, usage?.totals.monthRequests],
          ["Всего", usage?.totals.allLabel, usage?.totals.requests],
        ].map(([label, money, requests]) => (
          <div key={String(label)} className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{money ?? "—"}</p>
            <p className="mt-1 text-xs text-slate-500">{requests ?? "—"} запросов</p>
          </div>
        ))}
      </section>

      {usageError && <p className="text-sm text-rose-600">{usageError}</p>}

      <p className="text-sm text-slate-500">
        Полный отчёт по токенам, агентам и каждому запросу — на странице{" "}
        <Link href="/admin/analytics" className="font-medium text-violet-700 hover:underline">
          Аналитика
        </Link>
        .
      </p>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-medium text-slate-900">Потрачено по моделям</h2>
        <p className="mb-4 text-sm text-slate-500">
          Сумма считается по ценам каталога провайдера: входные и выходные токены каждого запроса.
        </p>
        <PagedRows
          items={usage?.byModel ?? []}
          text={(row) => `${row.displayName} ${row.model}`}
          placeholder="Поиск по модели"
        >
          {(rows) => (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">Модель</th>
                <th className="py-2 pr-3">Цена вход / выход</th>
                <th className="py-2 pr-3">Запросы</th>
                <th className="py-2 pr-3">Токены</th>
                <th className="py-2">Потрачено</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.model} className="border-t border-violet-50">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-slate-800">{row.displayName}</div>
                    <div className="font-mono text-xs text-slate-400">{row.model}</div>
                  </td>
                  <td className="py-2 pr-3 text-slate-600">
                    {row.inputUsdPerM == null
                      ? "—"
                      : `$${formatExact(row.inputUsdPerM)} / $${formatExact(row.outputUsdPerM ?? 0)} за 1 млн`}
                  </td>
                  <td className="py-2 pr-3">{row.requests}</td>
                  <td className="py-2 pr-3 text-slate-600">
                    {row.inputTokens.toLocaleString("ru-RU")} → {row.outputTokens.toLocaleString("ru-RU")}
                  </td>
                  <td className="py-2 font-medium">{row.costLabel}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="py-4 text-slate-500">
                    Запросов ещё не было — сумма появится после первого ответа в чате.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
          )}
        </PagedRows>
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-medium text-slate-900">Потрачено по агентам</h2>
        <PagedRows
          items={usage?.byAgent ?? []}
          text={(row) => `${row.name} ${row.currentModel}`}
          placeholder="Поиск по агентам"
        >
          {(rows) => (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">Агент</th>
                <th className="py-2 pr-3">Сейчас модель</th>
                <th className="py-2 pr-3">Запросы</th>
                <th className="py-2">Потрачено</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.agentId} className="border-t border-violet-50">
                  <td className="py-2 pr-3 font-medium text-slate-800">{row.name}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-500">{row.currentModel || "—"}</td>
                  <td className="py-2 pr-3">{row.requests}</td>
                  <td className="py-2 font-medium">{row.costLabel}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={4} className="py-4 text-slate-500">
                    Пока нет расходов по агентам.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
          )}
        </PagedRows>
      </section>
      </>
      )}
    </div>
  );
}
