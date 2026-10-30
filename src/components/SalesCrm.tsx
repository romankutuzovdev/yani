"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Eraser,
  Mail,
  MessageCircle,
  Pause,
  Phone,
  Play,
  Plus,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatUsd } from "@/lib/money";
import { fileDownloadUrl } from "@/lib/downloadUrl";
import { SalesPlaybookSetup } from "@/components/SalesPlaybookSetup";
import { SalesCrmImport } from "@/components/SalesCrmImport";
import { SalesCrmContacts } from "@/components/SalesCrmContacts";

type Agent = { id: string; name: string; isPrimary?: boolean };
type Playbook = {
  id: string;
  name: string;
  product: string;
  systemPrompt?: string;
  goals?: string;
  communicationStyle?: string;
  restrictions?: string;
  qualificationQuestions?: string;
  status: "RUNNING" | "STOPPED";
  sendMode: string;
  channelTelegramEnabled?: boolean;
  channelEmailEnabled?: boolean;
  replyCount?: number;
  replySpendUsd?: number;
  telegramSendIntervalSeconds?: number;
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
    nextAttemptAt?: string | null;
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
  notes?: string;
  agentInstruction?: string;
  agentPaused?: boolean;
  urgentAt?: string | null;
  urgentNote?: string;
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
  if (channel === "INSTAGRAM") return "Instagram";
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

function dialogFingerprint(lead: {
  stage: string;
  replyCount?: number;
  replySpendUsd?: number;
  urgentAt?: string | null;
  agentPaused?: boolean;
  conversations?: Conversation[];
  fieldChanges?: Array<{ id: string }>;
}) {
  const parts: string[] = [
    lead.stage,
    String(lead.replyCount ?? 0),
    String(lead.replySpendUsd ?? 0),
    lead.urgentAt ?? "",
    String(Boolean(lead.agentPaused)),
  ];
  for (const change of lead.fieldChanges ?? []) parts.push(change.id);
  for (const conversation of lead.conversations ?? []) {
    parts.push(conversation.id, conversation.channel);
    for (const message of conversation.messages) {
      parts.push(
        message.id,
        message.status,
        message.outbox?.status ?? "",
        String(message.outbox?.attempts ?? 0),
      );
    }
  }
  return parts.join("|");
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

function formatMessageStatus(message: Message) {
  const outbox = message.outbox?.status;
  if (outbox === "APPROVED") return message.outbox?.error ? "ошибка отправки" : "к отправке";
  if (outbox === "SENDING") return "отправляется";
  if (outbox === "SENT") return "отправлено";
  if (outbox === "FAILED" || outbox === "DEAD") return "ошибка";
  if (outbox === "REJECTED") return "отклонено";
  if (message.direction === "INBOUND") return "от клиента";
  if (message.status === "DRAFT" || outbox === "DRAFT") return "сообщение";
  if (message.status === "APPROVED") return "к отправке";
  if (message.status === "SENT") return "отправлено";
  return "сообщение";
}

function clipText(value: string, max = 140) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function SalesCrm() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [playbookId, setPlaybookId] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [boardStats, setBoardStats] = useState({ leadTotal: 0, pendingQueue: 0, shown: 0 });
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadDraft, setLeadDraft] = useState(emptyLead);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [newPlaybookOpen, setNewPlaybookOpen] = useState(false);
  const [playbookSetupOpen, setPlaybookSetupOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [newPlaybook, setNewPlaybook] = useState({ name: "", product: "" });
  const [messageBody, setMessageBody] = useState("");
  const [messageChannel, setMessageChannel] = useState<"MANUAL" | "TELEGRAM" | "EMAIL" | "INSTAGRAM">("MANUAL");
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
  const [salesQuota, setSalesQuota] = useState<{
    enabled: boolean;
    playbookLimit: number;
    playbookUsed: number;
    planName: string;
  } | null>(null);
  const [setupPlaybook, setSetupPlaybook] = useState<Playbook | null>(null);

  const activePlaybook = useMemo(
    () => playbooks.find((item) => item.id === playbookId) ?? null,
    [playbooks, playbookId],
  );
  const playbookAtLimit = Boolean(
    salesQuota &&
      salesQuota.playbookLimit > 0 &&
      playbooks.length >= salesQuota.playbookLimit,
  );

  const agentQuery = agentId ? `agentId=${encodeURIComponent(agentId)}` : "";
  const appendAgent = useCallback(
    (url: string) => `${url}${url.includes("?") ? "&" : "?"}${agentQuery}`,
    [agentQuery],
  );

  const applySalesQuota = useCallback((sales: unknown, playbookCount: number) => {
    const row = sales as
      | {
          enabled: boolean;
          playbookLimit: number;
          playbookUsed: number;
          planName: string;
        }
      | null
      | undefined;
    setSalesQuota(
      row
        ? {
            enabled: row.enabled,
            playbookLimit: row.playbookLimit ?? 0,
            playbookUsed: row.playbookUsed ?? playbookCount,
            planName: row.planName ?? "",
          }
        : null,
    );
  }, []);

  const bootstrap = useCallback(
    async (opts?: { agentId?: string; playbookId?: string }) => {
      setLoading(true);
      setNotice("");
      try {
        const query = new URLSearchParams();
        if (opts?.agentId) query.set("agentId", opts.agentId);
        if (opts?.playbookId) query.set("playbookId", opts.playbookId);
        const res = await fetch(`/api/crm/bootstrap?${query.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setNotice(data.error ?? "Не удалось загрузить CRM");
          return;
        }
        const rows = (data.agents ?? []) as Agent[];
        const books = (data.playbooks ?? []) as Playbook[];
        setAgents(rows);
        setAgentId(data.agentId || rows[0]?.id || "");
        setPlaybooks(books);
        setPlaybookId(data.playbookId || books[0]?.id || "");
        setLeads(data.leads ?? []);
        setBoardStats({
          leadTotal: data.board?.leadTotal ?? (data.leads ?? []).length,
          pendingQueue: data.board?.pendingQueue ?? 0,
          shown: data.board?.shown ?? (data.leads ?? []).length,
        });
        applySalesQuota(data.sales, books.length);
      } catch {
        setNotice("Сервер CRM недоступен. Обновите страницу.");
      } finally {
        setLoading(false);
      }
    },
    [applySalesQuota],
  );

  const loadPlaybooks = useCallback(
    async (nextAgentId: string) => {
      await bootstrap({ agentId: nextAgentId });
    },
    [bootstrap],
  );

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
    void bootstrap();
    // Mount-only boot; agent/playbook switches call bootstrap/loadLeads explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function selectAgent(nextAgentId: string) {
    if (nextAgentId === agentId) return;
    setSelectedLead(null);
    await bootstrap({ agentId: nextAgentId });
  }

  async function selectPlaybook(nextPlaybookId: string) {
    if (nextPlaybookId === playbookId) return;
    setPlaybookId(nextPlaybookId);
    setSelectedLead(null);
    setLeadDraft(emptyLead);
    setNewLeadOpen(false);
    setImportOpen(false);
    setPlaybookSetupOpen(false);
    setSetupPlaybook(null);
    setMessageBody("");
    setDraftPrompt("");
    setDraftSources([]);
    setLastDraftCost("");
    setNotice("");
    try {
      const res = await fetch(
        appendAgent(`/api/crm/leads?playbookId=${encodeURIComponent(nextPlaybookId)}`),
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
  }

  async function openPlaybookSetup() {
    if (!activePlaybook) return;
    setBusy(true);
    try {
      const res = await fetch(appendAgent(`/api/crm/playbooks/${activePlaybook.id}`));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data.error ?? "Не удалось открыть настройки навыка");
        return;
      }
      const full = data.playbook as Playbook;
      setSetupPlaybook(full);
      setPlaybooks((items) => items.map((item) => (item.id === full.id ? { ...item, ...full } : item)));
      setPlaybookSetupOpen(true);
    } catch {
      setNotice("Сервер CRM недоступен. Обновите страницу.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (messageChannel === "TELEGRAM" && activePlaybook?.channelTelegramEnabled === false) {
      setMessageChannel("MANUAL");
    }
    if (messageChannel === "EMAIL" && activePlaybook?.channelEmailEnabled === false) {
      setMessageChannel("MANUAL");
    }
  }, [activePlaybook?.channelTelegramEnabled, activePlaybook?.channelEmailEnabled, messageChannel]);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    let lastFingerprint = "";
    async function loadHealth() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        const query = new URLSearchParams({ agentId, light: "1" });
        if (playbookId) query.set("playbookId", playbookId);
        const res = await fetch(`/api/crm/health?${query.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        const nextHealth = data.health ?? null;
        const nextQueues = data.playbookQueues ?? null;
        const fingerprint = JSON.stringify({
          status: nextHealth?.status,
          redis: nextHealth?.redis?.status,
          queues: nextQueues,
        });
        if (fingerprint === lastFingerprint) return;
        lastFingerprint = fingerprint;
        setHealth(nextHealth);
        setPlaybookQueues(nextQueues);
      } catch {
        if (!cancelled) {
          setHealth(null);
          setPlaybookQueues(null);
          lastFingerprint = "";
        }
      }
    }
    // Health is secondary — don't compete with playbooks/leads on first paint.
    const start = window.setTimeout(() => {
      void loadHealth();
    }, 800);
    const timer = setInterval(() => void loadHealth(), 45_000);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
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
    await bootstrap({ agentId, playbookId: data.playbook.id });
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
    let cancelled = false;
    let inFlight = false;
    let lastFingerprint = dialogFingerprint(selectedLead);

    async function refreshLead() {
      if (cancelled || inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const res = await fetch(appendAgent(`/api/crm/leads/${leadId}`)).catch(() => null);
        if (!res?.ok || cancelled) return;
        const data = await res.json().catch(() => null);
        if (!data?.lead || cancelled) return;
        const next = data.lead as Lead;
        const fingerprint = dialogFingerprint(next);
        if (fingerprint === lastFingerprint) return;
        lastFingerprint = fingerprint;
        setSelectedLead((current) =>
          current?.id === leadId
            ? {
                ...current,
                ...next,
                conversations: next.conversations,
              }
            : current,
        );
        // Keep board card preview in sync without full leads refetch.
        setLeads((items) =>
          items.map((item) =>
            item.id === leadId
              ? {
                  ...item,
                  stage: next.stage,
                  replyCount: next.replyCount,
                  replySpendUsd: next.replySpendUsd,
                  urgentAt: next.urgentAt,
                  urgentNote: next.urgentNote,
                  agentPaused: next.agentPaused,
                  lastContactAt: next.lastContactAt,
                  conversations: next.conversations?.map((conversation) => ({
                    id: conversation.id,
                    channel: conversation.channel,
                    messages: conversation.messages.slice(-1),
                  })),
                }
              : item,
          ),
        );
      } finally {
        inFlight = false;
      }
    }

    const timer = window.setInterval(() => void refreshLead(), 12_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshLead();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // Intentionally only rebind when the open lead id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendAgent, selectedLead?.id]);

  async function saveLead(patch?: Partial<Lead> & { agentPaused?: boolean; clearUrgent?: boolean }) {
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
        channel: messageChannel,
        direction: "OUTBOUND",
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
    await openLead(selectedLead.id);
  }

  async function clearDialog() {
    if (!selectedLead) return;
    const ok = window.confirm(
      "Очистить историю диалога по этой карточке? Сообщения и очередь отправки удалятся, карточка останется.",
    );
    if (!ok) return;
    setBusy(true);
    const res = await fetch(
      appendAgent(`/api/crm/leads/${selectedLead.id}/conversations`),
      { method: "DELETE" },
    );
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setNotice(data.error ?? "Не удалось очистить диалог");
      return;
    }
    setNotice("Диалог очищен");
    setDraftSources([]);
    setLastDraftCost("");
    await openLead(selectedLead.id);
    setLeads((items) =>
      items.map((item) =>
        item.id === selectedLead.id ? { ...item, conversations: [] } : item,
      ),
    );
  }

  async function deleteLeadCard() {
    if (!selectedLead) return;
    const ok = window.confirm(
      `Удалить карточку «${displayLead(selectedLead)}» вместе с диалогом?`,
    );
    if (!ok) return;
    setBusy(true);
    const res = await fetch(appendAgent(`/api/crm/leads/${selectedLead.id}`), {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setNotice(data.error ?? "Не удалось удалить карточку");
      return;
    }
    setSelectedLead(null);
    setNotice("Карточка удалена");
    await loadLeads();
  }

  async function updateOutbox(message: Message, action: "APPROVE" | "REJECT" | "EDIT") {
    let body: string | undefined;
    if (action === "EDIT") {
      const next = window.prompt("Измените текст сообщения", message.body);
      if (next === null) return;
      body = next.trim();
      if (!body) return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/crm/messages/${message.id}/outbox`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, action, body }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(data.error ?? "Не удалось изменить сообщение");
        return;
      }
      setNotice(
        action === "APPROVE"
          ? "Сообщение в очереди на отправку"
          : action === "REJECT"
            ? "Сообщение отклонено"
            : "Текст обновлён",
      );
      if (selectedLead) await openLead(selectedLead.id);
      void loadHealth();
    } catch {
      setNotice("Сервер CRM недоступен. Обновите страницу.");
    } finally {
      setBusy(false);
    }
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
      setNotice(data.error ?? "Не удалось подготовить сообщение");
      return;
    }
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

  const historyRef = useRef<HTMLDivElement>(null);

  const allMessages = useMemo(
    () =>
      (selectedLead?.conversations ?? [])
        .flatMap((conversation) =>
          conversation.messages.map((message) => ({
            ...message,
            channel: conversation.channel,
            parsedAttachments: parseAttachments(message.attachments),
          })),
        )
        .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
    [selectedLead?.conversations],
  );

  useEffect(() => {
    const node = historyRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [selectedLead?.id, allMessages.length, allMessages.at(-1)?.id, allMessages.at(-1)?.body]);

  const leadsByStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const stage of STAGES) map.set(stage.id, []);
    for (const lead of leads) {
      const bucket = map.get(lead.stage) ?? map.get(STAGES[0].id)!;
      bucket.push(lead);
    }
    for (const [, bucket] of map) {
      bucket.sort((a, b) => Number(Boolean(b.urgentAt)) - Number(Boolean(a.urgentAt)));
    }
    return map;
  }, [leads]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">CRM продаж</h1>
          <p className="mt-1 text-slate-500">
            Клиенты, диалоги и управление ИИ-агентом в одном месте
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!activePlaybook}
            onClick={() => void openPlaybookSetup()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:border-slate-200 disabled:text-slate-300"
          >
            <Settings size={17} aria-hidden />
            Настроить
          </button>
          <button
            type="button"
            disabled={!activePlaybook}
            onClick={() => setContactsOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:border-slate-200 disabled:text-slate-300"
          >
            <Users size={17} aria-hidden />
            Контакты
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

      <section className="space-y-5">
        {agents.length > 1 && (
          <div>
            <h2 className="text-sm font-medium text-slate-500">Агент</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {agents.map((agent) => {
                const active = agent.id === agentId;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => void selectAgent(agent.id)}
                    className={cn(
                      "rounded-2xl border bg-white p-4 text-left shadow-sm transition",
                      active
                        ? "border-violet-400 ring-2 ring-violet-200"
                        : "border-violet-100 hover:border-violet-200 hover:bg-violet-50/40",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-sm font-semibold text-violet-700">
                        {agent.name.slice(0, 1)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-lg font-medium text-slate-900">{agent.name}</p>
                        {agent.isPrimary ? (
                          <span className="text-[11px] font-medium text-violet-700">Главный</span>
                        ) : (
                          <span className="text-[11px] text-slate-400">Агент</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Навыки продажи</h2>
              <p className="mt-1 text-sm text-slate-500">
                Выберите навык — клиенты, каналы и материалы переключатся вместе с ним
              </p>
            </div>
            {agents.length === 1 && (
              <p className="text-sm text-slate-500">
                Агент: <span className="font-medium text-slate-800">{agents[0]?.name}</span>
              </p>
            )}
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {playbooks.map((playbook) => {
              const active = playbook.id === playbookId;
              const running = playbook.status === "RUNNING";
              return (
                <button
                  key={playbook.id}
                  type="button"
                  onClick={() => void selectPlaybook(playbook.id)}
                  className={cn(
                    "rounded-2xl border bg-white p-5 text-left shadow-sm transition",
                    active
                      ? "border-violet-400 ring-2 ring-violet-200"
                      : "border-violet-100 hover:border-violet-200 hover:bg-violet-50/30",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold",
                          active ? "bg-violet-600 text-white" : "bg-violet-100 text-violet-700",
                        )}
                      >
                        {playbook.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-xl font-medium text-slate-900">{playbook.name}</h3>
                        <p className="mt-0.5 line-clamp-1 text-sm text-slate-500">
                          {playbook.product || "Без описания продукта"}
                        </p>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        running ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
                      )}
                    >
                      {running ? "Запущен" : "Остановлен"}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span>{playbook._count?.leads ?? 0} карточек</span>
                    <span>{playbook._count?.documents ?? 0} материалов</span>
                    <span>{formatUsd(playbook.replySpendUsd ?? 0)}</span>
                  </div>
                  {active && (
                    <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-violet-600">
                      Выбран
                    </p>
                  )}
                </button>
              );
            })}

            <button
              type="button"
              disabled={playbookAtLimit}
              title={
                playbookAtLimit
                  ? `Лимит навыков продаж: ${salesQuota?.playbookLimit}`
                  : undefined
              }
              onClick={() => setNewPlaybookOpen(true)}
              className="flex min-h-[148px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-violet-300 bg-violet-50/40 p-5 text-violet-700 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm">
                <Plus size={20} />
              </span>
              <span className="text-sm font-medium">
                {playbookAtLimit ? "Лимит навыков" : "Новый навык продажи"}
              </span>
            </button>
          </div>
        </div>

        {activePlaybook && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-violet-100 bg-white px-4 py-3 shadow-sm">
            <button
              type="button"
              disabled={busy}
              onClick={() => void togglePlaybook()}
              className={cn(
                "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium",
                activePlaybook.status === "RUNNING"
                  ? "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                  : "bg-emerald-600 text-white hover:bg-emerald-500",
              )}
            >
              {activePlaybook.status === "RUNNING" ? <Pause size={16} /> : <Play size={16} />}
              {activePlaybook.status === "RUNNING" ? "Остановить агента" : "Запустить агента"}
            </button>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              Режим
              <select
                className="rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                value={activePlaybook.sendMode}
                onChange={(e) => void changeSendMode(e.target.value)}
              >
                <option value="APPROVAL_REQUIRED">С подтверждением</option>
                <option value="DRAFT_ONLY">Только сообщения</option>
                <option value="AUTO">Автоотправка</option>
              </select>
            </label>
            <span className="text-xs text-slate-500">
              {activePlaybook._count?.documents ?? 0} материалов · расход{" "}
              {formatUsd(activePlaybook.replySpendUsd ?? 0)}
            </span>
          </div>
        )}
      </section>

      {notice && (
        <div className="fixed bottom-6 left-1/2 z-[80] flex w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg">
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
          <span>Сообщения: {playbookQueues?.draft ?? health.queues.outboxDraft}</span>
          <span>К отправке: {playbookQueues?.approved ?? health.queues.outboxApproved}</span>
          <span>Ожидают агента: {playbookQueues?.waiting ?? health.queues.inboundWaiting}</span>
          <span>Кампания: {playbookQueues?.pendingCampaign ?? health.queues.campaignPending}</span>
          <span>Dead-letter: {playbookQueues?.dead ?? health.queues.deadLettersOpen}</span>
          {salesQuota?.enabled ? (
            <span>
              Навыки продаж: {playbooks.length}
              {salesQuota.playbookLimit > 0 ? ` / ${salesQuota.playbookLimit}` : " (без лимита)"}
              {salesQuota.planName ? ` · ${salesQuota.planName}` : ""}
            </span>
          ) : null}
        </div>
      )}

      {!activePlaybook && !loading ? (
        <section className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/40 px-6 py-12 text-center">
          <h2 className="font-medium text-slate-900">Создайте первый навык продажи</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
            Отдельный навык хранит свой продукт, клиентов и историю общения.
          </p>
          <button
            type="button"
            disabled={playbookAtLimit}
            onClick={() => setNewPlaybookOpen(true)}
            className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white disabled:bg-slate-300"
          >
            {playbookAtLimit ? "Лимит навыков исчерпан" : "Создать навык"}
          </button>
        </section>
      ) : (
        <>
        {boardStats.leadTotal > boardStats.shown && (
          <p className="mb-3 text-sm text-slate-600">
            На доске {boardStats.shown} карточек из {boardStats.leadTotal}. В очереди первых сообщений:{" "}
            {boardStats.pendingQueue}. Остальные контакты в очереди, на доску они не выводятся.
          </p>
        )}
        <div className="grid auto-cols-[280px] grid-flow-col gap-3 overflow-x-auto pb-3 xl:auto-cols-[300px]">
          {STAGES.map((stage) => {
            const stageLeads = leadsByStage.get(stage.id) ?? [];
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
                        className={cn(
                          "rounded-xl border bg-white p-3 transition hover:border-violet-300",
                          lead.urgentAt
                            ? "border-rose-300 ring-1 ring-rose-100"
                            : lead.agentPaused
                              ? "border-amber-300 ring-1 ring-amber-100"
                              : "border-slate-200",
                        )}
                      >
                        <button type="button" className="w-full text-left" onClick={() => void openLead(lead.id)}>
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-sm font-medium text-slate-900">{displayLead(lead)}</p>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              {lead.urgentAt && (
                                <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-800">
                                  Срочно
                                </span>
                              )}
                              {lead.agentPaused && (
                                <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                                  Ручная
                                </span>
                              )}
                            </div>
                          </div>
                          {lead.urgentAt && lead.urgentNote ? (
                            <p className="mt-1 line-clamp-2 text-[11px] text-rose-700">{lead.urgentNote}</p>
                          ) : null}
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
        </>
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

      {playbookSetupOpen && setupPlaybook && (
        <SalesPlaybookSetup
          key={setupPlaybook.id}
          playbook={{
            id: setupPlaybook.id,
            name: setupPlaybook.name,
            product: setupPlaybook.product || "",
            systemPrompt: setupPlaybook.systemPrompt || "",
            goals: setupPlaybook.goals || "",
            communicationStyle: setupPlaybook.communicationStyle || "",
            restrictions: setupPlaybook.restrictions || "",
            qualificationQuestions: setupPlaybook.qualificationQuestions || "",
            sendMode: setupPlaybook.sendMode,
            channelTelegramEnabled: setupPlaybook.channelTelegramEnabled,
            channelEmailEnabled: setupPlaybook.channelEmailEnabled,
            telegramSendIntervalSeconds: setupPlaybook.telegramSendIntervalSeconds,
          }}
          agentId={agentId}
          onClose={() => {
            setPlaybookSetupOpen(false);
            setSetupPlaybook(null);
            void bootstrap({ agentId, playbookId });
          }}
          onSaved={(updated) => {
            setSetupPlaybook((prev) => (prev ? { ...prev, ...updated } : null));
            setPlaybooks((items) =>
              items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
            );
          }}
          onDeleted={() => {
            const removedId = setupPlaybook.id;
            setPlaybookSetupOpen(false);
            setSetupPlaybook(null);
            void bootstrap({ agentId });
            setPlaybooks((items) => items.filter((item) => item.id !== removedId));
          }}
          onNotice={setNotice}
        />
      )}

      {selectedLead && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30">
          <section className="flex h-dvh max-h-dvh w-full max-w-3xl flex-col overflow-hidden bg-white shadow-xl">
            <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-semibold text-slate-900">{displayLead(selectedLead)}</h2>
                  {selectedLead.urgentAt && (
                    <span className="shrink-0 rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-rose-800">
                      Срочно
                    </span>
                  )}
                  {selectedLead.agentPaused && (
                    <span className="shrink-0 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                      Ручная
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-slate-500">
                  {activePlaybook?.name}
                  {selectedLead.agentPaused ? " · агент на паузе, отвечает менеджер" : ""}
                  {selectedLead.urgentAt && selectedLead.urgentNote
                    ? ` · ${selectedLead.urgentNote}`
                    : selectedLead.urgentAt
                      ? " · клиент ждёт звонка/ответа"
                      : ""}
                </p>
              </div>
              <button type="button" className="rounded-lg p-2 hover:bg-slate-100" aria-label="Закрыть карточку" onClick={() => setSelectedLead(null)}>
                <X size={20} />
              </button>
            </header>
            <div className="max-h-[42%] shrink-0 overflow-y-auto overscroll-contain p-5">
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
                {selectedLead.urgentAt && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveLead({ clearUrgent: true })}
                    className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-800"
                  >
                    Снять «Срочно»
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy || allMessages.length === 0}
                  onClick={() => void clearDialog()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Eraser size={15} />
                  Очистить диалог
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void deleteLeadCard()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                >
                  <Trash2 size={15} />
                  Удалить карточку
                </button>
              </div>
              {!!selectedLead.fieldChanges?.length && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-700">Автообновления карточки</p>
                  <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto overscroll-contain text-xs text-slate-500">
                    {selectedLead.fieldChanges.slice(0, 12).map((change) => (
                      <li key={change.id} className="rounded-lg bg-white/70 px-2 py-1.5">
                        <span className="font-medium text-slate-600">{change.field}</span>
                        {" · "}
                        {Math.round(change.confidence * 100)}%
                        <p className="mt-0.5 line-clamp-3 break-words text-slate-500">
                          {clipText(change.oldValue || "—", 120)} → {clipText(change.newValue, 160)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-6 rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
                <div className="flex items-center gap-2">
                  <Sparkles size={17} className="text-violet-600" />
                  <h3 className="font-medium text-slate-900">Сообщение по материалам</h3>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Агент опирается на документы навыка. Обычный диалог — живой; про услуги — из документов.
                  По этой карточке: {formatUsd(selectedLead.replySpendUsd ?? 0)} · {selectedLead.replyCount ?? 0} ответов.
                </p>
                <textarea
                  className={cn(fieldClass, "min-h-24 max-h-40 overflow-y-auto")}
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
                    Подготовить КП
                  </button>
                </div>
                {lastDraftCost && <p className="mt-2 text-xs text-slate-600">{lastDraftCost}</p>}
              </div>

            </div>
            <div className="flex min-h-0 flex-1 flex-col border-t border-slate-200 px-5 pb-2 pt-3">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium text-slate-900">История общения</h3>
                <button
                  type="button"
                  disabled={busy || allMessages.length === 0}
                  onClick={() => void clearDialog()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  <Eraser size={13} />
                  Очистить
                </button>
              </div>
              <div
                ref={historyRef}
                className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain rounded-xl border border-slate-100 bg-slate-50/40 p-3"
              >
                {allMessages.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-400">
                    Диалог пуст
                  </p>
                ) : null}
                {allMessages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "max-w-[88%] rounded-2xl px-3 py-2.5 text-sm",
                      message.direction === "OUTBOUND"
                        ? "ml-auto bg-violet-600 text-white"
                        : "bg-white text-slate-800 shadow-sm",
                    )}
                  >
                      <p className="whitespace-pre-wrap break-words">
                        {message.body}
                      </p>
                      {message.parsedAttachments.map((attachment) => (
                        <a
                          key={attachment.url}
                          href={fileDownloadUrl(attachment.url, attachment.name)}
                          download={attachment.name}
                          className={cn(
                            "mt-2 block truncate text-xs underline",
                            message.direction === "OUTBOUND" ? "text-white/90" : "text-violet-700",
                          )}
                        >
                          {attachment.name}
                        </a>
                      ))}
                    <p className={cn("mt-1 text-[10px]", message.direction === "OUTBOUND" ? "text-white/70" : "text-slate-400")}>
                      {message.channel} · {formatMessageStatus(message)} · {formatDate(message.createdAt)}
                    </p>
                    {message.outbox && !["SENT", "SENDING", "REJECTED"].includes(message.outbox.status) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button type="button" disabled={busy} onClick={() => void updateOutbox(message, "EDIT")} className="rounded-lg bg-white/15 px-2 py-1 text-[11px] text-white hover:bg-white/25">
                          Изменить
                        </button>
                        {(message.outbox.status === "DRAFT" ||
                          message.outbox.status === "FAILED" ||
                          message.outbox.status === "DEAD" ||
                          Boolean(message.outbox.error)) && (
                          <button type="button" disabled={busy} onClick={() => void updateOutbox(message, "APPROVE")} className="rounded-lg bg-emerald-400 px-2 py-1 text-[11px] font-medium text-emerald-950">
                            {message.outbox.status === "DRAFT" ? "Подтвердить" : "Отправить снова"}
                          </button>
                        )}
                        {message.outbox.status === "APPROVED" && !message.outbox.error && (
                          <span className="rounded-lg bg-white/15 px-2 py-1 text-[11px] text-white/80">
                            В очереди на отправку
                          </span>
                        )}
                        {message.outbox.status !== "DEAD" && (
                          <button type="button" disabled={busy} onClick={() => void updateOutbox(message, "REJECT")} className="rounded-lg bg-white/15 px-2 py-1 text-[11px] text-white hover:bg-white/25">
                            Отклонить
                          </button>
                        )}
                        {message.outbox.error && (
                          <p className="w-full text-[10px] text-rose-100">{message.outbox.error}</p>
                        )}
                        {message.outbox.nextAttemptAt &&
                          new Date(message.outbox.nextAttemptAt).getTime() > Date.now() && (
                            <p className="w-full text-[10px] text-white/80">
                              Повтор: {formatDate(message.outbox.nextAttemptAt)}
                            </p>
                          )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="shrink-0 border-t border-violet-100 bg-violet-50/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium text-slate-600">Сообщение</p>
                <select
                  aria-label="Канал сообщения"
                  className="ml-auto rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-xs text-slate-600"
                  value={messageChannel}
                  onChange={(event) =>
                    setMessageChannel(event.target.value as "MANUAL" | "TELEGRAM" | "EMAIL" | "INSTAGRAM")
                  }
                >
                  <option value="MANUAL">Локально</option>
                  {activePlaybook?.channelTelegramEnabled !== false && (
                    <option value="TELEGRAM">Telegram</option>
                  )}
                  {activePlaybook?.channelEmailEnabled !== false && (
                    <option value="EMAIL">Email</option>
                  )}
                  <option value="INSTAGRAM">Instagram</option>
                </select>
              </div>
              <textarea
                className={cn(fieldClass, "min-h-20 max-h-28 overflow-y-auto")}
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                placeholder="Текст сообщения в диалог"
              />
              {!!draftSources.length && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {draftSources.map((source) => (
                    <a
                      key={source.id}
                      href={fileDownloadUrl(source.url, source.fileName)}
                      download={source.fileName}
                      className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] text-violet-700 hover:bg-violet-50"
                    >
                      Скачать: {source.fileName}
                    </a>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  {messageChannel === "MANUAL"
                    ? "Локально в карточке, без отправки во внешний канал."
                    : "Попадёт в очередь на отправку в выбранный канал."}
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
          </section>
        </div>
      )}

      {contactsOpen && activePlaybook && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Контакты</h2>
                <p className="text-sm text-slate-500">
                  Списки Email и Telegram: создание, правка, удаление одного или нескольких
                </p>
              </div>
              <button type="button" aria-label="Закрыть" onClick={() => setContactsOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <SalesCrmContacts
              agentId={agentId}
              playbookId={activePlaybook.id}
              busy={busy}
              setBusy={setBusy}
              onNotice={setNotice}
            />
          </div>
        </div>
      )}

      {importOpen && activePlaybook && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Импорт и первые письма</h2>
                <p className="text-sm text-slate-500">
                  Выбор списков контактов, отдельные лимиты Email / Telegram
                </p>
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

function LeadFields<
  T extends {
    displayName: string;
    company: string;
    email: string;
    phone: string;
    telegram: string;
    notes?: string;
    agentInstruction?: string;
  },
>({
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
        <textarea
          rows={3}
          className={cn(fieldClass, "max-h-36 overflow-y-auto")}
          value={value.notes ?? ""}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
        />
      </label>
      <label className="text-sm text-slate-700 md:col-span-2">
        Отдельная инструкция агенту
        <textarea
          rows={4}
          className={cn(fieldClass, "max-h-40 overflow-y-auto")}
          value={value.agentInstruction ?? ""}
          onChange={(e) => onChange({ ...value, agentInstruction: e.target.value })}
          placeholder="Например: начни с предложения аудита и уточни количество менеджеров"
        />
      </label>
    </div>
  );
}
