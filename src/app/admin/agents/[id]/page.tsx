"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { AgentChatLink } from "@/components/AgentChatLink";
import { AgentDocs } from "@/components/AgentDocs";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { hideOpenButtonToken, splitReplyButtons } from "@/lib/replyButtons";
import { CharacterStage } from "@/components/CharacterStage";
import { ModelSelect } from "@/components/ModelSelect";
import { bindHeroVideo } from "@/lib/useKeepVideoPlaying";
import { PagedRows } from "@/components/PagedRows";
import { copyText } from "@/lib/copyText";
import { CHAT_UNAVAILABLE, toChatUserMessage } from "@/lib/chatUserError";
import {
  ALL_CHARACTER_STATES,
  STATE_LABELS,
  normalizeAssetUrl,
} from "@/characters/CharacterRenderer";
import type { CharacterState } from "@prisma/client";

type Asset = {
  state: string;
  type: string;
  url: string;
  mimeType: string;
};

type SkillItem = {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  enabled?: boolean;
};

type AgentSkillRow = {
  skillId: string;
  enabled: boolean;
  visible: boolean;
  sortOrder: number;
  skill: SkillItem;
};

type AgentDetail = {
  id: string;
  name: string;
  slug: string;
  description: string;
  logoUrl: string;
  homeIconUrl: string;
  greeting: string;
  asideText: string;
  personality: string;
  role: string;
  communicationStyle: string;
  rules: string;
  goals: string;
  restrictions: string;
  additionalInstructions: string;
  systemPrompt: string;
  model: string;
  dailyRequestLimit: number;
  monthlyRequestLimit: number;
  requestsToday?: number;
  requestsMonth?: number;
  orgEmail?: string;
  orgName?: string;
  orgUnp?: string;
  planName?: string;
  planMonthlyPrice?: number;
  salesEnabled?: boolean;
  salesPlanName?: string;
  salesPlanMonthlyPrice?: number;
  salesPlaybookLimit?: number;
  salesAgentLimit?: number;
  isPrimary?: boolean;
  webSearchEnabled?: boolean;
  temperature: number;
  maxIterations: number;
  status: string;
  statusMessage: string;
  character: { assets: Asset[] } | null;
  skills: AgentSkillRow[];
  tools: Array<{ tool: { id: string; name: string } }>;
};

const STATES = ALL_CHARACTER_STATES;

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const orgMode = pathname.startsWith("/org");
  const router = useRouter();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLog, setChatLog] = useState<Array<{ role: string; content: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [acting, setActing] = useState(false);
  const [previewState, setPreviewState] = useState<CharacterState | null>(null);
  const [mediaUpload, setMediaUpload] = useState<{ state: string; progress: number } | null>(null);
  const [spentLabel, setSpentLabel] = useState("");
  const [orgEmail, setOrgEmail] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgUnp, setOrgUnp] = useState("");
  const [planName, setPlanName] = useState("");
  const [planPrice, setPlanPrice] = useState("");
  const [salesEnabled, setSalesEnabled] = useState(false);
  const [salesPlanName, setSalesPlanName] = useState("");
  const [salesPlanPrice, setSalesPlanPrice] = useState("");
  const [salesPlaybookLimit, setSalesPlaybookLimit] = useState("");
  const [salesAgentLimit, setSalesAgentLimit] = useState("1");
  const [orgPassword, setOrgPassword] = useState("");
  const [orgBusy, setOrgBusy] = useState(false);
  const [copiedAccess, setCopiedAccess] = useState<"email" | "password" | "both" | "">("");
  const [widgetCfg, setWidgetCfg] = useState({
    position: "bottom-right" as "bottom-right" | "bottom-left",
    size: 68,
    offsetBottom: 2,
    offsetSide: 2,
  });
  const [widgetBusy, setWidgetBusy] = useState(false);

  async function load() {
    const [a, s] = await Promise.all([
      fetch(`/api/agents/${params.id}`).then((r) => r.json()),
      fetch(orgMode ? "/api/org/skills?brief=1" : "/api/skills?brief=1").then((r) => r.json()),
    ]);
    const raw = a.agent as AgentDetail & {
      skills: Array<{
        skillId?: string;
        enabled?: boolean;
        visible?: boolean;
        sortOrder?: number;
        skill: SkillItem;
      }>;
    };
    if (raw) {
      raw.skills = (raw.skills ?? [])
        .map((row, i) => ({
          skillId: row.skillId ?? row.skill.id,
          enabled: row.enabled ?? true,
          visible: row.visible ?? true,
          sortOrder: row.sortOrder ?? i,
          skill: row.skill,
        }))
        .sort((x, y) => x.sortOrder - y.sortOrder);
      raw.logoUrl = raw.logoUrl ?? "";
      raw.homeIconUrl = raw.homeIconUrl ?? "";
      raw.greeting = raw.greeting ?? "";
      raw.asideText = raw.asideText ?? "";
    }
    setAgent(raw);
    setOrgEmail(raw?.orgEmail ?? "");
    void fetch(`/api/agents/${params.id}/widget`)
      .then((r) => r.json())
      .then((data) => {
        const c = data.widget?.config ?? {};
        setWidgetCfg({
          position: c.position === "bottom-left" ? "bottom-left" : "bottom-right",
          size: Math.min(140, Math.max(44, Number(c.size) || 68)),
          offsetBottom: Math.min(40, Math.max(0, Number(c.offsetBottom) ?? 2)),
          offsetSide: Math.min(40, Math.max(0, Number(c.offsetSide) ?? 2)),
        });
      })
      .catch(() => undefined);
    setOrgName(raw?.orgName ?? "");
    setOrgUnp(raw?.orgUnp ?? "");
    setPlanName(raw?.planName ?? "");
    setPlanPrice(raw?.planMonthlyPrice ? String(raw.planMonthlyPrice) : "");
    setSalesEnabled(Boolean(raw?.salesEnabled));
    setSalesPlanName(raw?.salesPlanName ?? "");
    setSalesPlanPrice(raw?.salesPlanMonthlyPrice ? String(raw.salesPlanMonthlyPrice) : "");
    setSalesPlaybookLimit(
      raw?.salesPlaybookLimit != null && raw.salesPlaybookLimit > 0
        ? String(raw.salesPlaybookLimit)
        : "",
    );
    setSalesAgentLimit(raw?.salesAgentLimit != null ? String(raw.salesAgentLimit || 1) : "1");
    setSkills(s.skills ?? []);
    if (orgMode) {
      setSpentLabel("");
    } else {
      try {
        const usage = await fetch(`/api/llm/usage?agentId=${params.id}`).then((r) => r.json());
        const row = (usage.byAgent ?? []).find((a: { agentId: string }) => a.agentId === params.id);
        setSpentLabel(row?.costLabel ?? "$0");
      } catch {
        setSpentLabel("");
      }
    }
  }

  useEffect(() => {
    void load();
    const es = new EventSource(`/api/agents/${params.id}/status/stream`);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setAgent((prev) =>
          prev
            ? {
                ...prev,
                status: data.status,
                statusMessage: data.statusMessage,
              }
            : prev,
        );
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [params.id]);

  async function save() {
    if (!agent) return;
    setSaving(true);
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: agent.name,
        description: agent.description,
        greeting: agent.greeting,
        asideText: agent.asideText,
        personality: agent.personality,
        role: agent.role,
        communicationStyle: agent.communicationStyle,
        rules: agent.rules,
        goals: agent.goals,
        restrictions: agent.restrictions,
        additionalInstructions: agent.additionalInstructions,
        systemPrompt: agent.systemPrompt,
        ...(orgMode
          ? {}
          : {
              logoUrl: agent.logoUrl,
              model: agent.model,
              dailyRequestLimit: agent.dailyRequestLimit ?? 0,
              monthlyRequestLimit: agent.monthlyRequestLimit ?? 0,
              isPrimary: Boolean(agent.isPrimary),
            }),
        webSearchEnabled: Boolean(agent.webSearchEnabled),
        temperature: agent.temperature,
        maxIterations: agent.maxIterations,
        skillAssignments: agent.skills.map((s, i) => ({
          skillId: s.skillId,
          enabled: s.enabled,
          visible: s.visible,
          sortOrder: i,
        })),
      }),
    });
    setSaving(false);
    setMessage(res.ok ? "Сохранено" : "Ошибка сохранения");
    await load();
  }

  async function copyAgent() {
    if (!agent || acting) return;
    setActing(true);
    setMessage("");
    const res = await fetch(`/api/agents/${agent.id}/copy`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setActing(false);
    if (!res.ok || !data.agent?.id) {
      setMessage(data.error ?? "Не удалось скопировать");
      return;
    }
    router.push(`/admin/agents/${data.agent.id}`);
  }

  async function deleteAgent() {
    if (!agent || acting) return;
    setActing(true);
    const res = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
    setActing(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage(data.error ?? "Не удалось удалить");
      setConfirmDelete(false);
      return;
    }
    router.push("/admin/agents");
  }

  function orgAccessPayload() {
    return {
      orgName,
      orgUnp,
      planName,
      planMonthlyPrice: Math.max(0, Number(planPrice) || 0),
      salesEnabled,
      salesPlanName,
      salesPlanMonthlyPrice: Math.max(0, Number(salesPlanPrice) || 0),
      salesPlaybookLimit: Math.max(0, Math.floor(Number(salesPlaybookLimit) || 0)),
      salesAgentLimit: Math.max(1, Math.floor(Number(salesAgentLimit) || 1)),
    };
  }

  function applyOrgAccessResponse(data: Record<string, unknown>) {
    if (typeof data.orgName === "string") setOrgName(data.orgName);
    if (typeof data.orgUnp === "string") setOrgUnp(data.orgUnp);
    if (typeof data.planName === "string") setPlanName(data.planName);
    if (data.planMonthlyPrice != null) {
      setPlanPrice(Number(data.planMonthlyPrice) ? String(data.planMonthlyPrice) : "");
    }
    if (typeof data.salesEnabled === "boolean") setSalesEnabled(data.salesEnabled);
    if (typeof data.salesPlanName === "string") setSalesPlanName(data.salesPlanName);
    if (data.salesPlanMonthlyPrice != null) {
      setSalesPlanPrice(Number(data.salesPlanMonthlyPrice) ? String(data.salesPlanMonthlyPrice) : "");
    }
    if (data.salesPlaybookLimit != null) {
      const n = Number(data.salesPlaybookLimit) || 0;
      setSalesPlaybookLimit(n > 0 ? String(n) : "");
    }
    if (data.salesAgentLimit != null) {
      setSalesAgentLimit(String(Math.max(1, Number(data.salesAgentLimit) || 1)));
    }
  }

  async function generateAccess() {
    if (!agent || orgBusy) return;
    setOrgBusy(true);
    setMessage("");
    const res = await fetch(`/api/agents/${agent.id}/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orgAccessPayload()),
    });
    const data = await res.json().catch(() => ({}));
    setOrgBusy(false);
    if (!res.ok || !data.email || !data.password) {
      setMessage(data.error ?? "Не удалось выдать доступ");
      return;
    }
    setOrgEmail(data.email);
    applyOrgAccessResponse(data);
    setOrgPassword(data.password);
    const salesNote = data.salesEnabled
      ? data.playbookCreated
        ? " CRM продаж включён, создан навык «Продажи»."
        : " CRM продаж включён."
      : "";
    setMessage(`Доступ готов. Скопируйте почту и пароль — пароль больше не покажется.${salesNote}`);
  }

  async function saveOrgProfile() {
    if (!agent || orgBusy) return;
    setOrgBusy(true);
    setMessage("");
    const res = await fetch(`/api/agents/${agent.id}/access`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orgAccessPayload()),
    });
    const data = await res.json().catch(() => ({}));
    setOrgBusy(false);
    if (!res.ok) {
      setMessage(data.error ?? "Не удалось сохранить организацию");
      return;
    }
    applyOrgAccessResponse(data);
    const salesNote = data.playbookCreated ? " Создан навык продаж «Продажи»." : "";
    setMessage(`Данные организации сохранены.${salesNote}`);
  }

  async function copyAccess(value: string, what: "email" | "password" | "both") {
    const ok = await copyText(value);
    setCopiedAccess(ok ? what : "");
    setMessage(ok ? "Скопировано" : "Не удалось скопировать — выделите текст вручную");
    if (ok) window.setTimeout(() => setCopiedAccess(""), 1600);
  }

  async function saveWidget() {
    if (!agent || widgetBusy) return;
    setWidgetBusy(true);
    setMessage("");
    const res = await fetch(`/api/agents/${agent.id}/widget`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(widgetCfg),
    });
    const data = await res.json().catch(() => ({}));
    setWidgetBusy(false);
    if (!res.ok) {
      setMessage(data.error ?? "Не удалось сохранить виджет");
      return;
    }
    const c = data.widget?.config ?? widgetCfg;
    setWidgetCfg({
      position: c.position === "bottom-left" ? "bottom-left" : "bottom-right",
      size: Math.min(140, Math.max(44, Number(c.size) || 68)),
      offsetBottom: Math.min(40, Math.max(0, Number(c.offsetBottom) ?? 2)),
      offsetSide: Math.min(40, Math.max(0, Number(c.offsetSide) ?? 2)),
    });
    setMessage("Настройки виджета сохранены");
  }

  async function uploadHomeIcon(file: File) {
    const form = new FormData();
    form.set("file", file);
    const res = await fetch(`/api/agents/${params.id}/home-icon`, { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.error ?? "Не удалось сохранить иконку");
      return;
    }
    setMessage("Иконка для экрана сохранена");
    await load();
  }

  async function uploadLogo(file: File) {
    const form = new FormData();
    form.set("file", file);
    await fetch(`/api/agents/${params.id}/logo`, { method: "POST", body: form });
    await load();
  }

  function upload(state: string, file: File) {
    const form = new FormData();
    form.set("state", state);
    form.set("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/agents/${params.id}/character`);
    setMediaUpload({ state, progress: 0 });
    setMessage("");
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.min(100, Math.round((event.loaded / event.total) * 100));
      setMediaUpload({ state, progress });
    };
    xhr.onload = () => {
      setMediaUpload(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        setMessage(file.type.startsWith("video/") ? "Видео загружено" : "Файл загружен");
        void load();
        return;
      }
      let reason = "Не удалось загрузить";
      try {
        reason = (JSON.parse(xhr.responseText) as { error?: string }).error || reason;
      } catch {
        /* keep fallback */
      }
      setMessage(reason);
    };
    xhr.onerror = () => {
      setMediaUpload(null);
      setMessage("Не удалось загрузить файл");
    };
    xhr.send(form);
  }

  async function sendChat() {
    if (!chatInput.trim() || !agent) return;
    const msg = chatInput;
    setChatInput("");
    setChatLog((prev) => [...prev, { role: "user", content: msg }]);
    const res = await fetch(`/api/agents/${agent.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, sessionId: "admin" }),
    });
    const data = await res.json();
    setChatLog((prev) => [
      ...prev,
      {
        role: "assistant",
        content: toChatUserMessage(data.reply ?? data.error ?? CHAT_UNAVAILABLE),
      },
    ]);
  }

  if (!agent) {
    return <p className="text-slate-500">Загрузка агента…</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{agent.name}</h1>
          <p className="text-slate-500">Лого, hero, приветствие, промпт и навыки</p>
          {agent.slug ? (
            <div className="mt-2">
              <AgentChatLink slug={agent.slug} />
            </div>
          ) : null}
          {!orgMode ? (
            <label className="mt-3 flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={Boolean(agent.isPrimary)}
                onChange={(e) => setAgent({ ...agent, isPrimary: e.target.checked })}
              />
              <span>
                <span className="font-medium">Главный агент</span>
                <span className="mt-0.5 block text-slate-500">
                  Открывается с yani.by. Сохраняется кнопкой «Сохранить».
                </span>
              </span>
            </label>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!orgMode && confirmDelete ? (
            <>
              <span className="text-sm text-slate-500">Удалить агента?</span>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-violet-50"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={acting}
                onClick={() => void deleteAgent()}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
              >
                Удалить
              </button>
            </>
          ) : (
            <>
              {!orgMode && (
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => void copyAgent()}
                  className="rounded-xl border border-violet-200 px-4 py-2.5 text-sm font-medium text-violet-800 hover:bg-violet-50 disabled:opacity-60"
                >
                  Копировать
                </button>
              )}
              {!orgMode && (
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-xl px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  Удалить
                </button>
              )}
              <button
                onClick={save}
                disabled={saving}
                className="rounded-xl bg-violet-600 px-4 py-2.5 font-medium text-white hover:bg-violet-500"
              >
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
            </>
          )}
        </div>
      </div>
      {message && <p className="text-sm text-violet-600">{message}</p>}

      {!orgMode && <AgentDocs agentId={agent.id} slug={agent.slug} />}

      {!orgMode && (
      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Доступ организации</h2>
        <p className="mt-1 text-sm text-slate-500">
          Организация получит тот же кабинет, что админка, только для этого агента: без аналитики, ключей и чужих агентов.
        </p>
        <label className="mt-4 block text-sm text-slate-700">
          Название организации
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
          />
        </label>
        <label className="mt-3 block text-sm text-slate-700">
          УНП
          <input
            value={orgUnp}
            onChange={(e) => setOrgUnp(e.target.value)}
            className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
          />
        </label>
        <label className="mt-3 block text-sm text-slate-700">
          Название тарифа
          <input
            value={planName}
            onChange={(e) => setPlanName(e.target.value)}
            placeholder="Как называется тариф сейчас"
            className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
          />
        </label>
        <label className="mt-3 block text-sm text-slate-700">
          Цена тарифа чата в месяц
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={planPrice}
            onChange={(e) => setPlanPrice(e.target.value)}
            placeholder="0"
            className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
          />
        </label>

        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <input
              type="checkbox"
              checked={salesEnabled}
              onChange={(e) => setSalesEnabled(e.target.checked)}
              className="rounded border-violet-300"
            />
            CRM продаж для организации
          </label>
          <p className="mt-1 text-xs text-slate-500">
            В кабинете организации появится «CRM продаж» и навык продажи (если ещё нет). Лимиты ниже —
            сколько менеджеров/навыков продаж и агентов по договору.
          </p>
          <div className={salesEnabled ? "mt-3 grid gap-3 sm:grid-cols-2" : "mt-3 grid gap-3 sm:grid-cols-2 opacity-50 pointer-events-none"}>
            <label className="block text-sm text-slate-700 sm:col-span-2">
              Название тарифа продаж
              <input
                value={salesPlanName}
                onChange={(e) => setSalesPlanName(e.target.value)}
                placeholder="Продажи Pro"
                className="mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2"
              />
            </label>
            <label className="block text-sm text-slate-700">
              Стоимость продаж / месяц
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={salesPlanPrice}
                onChange={(e) => setSalesPlanPrice(e.target.value)}
                placeholder="0"
                className="mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2"
              />
            </label>
            <label className="block text-sm text-slate-700">
              Лимит навыков продаж
              <input
                type="number"
                min={0}
                value={salesPlaybookLimit}
                onChange={(e) => setSalesPlaybookLimit(e.target.value)}
                placeholder="0 = без лимита"
                className="mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2"
              />
            </label>
            <label className="block text-sm text-slate-700 sm:col-span-2">
              Лимит агентов с CRM
              <input
                type="number"
                min={1}
                value={salesAgentLimit}
                onChange={(e) => setSalesAgentLimit(e.target.value)}
                className="mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2"
              />
            </label>
          </div>
        </div>

        {orgEmail ? (
          <p className="mt-3 text-sm text-slate-700">
            Почта: <span className="font-medium">{orgEmail}</span>
          </p>
        ) : null}
        <button
          type="button"
          disabled={orgBusy}
          onClick={() => void generateAccess()}
          className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-60"
        >
          {orgBusy ? "Готовим…" : orgEmail ? "Новый пароль" : "Сгенерировать доступ"}
        </button>
        {orgEmail ? (
          <button
            type="button"
            disabled={orgBusy}
            onClick={() => void saveOrgProfile()}
            className="ml-2 mt-4 rounded-xl border border-violet-200 px-4 py-2.5 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-60"
          >
            Сохранить организацию
          </button>
        ) : null}
        {orgPassword ? (
          <div className="mt-4 space-y-2 rounded-xl bg-violet-50 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Почта: <span className="font-medium">{orgEmail}</span>
              </span>
              <button
                type="button"
                className="rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-xs font-medium text-violet-800 hover:bg-violet-50"
                onClick={() => void copyAccess(orgEmail, "email")}
              >
                {copiedAccess === "email" ? "Скопировано" : "Копировать"}
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Пароль: <span className="font-medium">{orgPassword}</span>
              </span>
              <button
                type="button"
                className="rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-xs font-medium text-violet-800 hover:bg-violet-50"
                onClick={() => void copyAccess(orgPassword, "password")}
              >
                {copiedAccess === "password" ? "Скопировано" : "Копировать"}
              </button>
            </div>
            <button
              type="button"
              className="rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-xs font-medium text-violet-800 hover:bg-violet-50"
              onClick={() => void copyAccess(`${orgEmail}\n${orgPassword}`, "both")}
            >
              {copiedAccess === "both" ? "Скопировано" : "Копировать почту и пароль"}
            </button>
          </div>
        ) : null}
      </section>
      )}

      <section className="grid gap-4 rounded-2xl border border-violet-100 bg-white p-5 shadow-sm md:grid-cols-[140px_1fr]">
        <div className="flex flex-col gap-3">
          {!orgMode ? (
            <label className="flex h-32 w-32 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-violet-200 bg-violet-50 text-center text-xs text-violet-600 hover:border-violet-400">
              {agent.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={agent.logoUrl} alt="logo" className="h-full w-full object-contain p-2" />
              ) : (
                <span>Логотип</span>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadLogo(file);
                  e.target.value = "";
                }}
              />
            </label>
          ) : null}
          <label className="flex h-32 w-32 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-violet-200 bg-violet-50 text-center text-xs text-violet-600 hover:border-violet-400">
            {agent.homeIconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={agent.homeIconUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="px-2">Иконка на экран</span>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadHomeIcon(file);
                e.target.value = "";
              }}
            />
          </label>
          <p className="w-32 text-center text-[11px] leading-snug text-slate-500">На экран телефона. Своя у каждого агента.</p>
        </div>
        <div className="space-y-3">
          <label className="block text-sm text-slate-700">
            Название
            <input
              className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
              value={agent.name}
              onChange={(e) => setAgent({ ...agent, name: e.target.value })}
            />
          </label>
          <label className="block text-sm text-slate-700">
            Приветствие
            <textarea
              className="mt-1 min-h-20 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
              value={agent.greeting}
              onChange={(e) => setAgent({ ...agent, greeting: e.target.value })}
              placeholder="Привет! Чем могу помочь?"
            />
          </label>
          <label className="block text-sm text-slate-700">
            Описание
            <textarea
              className="mt-1 min-h-16 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
              value={agent.description}
              onChange={(e) => setAgent({ ...agent, description: e.target.value })}
            />
          </label>
          <label className="block text-sm text-slate-700">
            Текст рядом с агентом
            <textarea
              className="mt-1 min-h-16 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
              value={agent.asideText}
              onChange={(e) => setAgent({ ...agent, asideText: e.target.value })}
              placeholder="Например: ИИ-агент 24/7. Видно рядом с героем в чате и у кнопки виджета."
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Если навык не выбран</h2>
        <p className="mt-1 text-sm text-slate-500">
          Задача только для этого агента, когда в чате навык не выбран. Текст задаёте вы: искать по всем
          назначенным навыкам или попросить выбрать навык. Когда навык выбран, действует его промпт.
        </p>
        <textarea
          className="mt-3 min-h-40 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 text-sm"
          value={agent.systemPrompt}
          onChange={(e) => setAgent({ ...agent, systemPrompt: e.target.value })}
          placeholder={"Например:\nИщи ответ по всем навыкам ниже и не смешивай факты, если они из разных навыков.\n\nили:\nНе отвечай по существу. Перечисли навыки и попроси выбрать один."}
        />
        <p className="mt-2 text-xs text-slate-500">Сохраняется вместе с кнопкой «Сохранить» внизу страницы.</p>
        <label className="mt-4 flex items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-1 rounded border-violet-300"
            checked={Boolean(agent.webSearchEnabled)}
            onChange={(e) => setAgent({ ...agent, webSearchEnabled: e.target.checked })}
          />
          <span>
            <span className="font-medium">Поиск в интернете (галочка)</span>
            <span className="mt-0.5 block text-slate-500">
              Включает Яндекс для этого агента всегда, даже если в промпте про интернет ничего нет.
              Отдельно: если в промпте агента, навыка или CRM-навыка продажи написано искать в интернете —
              поиск тоже включится без этой галочки. Ключ — в Настройках.
            </span>
          </span>
        </label>
      </section>

      {!orgMode && (
      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Модель этого агента</h2>
        <p className="mt-1 text-sm text-slate-500">
          Только этот агент отвечает выбранной моделью. Цена в списке — вход / выход за 1 млн токенов.
          Потрачено на запросы этого агента: <span className="font-medium text-slate-800">{spentLabel || "—"}</span>
        </p>
        <div className="mt-3 max-w-xl">
          <ModelSelect
            value={agent.model ?? ""}
            onChange={(model) => setAgent({ ...agent, model })}
          />
        </div>
        <p className="mt-2 text-xs text-slate-500">Сохраняется вместе с кнопкой «Сохранить» внизу страницы.</p>
      </section>
      )}

      {!orgMode && (
      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Лимит запросов</h2>
        <p className="mt-1 text-sm text-slate-500">
          Сколько сообщений этот агент принимает из чата и виджета. Пустое поле — без лимита. День и месяц
          считаются по минскому времени. Сейчас: сегодня {agent.requestsToday ?? 0}, в этом месяце{" "}
          {agent.requestsMonth ?? 0}.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-slate-700">
            В день
            <input
              type="number"
              min={0}
              inputMode="numeric"
              className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
              value={agent.dailyRequestLimit || ""}
              placeholder="Без лимита"
              onChange={(e) =>
                setAgent({
                  ...agent,
                  dailyRequestLimit: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                })
              }
            />
          </label>
          <label className="block text-sm text-slate-700">
            В месяц
            <input
              type="number"
              min={0}
              inputMode="numeric"
              className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
              value={agent.monthlyRequestLimit || ""}
              placeholder="Без лимита"
              onChange={(e) =>
                setAgent({
                  ...agent,
                  monthlyRequestLimit: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                })
              }
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">Сохраняется вместе с кнопкой «Сохранить» внизу страницы.</p>
      </section>
      )}

      {!orgMode && (
      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <CharacterStage
          name={agent.name}
          assets={(agent.character?.assets ?? []) as never}
          status={agent.status}
          statusMessage={agent.statusMessage}
          previewState={previewState}
        />

        <div className="space-y-6">
          <section className="rounded-2xl border border-violet-100 bg-white shadow-sm p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-medium">Галерея эмоций</h2>
                <p className="text-xs text-slate-500">
                  Картинка или web-видео (WebM / MP4 / Ogg), до 50 МБ
                </p>
              </div>
              {previewState && (
                <button
                  type="button"
                  onClick={() => setPreviewState(null)}
                  className="rounded-lg border border-violet-200 px-3 py-1.5 text-xs text-violet-700"
                >
                  Живой статус
                </button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {STATES.map((state) => {
                const asset = agent.character?.assets.find((a) => a.state === state);
                const active = previewState === state;
                const isVideo =
                  asset?.type === "VIDEO" ||
                  asset?.mimeType?.startsWith("video/") ||
                  /\.(webm|mp4|ogv|ogg)(\?|$)/i.test(asset?.url ?? "");
                return (
                  <div
                    key={state}
                    className={`rounded-xl border p-3 text-center transition ${
                      active
                        ? "border-violet-400 bg-violet-50"
                        : "border-violet-100 bg-violet-50/50 hover:border-violet-300"
                    }`}
                  >
                    <button
                      type="button"
                      className="w-full"
                      onClick={() => setPreviewState(state)}
                    >
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        {STATE_LABELS[state]}
                        {isVideo ? " · видео" : ""}
                      </p>
                      {asset ? (
                        isVideo ? (
                          <video
                            ref={(node) => {
                              if (!node) return;
                              return bindHeroVideo(node);
                            }}
                            src={normalizeAssetUrl(asset.url)}
                            className="mx-auto mt-2 h-24 w-24 rounded-xl object-contain"
                            autoPlay
                            loop
                            muted
                            playsInline
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={normalizeAssetUrl(asset.url)}
                            alt={state}
                            className="mx-auto mt-2 h-24 w-24 rounded-xl object-contain"
                          />
                        )
                      ) : (
                        <p className="mt-6 text-xs text-slate-500">Нет медиа</p>
                      )}
                    </button>
                    <label className="mt-2 inline-block cursor-pointer text-[11px] text-violet-600/70 hover:text-violet-700">
                      {mediaUpload?.state === state ? `Загрузка ${mediaUpload.progress}%` : "Загрузить"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,video/webm,video/mp4,video/ogg"
                        className="hidden"
                        disabled={mediaUpload !== null}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) upload(state, file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {mediaUpload?.state === state && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-violet-100">
                        <div
                          className="h-full rounded-full bg-yani-deep transition-[width] duration-150"
                          style={{ width: `${mediaUpload.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

        </div>
      </div>
      )}

      <section className="rounded-2xl border border-violet-100 bg-white shadow-sm p-5">
          <h2 className="mb-3 font-medium">Назначенные навыки</h2>
          <p className="mb-4 text-xs text-slate-500">
            Включите навык, настройте видимость на пользовательском экране и порядок плиток.
          </p>
          <PagedRows
            items={skills}
            text={(skill) => `${skill.name} ${skill.description ?? ""}`}
            placeholder="Поиск по навыкам"
          >
            {(rows) => (
          <div className="space-y-2">
            {rows.map((skill) => {
              const assigned = agent.skills.find((s) => s.skillId === skill.id);
              const checked = Boolean(assigned);
              return (
                <div
                  key={skill.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-2 text-sm"
                >
                  <label className="flex min-w-[140px] flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setAgent({
                            ...agent,
                            skills: [
                              ...agent.skills,
                              {
                                skillId: skill.id,
                                enabled: true,
                                visible: true,
                                sortOrder: agent.skills.length,
                                skill,
                              },
                            ],
                          });
                        } else {
                          setAgent({
                            ...agent,
                            skills: agent.skills.filter((s) => s.skillId !== skill.id),
                          });
                        }
                      }}
                    />
                    {skill.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={skill.iconUrl} alt="" className="h-6 w-6 rounded object-cover" />
                    ) : null}
                    <span>{skill.name}</span>
                  </label>
                  {assigned && (
                    <>
                      <label className="flex items-center gap-1 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={assigned.visible}
                          onChange={(e) => {
                            setAgent({
                              ...agent,
                              skills: agent.skills.map((s) =>
                                s.skillId === skill.id
                                  ? { ...s, visible: e.target.checked }
                                  : s,
                              ),
                            });
                          }}
                        />
                        виден
                      </label>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="rounded border border-violet-200 px-2 py-0.5 text-xs"
                          onClick={() => {
                            const list = [...agent.skills];
                            const i = list.findIndex((s) => s.skillId === skill.id);
                            if (i <= 0) return;
                            [list[i - 1], list[i]] = [list[i], list[i - 1]];
                            setAgent({ ...agent, skills: list });
                          }}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="rounded border border-violet-200 px-2 py-0.5 text-xs"
                          onClick={() => {
                            const list = [...agent.skills];
                            const i = list.findIndex((s) => s.skillId === skill.id);
                            if (i < 0 || i >= list.length - 1) return;
                            [list[i], list[i + 1]] = [list[i + 1], list[i]];
                            setAgent({ ...agent, skills: list });
                          }}
                        >
                          ↓
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
            )}
          </PagedRows>
        </section>

      <section className="rounded-2xl border border-violet-100 bg-white shadow-sm p-5">
        <h2 className="mb-3 font-medium">Чат с агентом</h2>
        <div className="mb-3 max-h-72 space-y-2 overflow-y-auto rounded-xl bg-violet-50/50 p-4">
          {chatLog.map((m, i) => {
            const parsed =
              m.role === "assistant"
                ? splitReplyButtons(hideOpenButtonToken(m.content))
                : { text: m.content, buttons: [] };
            return (
            <div
              key={i}
              className={`rounded-lg px-3 py-2 text-sm ${
                m.role === "user" ? "bg-violet-600 text-white" : "bg-violet-50 text-slate-800"
              }`}
            >
              <span className="mr-2 text-xs uppercase text-slate-500">{m.role}</span>
              {parsed.text ? (
                <ChatMarkdown
                  text={parsed.text}
                  variant={m.role === "user" ? "user" : "assistant"}
                />
              ) : null}
              {parsed.buttons.length ? (
                <div className="mt-2 flex flex-col gap-1">
                  {parsed.buttons.map((button) => (
                    <a
                      key={button.label + button.href}
                      href={button.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg bg-violet-200 px-2 py-1 text-center text-xs font-medium text-slate-900"
                    >
                      {button.label}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
            );
          })}
          {!chatLog.length && <p className="text-sm text-slate-500">Начните диалог</p>}
        </div>
        <div className="flex gap-2">
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void sendChat()}
            placeholder="Напишите агенту…"
            className="flex-1 rounded-xl border border-violet-200 bg-violet-50/40 px-4 py-3 outline-none focus:border-violet-400"
          />
          <button
            onClick={sendChat}
            className="rounded-xl bg-violet-600 px-5 py-3 font-medium text-white hover:bg-violet-500"
          >
            Отправить
          </button>
        </div>
        <p className="mt-3 break-all text-xs text-slate-500">
          Виджет:{" "}
          <code className="rounded bg-violet-50 px-1">{`<script src="${typeof window !== "undefined" ? window.location.origin : ""}/widget.js" data-agent-id="${agent.id}"></script>`}</code>
        </p>
        <p className="mt-2 break-all text-xs text-slate-500">
          Фрейм — тот же чат, что на сайте: герой и лавандовое оформление.{" "}
          <code className="rounded bg-violet-50 px-1">{`<iframe src="${typeof window !== "undefined" ? window.location.origin : ""}/chat?slug=${encodeURIComponent(agent.slug)}" title="Чат" style="width:100%;height:720px;border:0"></iframe>`}</code>
        </p>
      </section>

      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="font-medium text-slate-900">Настройки виджета</h2>
        <p className="mt-1 text-sm text-slate-500">
          Текст рядом с кнопкой берётся из поля «Текст рядом с агентом» выше (сохраните агента). Здесь —
          размер кнопки и сдвиг: выше = больше «Отступ снизу», левее = больше «Отступ сбоку» при позиции справа.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-slate-700">
            Позиция
            <select
              className="mt-1 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2"
              value={widgetCfg.position}
              onChange={(e) =>
                setWidgetCfg({
                  ...widgetCfg,
                  position: e.target.value === "bottom-left" ? "bottom-left" : "bottom-right",
                })
              }
            >
              <option value="bottom-right">Справа внизу</option>
              <option value="bottom-left">Слева внизу</option>
            </select>
          </label>
          <label className="block text-sm text-slate-700">
            Диаметр кнопки, px ({widgetCfg.size})
            <input
              type="range"
              min={44}
              max={140}
              step={2}
              value={widgetCfg.size}
              onChange={(e) => setWidgetCfg({ ...widgetCfg, size: Number(e.target.value) })}
              className="mt-3 w-full"
            />
          </label>
          <label className="block text-sm text-slate-700">
            Отступ снизу, % высоты ({widgetCfg.offsetBottom}) — выше на экране
            <input
              type="range"
              min={0}
              max={40}
              step={1}
              value={widgetCfg.offsetBottom}
              onChange={(e) => setWidgetCfg({ ...widgetCfg, offsetBottom: Number(e.target.value) })}
              className="mt-3 w-full"
            />
          </label>
          <label className="block text-sm text-slate-700">
            Отступ сбоку, % ({widgetCfg.offsetSide}) — дальше от края к центру / левее справа
            <input
              type="range"
              min={0}
              max={40}
              step={1}
              value={widgetCfg.offsetSide}
              onChange={(e) => setWidgetCfg({ ...widgetCfg, offsetSide: Number(e.target.value) })}
              className="mt-3 w-full"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={widgetBusy}
          onClick={() => void saveWidget()}
          className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-60"
        >
          {widgetBusy ? "Сохранение…" : "Сохранить виджет"}
        </button>
      </section>
    </div>
  );
}
