"use client";

import { useEffect, useState } from "react";
import { Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";

type ContactList = {
  id: string;
  name: string;
  channel: "EMAIL" | "TELEGRAM";
  _count?: { contacts: number };
};

type Campaign = {
  id: string;
  name: string;
  status: string;
  channel?: string;
  bodyMode?: string;
  dailyLimit: number;
  intervalSeconds: number;
  sentToday: number;
  _count?: { items: number };
  counts?: Record<string, number>;
};

const fieldClass =
  "mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100";

type Props = {
  agentId: string;
  playbookId: string;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onImported: () => void;
  onNotice: (message: string) => void;
};

export function SalesCrmImport({
  agentId,
  playbookId,
  busy,
  setBusy,
  onImported,
  onNotice,
}: Props) {
  const [lists, setLists] = useState<ContactList[]>([]);
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignName, setCampaignName] = useState("Первые письма");
  const [subject, setSubject] = useState("Коротко про {{company}}");
  const [bodyTemplate, setBodyTemplate] = useState(
    "Напиши короткое первое сообщение: познакомься, коротко объясни ценность Yani для продаж в компании получателя, предложи 15-минутный созвон. Тон дружелюбный, без воды.",
  );
  const [emailDailyLimit, setEmailDailyLimit] = useState(20);
  const [telegramDailyLimit, setTelegramDailyLimit] = useState(20);
  const [intervalSeconds, setIntervalSeconds] = useState(90);
  const [quietStart, setQuietStart] = useState("22");
  const [quietEnd, setQuietEnd] = useState("8");

  const selectedLists = lists.filter((list) => selectedListIds.has(list.id));
  const hasEmailLists = selectedLists.some((list) => list.channel === "EMAIL");
  const hasTelegramLists = selectedLists.some((list) => list.channel === "TELEGRAM");

  async function loadLists() {
    try {
      const res = await fetch(`/api/crm/playbooks/${playbookId}/contact-lists?agentId=${agentId}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setLists(data.lists ?? []);
    } catch {
      /* offline */
    }
  }

  async function loadCampaigns() {
    try {
      const res = await fetch(`/api/crm/playbooks/${playbookId}/campaigns?agentId=${agentId}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setCampaigns(data.campaigns ?? []);
    } catch {
      /* offline */
    }
  }

  useEffect(() => {
    void loadLists();
    void loadCampaigns();
  }, [agentId, playbookId]);

  function toggleList(id: string) {
    setSelectedListIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createCampaign() {
    if (!selectedListIds.size) {
      onNotice("Выберите один или несколько списков контактов");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/playbooks/${playbookId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          name: campaignName,
          subject: hasEmailLists ? subject : "",
          bodyMode: "PROMPT",
          bodyTemplate,
          emailDailyLimit,
          telegramDailyLimit,
          intervalSeconds,
          quietHoursStart: quietStart === "" ? null : Number(quietStart),
          quietHoursEnd: quietEnd === "" ? null : Number(quietEnd),
          contactListIds: [...selectedListIds],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onNotice(data.error ?? "Кампания не создана");
        return;
      }
      const created = (data.campaigns as Campaign[] | undefined) ?? (data.campaign ? [data.campaign] : []);
      const totalItems = created.reduce((sum, item) => sum + (item._count?.items ?? 0), 0);
      onNotice(`Очередь создана: ${created.length} камп., ${totalItems} контактов`);
      onImported();
      await loadCampaigns();
    } catch {
      onNotice("Сервер CRM недоступен. Обновите страницу.");
    } finally {
      setBusy(false);
    }
  }

  async function campaignAction(id: string, action: "START" | "PAUSE" | "STOP") {
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/campaigns/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onNotice(data.error ?? "Не удалось изменить кампанию");
        return;
      }
      await loadCampaigns();
    } catch {
      onNotice("Сервер CRM недоступен. Обновите страницу.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium text-slate-700">Списки контактов</p>
        <p className="mt-1 text-xs text-slate-500">
          Выберите один или несколько списков из раздела «Контакты». Новые контакты в списке
          попадут в очередь, даже если кампания уже запущена.
        </p>
        <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
          {!lists.length && (
            <li className="px-2 py-6 text-center text-sm text-slate-400">
              Списков нет — сначала создайте их в «Контакты»
            </li>
          )}
          {lists.map((list) => {
            const checked = selectedListIds.has(list.id);
            return (
              <li key={list.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm",
                    checked ? "bg-violet-50" : "hover:bg-slate-50",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleList(list.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-slate-800">{list.name}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {list.channel === "EMAIL" ? "Email" : "Telegram"} ·{" "}
                      {list._count?.contacts ?? 0}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm text-slate-600">
          Название кампании
          <input className={fieldClass} value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
        </label>
        {hasEmailLists && (
          <label className="text-sm text-slate-600">
            Тема письма
            <input className={fieldClass} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
        )}
        <label className="md:col-span-2 text-sm text-slate-600">
          Промпт агенту для первого сообщения
          <textarea
            className={cn(fieldClass, "min-h-28")}
            value={bodyTemplate}
            onChange={(e) => setBodyTemplate(e.target.value)}
          />
          <span className="mt-1 block text-xs text-slate-400">
            Агент сам напишет текст по этой инструкции для каждого контакта.
          </span>
        </label>
        <label className="text-sm text-slate-600">
          Лимит email в день
          <input
            type="number"
            min={1}
            max={500}
            className={fieldClass}
            value={emailDailyLimit}
            disabled={!hasEmailLists && selectedListIds.size > 0}
            onChange={(e) => setEmailDailyLimit(Number(e.target.value) || 1)}
          />
        </label>
        <label className="text-sm text-slate-600">
          Лимит Telegram в день
          <input
            type="number"
            min={1}
            max={500}
            className={fieldClass}
            value={telegramDailyLimit}
            disabled={!hasTelegramLists && selectedListIds.size > 0}
            onChange={(e) => setTelegramDailyLimit(Number(e.target.value) || 1)}
          />
        </label>
        <label className="text-sm text-slate-600">
          Интервал, сек
          <input
            type="number"
            min={10}
            max={86400}
            className={fieldClass}
            value={intervalSeconds}
            onChange={(e) => setIntervalSeconds(Number(e.target.value) || 10)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-slate-600">
            Quiet hours с
            <input className={fieldClass} value={quietStart} onChange={(e) => setQuietStart(e.target.value)} placeholder="22" />
          </label>
          <label className="text-sm text-slate-600">
            Quiet hours до
            <input className={fieldClass} value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} placeholder="8" />
          </label>
        </div>
      </div>

      <button
        type="button"
        disabled={busy || !selectedListIds.size}
        onClick={() => void createCampaign()}
        className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white disabled:bg-slate-200"
      >
        Создать очередь по спискам
      </button>

      {!!campaigns.length && (
        <ul className="space-y-2">
          {campaigns.map((campaign) => (
            <li
              key={campaign.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium text-slate-800">{campaign.name}</p>
                <p className="text-xs text-slate-500">
                  {campaign.status} ·{" "}
                  {campaign.channel === "TELEGRAM" ? "Telegram" : "Email"} ·{" "}
                  промпт · сегодня{" "}
                  {campaign.sentToday}/{campaign.dailyLimit} · очередь {campaign.counts?.PENDING ?? 0} ·
                  интервал {campaign.intervalSeconds}с
                </p>
              </div>
              <div className="flex gap-2">
                {campaign.status !== "RUNNING" && campaign.status !== "STOPPED" && campaign.status !== "COMPLETED" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void campaignAction(campaign.id, "START")}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs text-emerald-700"
                  >
                    <Play size={14} /> Старт
                  </button>
                )}
                {campaign.status === "RUNNING" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void campaignAction(campaign.id, "PAUSE")}
                    className="rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs text-amber-700"
                  >
                    Пауза
                  </button>
                )}
                {campaign.status !== "STOPPED" && campaign.status !== "COMPLETED" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void campaignAction(campaign.id, "STOP")}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs text-rose-700"
                  >
                    <Square size={14} /> Стоп
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
