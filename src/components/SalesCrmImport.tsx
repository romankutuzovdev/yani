"use client";

import { useEffect, useState } from "react";
import { Download, Play, Square, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type PreviewRow = {
  rowNumber: number;
  displayName: string;
  company: string;
  email: string;
  phone: string;
  telegram: string;
  status: "OK" | "DUPLICATE" | "SKIPPED";
  reason: string;
};

type ImportJob = {
  id: string;
  fileName: string;
  status: string;
  totalRows: number;
  validRows: number;
  createdCount: number;
  duplicateCount: number;
  skippedCount: number;
};

type Campaign = {
  id: string;
  name: string;
  status: string;
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
  const [job, setJob] = useState<ImportJob | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignName, setCampaignName] = useState("Первые письма");
  const [subject, setSubject] = useState("Коротко про {{company}}");
  const [bodyTemplate, setBodyTemplate] = useState(
    "Здравствуйте, {{name}}!\n\nПишу по поводу решения для {{company}}. Могу коротко рассказать, как Yani помогает продажам.\n\nГотовы к короткому созвону?",
  );
  const [dailyLimit, setDailyLimit] = useState(20);
  const [intervalSeconds, setIntervalSeconds] = useState(90);
  const [quietStart, setQuietStart] = useState("22");
  const [quietEnd, setQuietEnd] = useState("8");

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
    void loadCampaigns();
  }, [agentId, playbookId]);

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("agentId", agentId);
      form.set("file", file);
      const res = await fetch(`/api/crm/playbooks/${playbookId}/import`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onNotice(data.error ?? "Не удалось разобрать файл");
        return;
      }
      setJob(data.job);
      setRows(data.rows ?? []);
      onNotice(
        `Превью: ${data.job.validRows} новых, ${data.job.duplicateCount} дублей, ${data.job.skippedCount} пропусков`,
      );
    } catch {
      onNotice("Сервер CRM недоступен. Обновите страницу.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!job) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/playbooks/${playbookId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, jobId: job.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onNotice(data.error ?? "Импорт не применён");
        return;
      }
      setJob(data.job);
      onNotice(`Импортировано карточек: ${data.createdCount}`);
      onImported();
    } catch {
      onNotice("Сервер CRM недоступен. Обновите страницу.");
    } finally {
      setBusy(false);
    }
  }

  async function createCampaign() {
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/playbooks/${playbookId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          name: campaignName,
          subject,
          bodyTemplate,
          dailyLimit,
          intervalSeconds,
          quietHoursStart: quietStart === "" ? null : Number(quietStart),
          quietHoursEnd: quietEnd === "" ? null : Number(quietEnd),
          importJobId: job?.status === "IMPORTED" ? job.id : undefined,
          onlyNewWithEmail: job?.status !== "IMPORTED",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onNotice(data.error ?? "Кампания не создана");
        return;
      }
      onNotice(`Кампания создана: ${data.campaign._count?.items ?? 0} писем в очереди`);
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
      <div className="flex flex-wrap items-center gap-2">
        <a
          href="/api/crm/import-template"
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-violet-700"
        >
          <Download size={16} aria-hidden />
          Шаблон CSV
        </a>
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-sm font-medium text-white">
          <Upload size={16} aria-hidden />
          Загрузить CSV/XLSX
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            disabled={busy}
            onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
          />
        </label>
        {job?.status === "PREVIEW" && (
          <button
            type="button"
            disabled={busy || !job.validRows}
            onClick={() => void confirmImport()}
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 disabled:opacity-40"
          >
            Импортировать {job.validRows}
          </button>
        )}
      </div>

      {!!rows.length && (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Имя</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Статус</th>
                <th className="px-3 py-2">Комментарий</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.rowNumber} className="border-t border-slate-100">
                  <td className="px-3 py-2">{row.rowNumber}</td>
                  <td className="px-3 py-2">{row.displayName || row.company || "—"}</td>
                  <td className="px-3 py-2">{row.email || "—"}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        row.status === "OK" && "text-emerald-700",
                        row.status === "DUPLICATE" && "text-amber-700",
                        row.status === "SKIPPED" && "text-slate-400",
                      )}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">{row.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm text-slate-600">
          Название кампании
          <input className={fieldClass} value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
        </label>
        <label className="text-sm text-slate-600">
          Тема письма
          <input className={fieldClass} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="md:col-span-2 text-sm text-slate-600">
          Текст первого письма
          <textarea
            className={cn(fieldClass, "min-h-28")}
            value={bodyTemplate}
            onChange={(e) => setBodyTemplate(e.target.value)}
          />
          <span className="mt-1 block text-xs text-slate-400">
            Плейсхолдеры: {"{{name}}"}, {"{{company}}"}, {"{{email}}"}, {"{{phone}}"}, {"{{telegram}}"}
          </span>
        </label>
        <label className="text-sm text-slate-600">
          Лимит в день
          <input
            type="number"
            min={1}
            max={500}
            className={fieldClass}
            value={dailyLimit}
            onChange={(e) => setDailyLimit(Number(e.target.value) || 1)}
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
        <label className="text-sm text-slate-600">
          Quiet hours с
          <input className={fieldClass} value={quietStart} onChange={(e) => setQuietStart(e.target.value)} placeholder="22" />
        </label>
        <label className="text-sm text-slate-600">
          Quiet hours до
          <input className={fieldClass} value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} placeholder="8" />
        </label>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => void createCampaign()}
        className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white disabled:bg-slate-200"
      >
        Создать очередь первых писем
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
                  {campaign.status} · сегодня {campaign.sentToday}/{campaign.dailyLimit} · очередь{" "}
                  {campaign.counts?.PENDING ?? 0} · интервал {campaign.intervalSeconds}с
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
