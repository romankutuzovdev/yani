"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Mail,
  MessageCircle,
  Pause,
  Phone,
  Play,
  Plus,
  Send,
  Settings,
  Sparkles,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatUsd } from "@/lib/money";
import { SalesPlaybookSetup } from "@/components/SalesPlaybookSetup";
import { SalesCrmImport } from "@/components/SalesCrmImport";

type Agent = { id: string; name: string; isPrimary?: boolean };
type Playbook = {
  id: string;
  name: string;
  product: string;
  systemPrompt: string;
  goals: string;
  communicationStyle: string;
  restrictions: string;
  qualificationQuestions: string;
  status: "RUNNING" | "STOPPED";
  sendMode: string;
  replyCount?: number;
  replySpendUsd?: number;
  _count?: { leads: number; documents: number };
};
type Message = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  body: string;
  attachments: string;
  createdAt: string;
  outbox?: {
    status: string;
    attempts: number;
    error: string;
  } | null;
};
type Conversation = {
  id: string;
  channel: string;
  messages: Message[];
};
type Lead = {
  id: string;
  playbookId: string;
  displayName: string;
  company: string;
  email: string;
  phone: string;
  telegram: string;
  stage: string;
  notes: string;
  agentInstruction: string;
  agentPaused?: boolean;
  replyCount?: number;
  replySpendUsd?: number;
  lastContactAt: string | null;
  updatedAt: string;
  conversations?: Conversation[];
  fieldChanges?: Array<{
    id: string;
    field: string;
    oldValue: string;
    newValue: string;
    confidence: number;
    createdAt: string;
  }>;
};

const STAGES = [
  { id: "NEW", label: "Новый контакт", dot: "bg-slate-400" },
  { id: "COMMUNICATING", label: "Идёт общение", dot: "bg-blue-500" },
  { id: "READY_TO_ORDER", label: "Хочет заказать", dot: "bg-amber-500" },
  { id: "CLIENT", label: "Клиент", dot: "bg-emerald-500" },
  { id: "ARCHIVED", label: "Архив", dot: "bg-slate-300" },
] as const;

const emptyLead = {
  displayName: "",
  company: "",
  email: "",
  phone: "",
  telegram: "",
  notes: "",
  agentInstruction: "",
};

const fieldClass =
  "mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100";

function channelLabel(channel: string) {
  if (channel === "TELEGRAM") return "Telegram";
  if (channel === "EMAIL") return "Email";
  return "Вручную";
}

function formatDate(value?: string | null) {
  if (!value) return "Нет сообщений";
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function displayLead(lead: Lead) {
  return lead.displayName || lead.company || lead.email || lead.phone || lead.telegram || "Без имени";
}

function parseAttachments(raw: string) {
  try {
    const value = JSON.parse(raw || "[]");
    return Array.isArray(value)
      ? value.filter((item): item is { name: string; url: string } =>
          Boolean(item && typeof item.name === "string" && typeof item.url === "string"),
        )
      : [];
  } catch {
    return [];
  }
}

export function SalesCrm() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [playbookId, setPlaybookId] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadDraft, setLeadDraft] = useState(emptyLead);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [newPlaybookOpen, setNewPlaybookOpen] = useState(false);
  const [playbookSetupOpen, setPlaybookSetupOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [newPlaybook, setNewPlaybook] = useState({ name: "", product: "" });
  const [messageBody, setMessageBody] = useState("");
  const [messageDirection, setMessageDirection] = useState<"INBOUND" | "OUTBOUND">("INBOUND");
  const [messageChannel, setMessageChannel] = useState<"MANUAL" | "TELEGRAM" | "EMAIL">("MANUAL");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftSources, setDraftSources] = useState<Array<{ id: string; fileName: string; url: string }>>([]);
  const [lastDraftCost, setLastDraftCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [health, setHealth] = useState<{
    status: string;
    redis: { status: string };
    queues: Record<string, number>;
    engine: string;
  } | null>(null);
  const [playbookQueues, setPlaybookQueues] = useState<Record<string, number> | null>(null);

  const activePlaybook = useMemo(
    () => playbooks.find((item) => item.id === playbookId) ?? null,
    [playbooks, playbookId],
  );

  const agentQuery = agentId ? `agentId=${encodeURIComponent(agentId)}` : "";
  const appendAgent = useCallback(
    (url: string) => `${url}${url.includes("?") ? "&" : "?"}${agentQuery}`,
    [agentQuery],
  );

  const loadPlaybooks = useCallback(async (nextAgentId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/crm/playbooks?agentId=${encodeURIComponent(nextAgentId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data.error ?? "Не удалось загрузить CRM");
        return;
      }
      const rows = (data.playbooks ?? []) as Playbook[];
      setPlaybooks(rows);
      setPlaybookId((current) => (rows.some((row) => row.id === current) ? current : rows[0]?.id ?? ""));
    } catch {
      setNotice("Сервер CRM недоступен. Обновите страницу.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLeads = useCallback(async () => {
    if (!playbookId) {
      setLeads([]);
      return;
    }
    try {
      const res = await fetch(
        appendAgent(`/api/crm/leads?playbookId=${encodeURIComponent(playbookId)}`),
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data.error ?? "Не удалось загрузить карточки");
        return;
      }
      setLeads(data.leads ?? []);
      if (data.playbook) {
        setPlaybooks((items) =>
          items.map((item) => (item.id === data.playbook.id ? { ...item, ...data.playbook } : item)),
        );
      }
    } catch {
      setNotice("Сервер CRM недоступен. Обновите страницу.");
    }
  }, [appendAgent, playbookId]);

  useEffect(() => {
    void fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        const rows = (data.agents ?? []) as Agent[];
        setAgents(rows);
        const first = rows.find((row) => row.isPrimary) ?? rows[0];
        if (first) setAgentId(first.id);
        else setLoading(false);
      })
      .catch(() => {
        setNotice("Не удалось загрузить агентов");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (agentId) void loadPlaybooks(agentId);
  }, [agentId, loadPlaybooks]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    async function loadHealth() {
      try {
        const query = new URLSearchParams({ agentId });
        if (playbookId) query.set("playbookId", playbookId);
        const res = await fetch(`/api/crm/health?${query.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        setHealth(data.health ?? null);
        setPlaybookQueues(data.playbookQueues ?? null);
      } catch {
        if (!cancelled) {
          setHealth(null);
          setPlaybookQueues(null);
        }
      }
    }
    void loadHealth();
    const timer = setInterval(() => void loadHealth(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [agentId, playbookId]);

  async function createPlaybook() {
    if (!newPlaybook.name.trim()) return;
    setBusy(true);
    setNotice("");
    const res = await fetch("/api/crm/playbooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, ...newPlaybook }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setNotice(data.error ?? "Не удалось создать навык");
      return;
    }
    setNewPlaybook({ name: "", product: "" });
    setNewPlaybookOpen(false);
    await loadPlaybooks(agentId);
    setPlaybookId(data.playbook.id);
  }

  async function togglePlaybook() {
    if (!activePlaybook) return;
    const status = activePlaybook.status === "RUNNING" ? "STOPPED" : "RUNNING";
    setBusy(true);
    const res = await fetch(`/api/crm/playbooks/${activePlaybook.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, status }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setNotice(data.error ?? "Не удалось изменить состояние");
      return;
    }
    setPlaybooks((items) =>
      items.map((item) => (item.id === data.playbook.id ? { ...item, ...data.playbook } : item)),
    );
  }


  async function changeSendMode(sendMode: string) {
    if (!activePlaybook) return;
    setBusy(true);
    const res = await fetch(`/api/crm/playbooks/${activePlaybook.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, sendMode }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setNotice(data.error ?? "Не удалось изменить режим");
      return;
    }
    setPlaybooks((items) =>
      items.map((item) => (item.id === data.playbook.id ? { ...item, ...data.playbook } : item)),
    );
  }

  async function createLead() {
    if (!playbookId) return;
    setBusy(true);
    setNotice("");
    const res = await fetch("/api/crm/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, playbookId, ...leadDraft }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setNotice(data.error ?? "Не удалось создать карточку");
      if (data.existingLeadId) void openLead(data.existingLeadId);
      return;
    }
    setLeadDraft(emptyLead);
    setNewLeadOpen(false);
    await loadLeads();
    void openLead(data.lead.id);
  }

  async function openLead(id: string) {
    const res = await fetch(appendAgent(`/api/crm/leads/${id}`));
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error ?? "Не удалось открыть карточку");
      return;
    }
    setDraftPrompt("");
    setDraftSources([]);
    const channels = (data.lead.conversations ?? []).map((conversation: Conversation) => conversation.channel);
    setMessageChannel(channels.includes("TELEGRAM") ? "TELEGRAM" : channels.includes("EMAIL") ? "EMAIL" : "MANUAL");
    setSelectedLead(data.lead);
  }

  useEffect(() => {
    if (!selectedLead?.id) return;
    const leadId = selectedLead.id;
    const timer = setInterval(async () => {
      const res = await fetch(appendAgent(`/api/crm/leads/${leadId}`)).catch(() => null);
      if (!res?.ok) return;
      const data = await res.json().catch(() => null);
      if (!data?.lead) return;
      setSelectedLead((current) =>
        current?.id === leadId
          ? {
              ...current,
              conversations: data.lead.conversations,
              stage: data.lead.stage,
              replyCount: data.lead.replyCount,
              replySpendUsd: data.lead.replySpendUsd,
              fieldChanges: data.lead.fieldChanges,
            }
          : current,
      );
    }, 5000);
    return () => clearInterval(timer);
  }, [appendAgent, selectedLead?.id]);

  async function saveLead(patch?: Partial<Lead> & { agentPaused?: boolean }) {
    if (!selectedLead) return;
    setBusy(true);
    setNotice("");
    const payload = { ...selectedLead, ...patch, agentId };
    const res = await fetch(`/api/crm/leads/${selectedLead.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setNotice(data.error ?? "Не удалось сохранить карточку");
      return;
    }
    await loadLeads();
    await openLead(selectedLead.id);
  }

  async function changeStage(lead: Lead, stage: string) {
    const res = await fetch(`/api/crm/leads/${lead.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, stage }),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error ?? "Не удалось изменить этап");
      return;
    }
    setLeads((items) => items.map((item) => (item.id === lead.id ? { ...item, stage } : item)));
    if (selectedLead?.id === lead.id) setSelectedLead({ ...selectedLead, stage });
  }

  async function addMessage() {
    if (!selectedLead || !messageBody.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/crm/leads/${selectedLead.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId,
        channel: messageDirection === "INBOUND" ? "MANUAL" : messageChannel,
        direction: messageDirection,
        body: messageBody,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setNotice(data.error ?? "Не удалось добавить сообщение");
      return;
    }
    setMessageBody("");
    await loadLeads();
    await openLead(selectedLead.id);
  }

  async function updateOutbox(message: Message, action: "APPROVE" | "REJECT" | "EDIT") {
    let body: string | undefined;
    if (action === "EDIT") {
      const next = window.prompt("Измените текст черновика", message.body);
      if (next === null) return;
      body = next.trim();
      if (!body) return;
    }
    setBusy(true);
    const response = await fetch(`/api/crm/messages/${message.id}/outbox`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, action, body }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setNotice(data.error ?? "Не удалось изменить черновик");
      return;
    }
    if (selectedLead) await openLead(selectedLead.id);
  }

  async function generateDraft(kind: "ANSWER" | "PROPOSAL") {
    if (!selectedLead) return;
    if (kind === "ANSWER" && !draftPrompt.trim()) {
      setNotice("Введите вопрос клиента");
      return;
    }
    setBusy(true);
    setNotice("");
    const res = await fetch(`/api/crm/leads/${selectedLead.id}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, kind, prompt: draftPrompt }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setNotice(data.error ?? "Не удалось подготовить черновик");
      return;
    }
    setMessageDirection("OUTBOUND");
    setMessageBody(data.draft ?? "");
    setDraftSources(data.sources ?? []);
    const cost = Number(data.usage?.estimatedCost ?? 0);
    setLastDraftCost(
      cost
        ? `Этот ответ: ${formatUsd(cost)} · ${data.usage.inputTokens}+${data.usage.outputTokens} токенов`
        : "",
    );
    if (data.playbookSpend && activePlaybook) {
      setPlaybooks((items) =>
        items.map((item) =>
          item.id === activePlaybook.id ? { ...item, ...data.playbookSpend } : item,
        ),
      );
    }
    if (data.leadSpend) {
      setSelectedLead((lead) => (lead ? { ...lead, ...data.leadSpend } : lead));
      setLeads((items) =>
        items.map((item) => (item.id === selectedLead.id ? { ...item, ...data.leadSpend } : item)),
      );
    }
  }

  const allMessages = useMemo(
    () =>
      (selectedLead?.conversations ?? [])
        .flatMap((conversation) =>
          conversation.messages.map((message) => ({ ...message, channel: conversation.channel })),
        )
        .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
    [selectedLead],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">CRM продаж</h1>
          <p className="mt-1 text-slate-500">Клиенты, диалоги и управление ИИ-агентом в одном месте</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setNewPlaybookOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50"
          >
            <Plus size={17} aria-hidden />
            Навык продажи
          </button>
          <button
            type="button"
            disabled={!activePlaybook}
            onClick={() => setPlaybookSetupOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:border-slate-200 disabled:text-slate-300"
          >
            <Settings size={17} aria-hidden />
            Настроить
          </button>
          <button
            type="button"
            disabled={!activePlaybook}
            onClick={() => setImportOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:border-slate-200 disabled:text-slate-300"
          >
            <Upload size={17} aria-hidden />
            Импорт
          </button>
          <button
            type="button"
            disabled={!activePlaybook}
            onClick={() => setNewLeadOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:bg-slate-200"
          >
            <Plus size={17} aria-hidden />
            Карточка
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>{notice}</span>
          <button type="button" aria-label="Закрыть сообщение" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {health && (
        <div className="flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
          <span>
            CRM:{" "}
            <strong className={health.status === "ok" ? "text-emerald-700" : "text-amber-700"}>
              {health.status}
            </strong>
          </span>
          <span>БД: {health.engine}</span>
          <span>Redis: {health.redis.status}</span>
          <span>Черновики: {playbookQueues?.draft ?? health.queues.outboxDraft}</span>
          <span>К отправке: {playbookQueues?.approved ?? health.queues.outboxApproved}</span>
          <span>Ожидают агента: {playbookQueues?.waiting ?? health.queues.inboundWaiting}</span>
          <span>Кампания: {playbookQueues?.pendingCampaign ?? health.queues.campaignPending}</span>
          <span>Dead-letter: {playbookQueues?.dead ?? health.queues.deadLettersOpen}</span>
          <span>
            Ответы агента: {formatUsd(activePlaybook?.replySpendUsd ?? 0)} · {activePlaybook?.replyCount ?? 0}
          </span>
        </div>
      )}

      <section className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[minmax(180px,1fr)_minmax(220px,1.4fr)_auto] md:items-end">
          <label className="text-sm text-slate-600">
            Агент
            <select className={fieldClass} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-600">
            Навык продажи
            <select
              className={fieldClass}
              value={playbookId}
              onChange={(e) => setPlaybookId(e.target.value)}
            >
              {!playbooks.length && <option value="">Создайте первый навык</option>}
              {playbooks.map((playbook) => (
                <option key={playbook.id} value={playbook.id}>
                  {playbook.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!activePlaybook || busy}
            onClick={() => void togglePlaybook()}
            className={cn(
              "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium",
              activePlaybook?.status === "RUNNING"
                ? "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                : "bg-emerald-600 text-white hover:bg-emerald-500",
            )}
          >
            {activePlaybook?.status === "RUNNING" ? <Pause size={17} /> : <Play size={17} />}
            {activePlaybook?.status === "RUNNING" ? "Остановить агента" : "Запустить агента"}
          </button>
        </div>
        {activePlaybook && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className={activePlaybook.status === "RUNNING" ? "text-emerald-700" : "text-slate-500"}>
              {activePlaybook.status === "RUNNING" ? "Агент запущен" : "Агент остановлен"}
            </span>
            <span>{activePlaybook._count?.leads ?? leads.length} карточек</span>
            <span>{activePlaybook._count?.documents ?? 0} документов</span>
            <span>
              Расход на ответы: {formatUsd(activePlaybook.replySpendUsd ?? 0)} · {activePlaybook.replyCount ?? 0}
            </span>
            {activePlaybook.product && <span className="truncate">Продукт: {activePlaybook.product}</span>}
            <label className="ml-auto flex items-center gap-2 text-xs text-slate-600">
              Режим ответов
              <select
                className="rounded-lg border border-violet-200 bg-white px-2 py-1 text-xs text-slate-700"
                value={activePlaybook.sendMode}
                onChange={(e) => void changeSendMode(e.target.value)}
              >
                <option value="APPROVAL_REQUIRED">С подтверждением</option>
                <option value="DRAFT_ONLY">Только черновики</option>
                <option value="AUTO">Автоотправка</option>
              </select>
            </label>
          </div>
        )}
      </section>

      {!activePlaybook && !loading ? (
        <section className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/40 px-6 py-12 text-center">
          <h2 className="font-medium text-slate-900">Создайте первый навык продажи</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
            Отдельный навык хранит свой продукт, клиентов и историю общения.
          </p>
          <button
            type="button"
            onClick={() => setNewPlaybookOpen(true)}
            className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white"
          >
            Создать навык
          </button>
        </section>
      ) : (
        <div className="grid auto-cols-[280px] grid-flow-col gap-3 overflow-x-auto pb-3 xl:auto-cols-[300px]">
          {STAGES.map((stage) => {
            const stageLeads = leads.filter((lead) => lead.stage === stage.id);
            return (
              <section
                key={stage.id}
                className="min-h-[430px] rounded-2xl border border-slate-200 bg-slate-50/80 p-3"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2.5 w-2.5 rounded-full", stage.dot)} />
                    <h2 className="text-sm font-semibold text-slate-800">{stage.label}</h2>
                  </div>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">
                    {stageLeads.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {stageLeads.map((lead) => {
                    const latest = lead.conversations?.[0]?.messages?.[0];
                    return (
                      <article
                        key={lead.id}
                        className="rounded-xl border border-slate-200 bg-white p-3 transition hover:border-violet-300"
                      >
                        <button type="button" className="w-full text-left" onClick={() => void openLead(lead.id)}>
                          <p className="truncate text-sm font-medium text-slate-900">{displayLead(lead)}</p>
                          {lead.company && <p className="mt-0.5 truncate text-xs text-slate-500">{lead.company}</p>}
                          {latest && <p className="mt-2 line-clamp-2 text-xs text-slate-600">{latest.body}</p>}
                          <p className="mt-2 text-[11px] text-slate-400">
                            {formatDate(lead.lastContactAt ?? lead.updatedAt)}
                          </p>
                        </button>
                        <select
                          aria-label={`Стадия карточки ${displayLead(lead)}`}
                          className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600 outline-none focus:border-violet-400"
                          value={lead.stage}
                          onChange={(e) => void changeStage(lead, e.target.value)}
                        >
                          {STAGES.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {newPlaybookOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
          <section className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Новый навык продажи</h2>
              <button type="button" aria-label="Закрыть" onClick={() => setNewPlaybookOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <label className="mt-4 block text-sm text-slate-700">
              Название
              <input
                className={fieldClass}
                value={newPlaybook.name}
                onChange={(e) => setNewPlaybook({ ...newPlaybook, name: e.target.value })}
                placeholder="Например: Внедрение Yani"
              />
            </label>
            <label className="mt-3 block text-sm text-slate-700">
              Что продаём
              <textarea
                className={fieldClass}
                rows={4}
                value={newPlaybook.product}
                onChange={(e) => setNewPlaybook({ ...newPlaybook, product: e.target.value })}
                placeholder="Коротко опишите продукт и ценность"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-xl px-4 py-2 text-sm text-slate-600" onClick={() => setNewPlaybookOpen(false)}>
                Отмена
              </button>
              <button
                type="button"
                disabled={busy || !newPlaybook.name.trim()}
                onClick={() => void createPlaybook()}
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-200"
              >
                Создать
              </button>
            </div>
          </section>
        </div>
      )}

      {newLeadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
          <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Новая карточка</h2>
              <button type="button" aria-label="Закрыть" onClick={() => setNewLeadOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <LeadFields value={leadDraft} onChange={setLeadDraft} />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-xl px-4 py-2 text-sm text-slate-600" onClick={() => setNewLeadOpen(false)}>
                Отмена
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void createLead()}
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-200"
              >
                Создать карточку
              </button>
            </div>
          </section>
        </div>
      )}

      {playbookSetupOpen && activePlaybook && (
        <SalesPlaybookSetup
          playbook={activePlaybook}
          agentId={agentId}
          onClose={() => {
            setPlaybookSetupOpen(false);
            void loadPlaybooks(agentId);
          }}
          onSaved={(updated) => {
            setPlaybooks((items) =>
              items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
            );
          }}
          onNotice={setNotice}
        />
      )}

      {selectedLead && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30">
          <section className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
            <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-slate-900">{displayLead(selectedLead)}</h2>
                <p className="text-xs text-slate-500">{activePlaybook?.name}</p>
              </div>
              <button type="button" className="rounded-lg p-2 hover:bg-slate-100" aria-label="Закрыть карточку" onClick={() => setSelectedLead(null)}>
                <X size={20} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <label className="block text-sm text-slate-700">
                Стадия
                <select
                  className={fieldClass}
                  value={selectedLead.stage}
                  onChange={(e) => setSelectedLead({ ...selectedLead, stage: e.target.value })}
                >
                  {STAGES.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.label}
                    </option>
                  ))}
                </select>
              </label>
              <LeadFields value={selectedLead} onChange={(next) => setSelectedLead({ ...selectedLead, ...next })} />
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveLead()}
                  className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white disabled:bg-slate-200"
                >
                  Сохранить карточку
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveLead({ agentPaused: !selectedLead.agentPaused })}
                  className={cn(
                    "rounded-xl border px-4 py-2.5 text-sm font-medium",
                    selectedLead.agentPaused
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-amber-200 bg-amber-50 text-amber-800",
                  )}
                >
                  {selectedLead.agentPaused ? "Вернуть агенту" : "Взять на себя"}
                </button>
              </div>
              {!!selectedLead.fieldChanges?.length && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-700">Автообновления карточки</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-500">
                    {selectedLead.fieldChanges.slice(0, 8).map((change) => (
                      <li key={change.id}>
                        {change.field}: {change.oldValue || "—"} → {change.newValue}
                        {" · "}
                        {Math.round(change.confidence * 100)}%
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-6 rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
                <div className="flex items-center gap-2">
                  <Sparkles size={17} className="text-violet-600" />
                  <h3 className="font-medium text-slate-900">Черновик по материалам</h3>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Агент использует только документы выбранного навыка и указывает источники.
                  По этой карточке: {formatUsd(selectedLead.replySpendUsd ?? 0)} · {selectedLead.replyCount ?? 0} ответов.
                </p>
                <textarea
                  className={cn(fieldClass, "min-h-24")}
                  value={draftPrompt}
                  onChange={(event) => setDraftPrompt(event.target.value)}
                  placeholder="Вставьте вопрос клиента или уточните задачу для коммерческого предложения"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || !draftPrompt.trim()}
                    onClick={() => void generateDraft("ANSWER")}
                    className="rounded-xl bg-violet-600 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-200"
                  >
                    Подготовить ответ
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void generateDraft("PROPOSAL")}
                    className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-violet-700 disabled:text-slate-300"
                  >
                    Создать черновик КП
                  </button>
                </div>
                {lastDraftCost && <p className="mt-2 text-xs text-slate-600">{lastDraftCost}</p>}
              </div>

              <div className="my-6 border-t border-slate-200" />
              <h3 className="font-medium text-slate-900">История общения</h3>
              <div className="mt-3 space-y-3">
                {allMessages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "max-w-[88%] rounded-2xl px-3 py-2.5 text-sm",
                      message.direction === "OUTBOUND"
                        ? "ml-auto bg-violet-600 text-white"
                        : "bg-slate-100 text-slate-800",
                    )}
                  >
                      <p className="whitespace-pre-wrap break-words">{message.body}</p>
                      {parseAttachments(message.attachments).map((attachment) => (
                        <a
                          key={attachment.url}
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            "mt-2 block truncate text-xs underline",
                            message.direction === "OUTBOUND" ? "text-white/90" : "text-violet-700",
                          )}
                        >
                          {attachment.name}
                        </a>
                      ))}
                    <p className={cn("mt-1 text-[10px]", message.direction === "OUTBOUND" ? "text-white/70" : "text-slate-400")}>
                      {message.channel} · {message.status} · {formatDate(message.createdAt)}
                    </p>
                    {message.outbox && !["SENT", "SENDING"].includes(message.outbox.status) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button type="button" disabled={busy} onClick={() => void updateOutbox(message, "EDIT")} className="rounded-lg bg-white/15 px-2 py-1 text-[11px] text-white hover:bg-white/25">
                          Изменить
                        </button>
                        <button type="button" disabled={busy} onClick={() => void updateOutbox(message, "APPROVE")} className="rounded-lg bg-emerald-400 px-2 py-1 text-[11px] font-medium text-emerald-950">
                          Подтвердить
                        </button>
                        <button type="button" disabled={busy} onClick={() => void updateOutbox(message, "REJECT")} className="rounded-lg bg-white/15 px-2 py-1 text-[11px] text-white hover:bg-white/25">
                          Отклонить
                        </button>
                        {message.outbox.error && <p className="w-full text-[10px] text-rose-100">{message.outbox.error}</p>}
                      </div>
                    )}
                  </div>
                ))}
                {!allMessages.length && <p className="text-sm text-slate-500">Сообщений пока нет</p>}
              </div>

              <div className="mt-5 rounded-2xl border border-violet-100 bg-violet-50/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMessageDirection("INBOUND")}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-medium",
                      messageDirection === "INBOUND" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500",
                    )}
                  >
                    Входящее
                  </button>
                  <button
                    type="button"
                    onClick={() => setMessageDirection("OUTBOUND")}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-medium",
                      messageDirection === "OUTBOUND" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500",
                    )}
                  >
                    Исходящий черновик
                  </button>
                  {messageDirection === "OUTBOUND" && (
                    <select
                      aria-label="Канал сообщения"
                      className="ml-auto rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-xs text-slate-600"
                      value={messageChannel}
                      onChange={(event) => setMessageChannel(event.target.value as "MANUAL" | "TELEGRAM" | "EMAIL")}
                    >
                      <option value="MANUAL">Локально</option>
                      <option value="TELEGRAM">Telegram</option>
                      <option value="EMAIL">Email</option>
                    </select>
                  )}
                </div>
                <textarea
                  className={cn(fieldClass, "min-h-24")}
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  placeholder={
                    messageDirection === "INBOUND"
                      ? "Имитировать сообщение клиента"
                      : "Добавить исходящий черновик"
                  }
                />
                {!!draftSources.length && messageDirection === "OUTBOUND" && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {draftSources.map((source) => (
                      <a
                        key={source.id}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] text-violet-700 hover:bg-violet-50"
                      >
                        Источник: {source.fileName}
                      </a>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    {activePlaybook?.status === "STOPPED" && messageDirection === "INBOUND"
                      ? "Сообщение попадёт в ожидание: агент остановлен."
                      : "Локальный тест без отправки во внешний канал."}
                  </p>
                  <button
                    type="button"
                    disabled={busy || !messageBody.trim()}
                    onClick={() => void addMessage()}
                    className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-200"
                  >
                    <Send size={16} />
                    Добавить
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {importOpen && activePlaybook && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Импорт и первые письма</h2>
                <p className="text-sm text-slate-500">CSV/XLSX, превью дублей, очередь email с лимитами</p>
              </div>
              <button type="button" aria-label="Закрыть" onClick={() => setImportOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <SalesCrmImport
              agentId={agentId}
              playbookId={activePlaybook.id}
              busy={busy}
              setBusy={setBusy}
              onNotice={setNotice}
              onImported={() => {
                void loadLeads();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function LeadFields<T extends typeof emptyLead>({
  value,
  onChange,
}: {
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <label className="text-sm text-slate-700">
        <span className="flex items-center gap-1.5"><UserRound size={14} /> Имя</span>
        <input className={fieldClass} value={value.displayName} onChange={(e) => onChange({ ...value, displayName: e.target.value })} />
      </label>
      <label className="text-sm text-slate-700">
        <span className="flex items-center gap-1.5"><Building2 size={14} /> Компания</span>
        <input className={fieldClass} value={value.company} onChange={(e) => onChange({ ...value, company: e.target.value })} />
      </label>
      <label className="text-sm text-slate-700">
        <span className="flex items-center gap-1.5"><Mail size={14} /> Email</span>
        <input type="email" className={fieldClass} value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} />
      </label>
      <label className="text-sm text-slate-700">
        <span className="flex items-center gap-1.5"><Phone size={14} /> Телефон</span>
        <input type="tel" className={fieldClass} value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
      </label>
      <label className="text-sm text-slate-700 md:col-span-2">
        <span className="flex items-center gap-1.5"><MessageCircle size={14} /> Telegram</span>
        <input className={fieldClass} value={value.telegram} onChange={(e) => onChange({ ...value, telegram: e.target.value })} placeholder="@username" />
      </label>
      <label className="text-sm text-slate-700 md:col-span-2">
        Заметки
        <textarea rows={3} className={fieldClass} value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
      </label>
      <label className="text-sm text-slate-700 md:col-span-2">
        Отдельная инструкция агенту
        <textarea
          rows={4}
          className={fieldClass}
          value={value.agentInstruction}
          onChange={(e) => onChange({ ...value, agentInstruction: e.target.value })}
          placeholder="Например: начни с предложения аудита и уточни количество менеджеров"
        />
      </label>
    </div>
  );
}
