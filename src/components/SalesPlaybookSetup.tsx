"use client";

import { useEffect, useState } from "react";
import { Download, FileText, ImageIcon, Instagram, Mail, MessageCircle, Trash2, Upload, X } from "lucide-react";
import { fileDownloadUrl } from "@/lib/downloadUrl";

type PlaybookSetup = {
  id: string;
  name: string;
  product: string;
  systemPrompt: string;
  goals: string;
  communicationStyle: string;
  restrictions: string;
  qualificationQuestions: string;
  sendMode: string;
  channelTelegramEnabled?: boolean;
  channelEmailEnabled?: boolean;
  telegramSendIntervalSeconds?: number;
};

type SalesDocument = {
  id: string;
  fileName: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  textLength: number;
  textPreview: string;
  isImage?: boolean;
};

type TelegramConnection = {
  id: string;
  status: string;
  username: string;
  firstName: string;
  lastError: string;
  lastPolledAt: string | null;
};

type TelegramAccountConnection = {
  id: string;
  status: string;
  phoneMasked: string;
  username: string;
  firstName: string;
  codeViaApp: boolean;
  delivery?: string;
  lastError: string;
};

type InstagramConnection = {
  id: string;
  status: string;
  username: string;
  igUserId: string;
  lastError: string;
  webhookUrl: string;
  verifyToken: string;
};

type EmailConnection = {
  id: string;
  status: string;
  email: string;
  username: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  fromName: string;
  signature: string;
  lastError: string;
  lastPolledAt: string | null;
};

const fieldClass =
  "mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100";

export function SalesPlaybookSetup({
  playbook,
  agentId,
  onClose,
  onSaved,
  onDeleted,
  onNotice,
}: {
  playbook: PlaybookSetup;
  agentId: string;
  onClose: () => void;
  onSaved: (playbook: PlaybookSetup) => void;
  onDeleted: () => void;
  onNotice: (message: string) => void;
}) {
  const [draft, setDraft] = useState(playbook);
  const [documents, setDocuments] = useState<SalesDocument[]>([]);
  const [instagram, setInstagram] = useState<InstagramConnection | null>(null);
  const [instagramToken, setInstagramToken] = useState("");
  const [instagramMessage, setInstagramMessage] = useState("");
  const [instagramSetup, setInstagramSetup] = useState({ webhookUrl: "", verifyToken: "" });
  const [telegram, setTelegram] = useState<TelegramConnection | null>(null);
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramAccount, setTelegramAccount] = useState<TelegramAccountConnection | null>(null);
  const [accountAuth, setAccountAuth] = useState({
    apiId: "",
    apiHash: "",
    phone: "",
    code: "",
    password: "",
  });
  const [emailConnection, setEmailConnection] = useState<EmailConnection | null>(null);
  const [emailDraft, setEmailDraft] = useState({
    email: "",
    username: "",
    password: "",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
    fromName: "",
    signature: "",
  });
  const [preview, setPreview] = useState<{ fileName: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const query = `agentId=${encodeURIComponent(agentId)}`;

  async function crmFetch(input: RequestInfo | URL, init?: RequestInit) {
    try {
      const response = await fetch(input, init);
      const data = await response.json().catch(() => ({}));
      return { response, data, offline: false as const };
    } catch {
      return { response: null, data: { error: "Сервер CRM недоступен. Обновите страницу." }, offline: true as const };
    }
  }


  async function loadDocuments() {
    try {
      const response = await fetch(`/api/crm/playbooks/${playbook.id}/documents?${query}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        onNotice(data.error ?? "Не удалось загрузить документы");
        return;
      }
      setDocuments(data.documents ?? []);
    } catch {
      onNotice("Сервер CRM недоступен. Обновите страницу.");
    }
  }

  async function loadInstagram() {
    try {
      const response = await fetch(`/api/crm/playbooks/${playbook.id}/instagram?${query}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return;
      setInstagram(data.connection ?? null);
      setInstagramSetup({
        webhookUrl: data.webhookUrl || data.connection?.webhookUrl || "",
        verifyToken: data.verifyToken || data.connection?.verifyToken || "",
      });
    } catch {
      /* ignore offline */
    }
  }

  async function loadTelegram() {
    try {
      const response = await fetch(`/api/crm/playbooks/${playbook.id}/telegram?${query}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        onNotice(data.error ?? "Не удалось проверить Telegram");
        return;
      }
      setTelegram(data.connection ?? null);
    } catch {
      onNotice("Сервер CRM недоступен. Обновите страницу.");
    }
  }

  async function loadTelegramAccount() {
    try {
      const response = await fetch(`/api/crm/playbooks/${playbook.id}/telegram-account?${query}`);
      const data = await response.json().catch(() => ({}));
      if (response.ok) setTelegramAccount(data.connection ?? null);
    } catch {
      /* ignore offline */
    }
  }

  async function loadEmail() {
    try {
      const response = await fetch(`/api/crm/playbooks/${playbook.id}/email?${query}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return;
      const connection = data.connection as EmailConnection | null;
      setEmailConnection(connection);
      if (connection) {
        setEmailDraft({
          email: connection.email,
          username: connection.username,
          password: "",
          imapHost: connection.imapHost,
          imapPort: connection.imapPort,
          imapSecure: connection.imapSecure,
          smtpHost: connection.smtpHost,
          smtpPort: connection.smtpPort,
          smtpSecure: connection.smtpSecure,
          fromName: connection.fromName,
          signature: connection.signature,
        });
      }
    } catch {
      /* ignore offline */
    }
  }

  useEffect(() => {
    setDraft(playbook);
    setDocuments([]);
    setInstagram(null);
    setTelegram(null);
    setTelegramAccount(null);
    setEmailConnection(null);
    setPreview(null);
    void loadDocuments();
    void loadInstagram();
    void loadTelegram();
    void loadTelegramAccount();
    void loadEmail();
    // playbook.id and agentId identify this modal instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbook.id, agentId]);

  async function connectInstagram() {
    if (!instagramToken.trim()) {
      setInstagramMessage("Сначала вставьте токен доступа Instagram.");
      return;
    }
    setInstagramMessage("");
    setBusy(true);
    const { response, data, offline } = await crmFetch(`/api/crm/playbooks/${playbook.id}/instagram`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, token: instagramToken }),
    });
    setBusy(false);
    if (offline || !response || !response.ok) {
      const message = data.error ?? "Не удалось подключить Instagram";
      setInstagramMessage(message);
      onNotice(message);
      return;
    }
    setInstagramToken("");
    setInstagram(data.connection);
    setInstagramMessage("");
    onNotice(`Instagram @${data.connection.username || data.connection.igUserId} подключён`);
  }

  async function disconnectInstagram() {
    if (!window.confirm("Отключить Instagram от этого навыка?")) return;
    setBusy(true);
    const response = await fetch(`/api/crm/playbooks/${playbook.id}/instagram?${query}`, { method: "DELETE" });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      onNotice(data.error ?? "Не удалось отключить Instagram");
      return;
    }
    setInstagram(null);
    onNotice("Instagram отключён");
  }

  async function connectTelegram() {
    if (!telegramToken.trim()) return;
    setBusy(true);
    const { response, data, offline } = await crmFetch(`/api/crm/playbooks/${playbook.id}/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, token: telegramToken }),
    });
    setBusy(false);
    if (offline || !response || !response.ok) {
      onNotice(data.error ?? "Не удалось подключить Telegram");
      return;
    }
    setTelegramToken("");
    setTelegram(data.connection);
    onNotice(`Telegram-бот @${data.connection.username || data.connection.firstName} подключён`);
  }

  async function disconnectTelegram() {
    if (!window.confirm("Отключить Telegram-бота от этого навыка?")) return;
    setBusy(true);
    const response = await fetch(`/api/crm/playbooks/${playbook.id}/telegram?${query}`, {
      method: "DELETE",
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      onNotice(data.error ?? "Не удалось отключить Telegram");
      return;
    }
    setTelegram(null);
    onNotice("Telegram отключён");
  }

  async function startAccountAuth() {
    setBusy(true);
    try {
      const response = await fetch(`/api/crm/playbooks/${playbook.id}/telegram-account`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "START",
          agentId,
          apiId: accountAuth.apiId,
          apiHash: accountAuth.apiHash,
          phone: accountAuth.phone,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        onNotice(data.error ?? "Не удалось запросить код");
        return;
      }
      setTelegramAccount(data.connection);
      onNotice(
        data.hint ??
          (data.connection.delivery === "SMS" || !data.connection.codeViaApp
            ? "Код отправлен по SMS"
            : "Код в чате «Telegram» на телефоне (не SMS). Если нет — нажмите «Отправить ещё раз»."),
      );
    } catch {
      onNotice("Сервер недоступен. Обновите страницу и попробуйте снова.");
    } finally {
      setBusy(false);
    }
  }

  async function resendAccountCode() {
    setBusy(true);
    try {
      const response = await fetch(`/api/crm/playbooks/${playbook.id}/telegram-account`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "RESEND", agentId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        onNotice(data.error ?? "Не удалось отправить код ещё раз");
        return;
      }
      setTelegramAccount(data.connection);
      setAccountAuth((current) => ({ ...current, code: "" }));
      onNotice(data.hint ?? (data.delivery === "SMS" ? "Код отправлен по SMS" : "Код отправлен в Telegram"));
    } catch {
      onNotice("Сервер недоступен. Обновите страницу и попробуйте снова.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyAccount() {
    setBusy(true);
    const response = await fetch(`/api/crm/playbooks/${playbook.id}/telegram-account`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "VERIFY",
        agentId,
        code: accountAuth.code,
        password: accountAuth.password || undefined,
      }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      onNotice(data.error ?? "Не удалось подтвердить вход");
      return;
    }
    setTelegramAccount(data.connection);
    if (data.passwordRequired) {
      onNotice("Введите пароль двухэтапной аутентификации и подтвердите ещё раз");
    } else {
      setAccountAuth({ apiId: "", apiHash: "", phone: "", code: "", password: "" });
      onNotice("Telegram-аккаунт подключён");
    }
  }

  async function disconnectTelegramAccount() {
    if (!window.confirm("Отключить Telegram-аккаунт и удалить сессию из Yani?")) return;
    setBusy(true);
    const response = await fetch(`/api/crm/playbooks/${playbook.id}/telegram-account?${query}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!response.ok) {
      const data = await response.json();
      onNotice(data.error ?? "Не удалось отключить аккаунт");
      return;
    }
    setTelegramAccount(null);
    onNotice("Telegram-аккаунт отключён");
  }

  async function connectEmail() {
    setBusy(true);
    const response = await fetch(`/api/crm/playbooks/${playbook.id}/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, ...emailDraft }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      onNotice(data.error ?? "Не удалось подключить почту");
      return;
    }
    setEmailConnection(data.connection);
    setEmailDraft((current) => ({ ...current, password: "" }));
    onNotice(`Почта ${data.connection.email} подключена`);
  }

  async function disconnectEmail() {
    if (!window.confirm("Отключить почту от этого навыка?")) return;
    setBusy(true);
    const response = await fetch(`/api/crm/playbooks/${playbook.id}/email?${query}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!response.ok) {
      const data = await response.json();
      onNotice(data.error ?? "Не удалось отключить почту");
      return;
    }
    setEmailConnection(null);
    onNotice("Почта отключена");
  }

  function applyEmailPreset(preset: "YANDEX" | "GMAIL" | "MAILRU") {
    const values = {
      YANDEX: { imapHost: "imap.yandex.ru", smtpHost: "smtp.yandex.ru", smtpPort: 465 },
      GMAIL: { imapHost: "imap.gmail.com", smtpHost: "smtp.gmail.com", smtpPort: 465 },
      MAILRU: { imapHost: "imap.mail.ru", smtpHost: "smtp.mail.ru", smtpPort: 465 },
    }[preset];
    setEmailDraft((current) => ({
      ...current,
      ...values,
      imapPort: 993,
      imapSecure: true,
      smtpSecure: true,
    }));
  }

  async function removePlaybook() {
    const ok = window.confirm(
      `Удалить навык «${playbook.name}»?\n\nБудут удалены все карточки клиентов, переписка, материалы и подключения каналов этого навыка. Это нельзя отменить.`,
    );
    if (!ok) return;
    const typed = window.prompt(`Чтобы подтвердить, введите название навыка:\n${playbook.name}`);
    if (typed !== playbook.name) {
      if (typed !== null) onNotice("Название не совпало — навык не удалён");
      return;
    }
    setBusy(true);
    const response = await fetch(`/api/crm/playbooks/${playbook.id}?${query}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      onNotice(data.error ?? "Не удалось удалить навык");
      return;
    }
    onNotice(`Навык «${playbook.name}» удалён`);
    onDeleted();
  }

  async function save() {
    setBusy(true);
    const response = await fetch(`/api/crm/playbooks/${playbook.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...draft, agentId }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      onNotice(data.error ?? "Не удалось сохранить навык");
      return;
    }
    setDraft(data.playbook);
    onSaved(data.playbook);
    onNotice("Настройки навыка сохранены");
  }

  async function upload(file: File) {
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    const response = await fetch(`/api/crm/playbooks/${playbook.id}/documents?${query}`, {
      method: "POST",
      body: form,
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      onNotice(data.error ?? "Не удалось загрузить документ");
      return;
    }
    await loadDocuments();
    onNotice(`Документ «${file.name}» обработан`);
  }

  async function showPreview(document: SalesDocument) {
    const response = await fetch(
      `/api/crm/playbooks/${playbook.id}/documents/${document.id}?${query}`,
    );
    const data = await response.json();
    if (!response.ok) {
      onNotice(data.error ?? "Не удалось открыть текст");
      return;
    }
    setPreview({ fileName: document.fileName, text: data.document.text });
  }

  async function remove(document: SalesDocument) {
    if (!window.confirm(`Удалить документ «${document.fileName}»?`)) return;
    setBusy(true);
    const response = await fetch(
      `/api/crm/playbooks/${playbook.id}/documents/${document.id}?${query}`,
      { method: "DELETE" },
    );
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      onNotice(data.error ?? "Не удалось удалить документ");
      return;
    }
    if (preview?.fileName === document.fileName) setPreview(null);
    await loadDocuments();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3">
      <section className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Настройка навыка продажи</h2>
            <p className="text-xs text-slate-500">{playbook.name}</p>
          </div>
          <button type="button" aria-label="Закрыть" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <div className="grid gap-6 p-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-3">
            <label className="block text-sm text-slate-700">
              Название
              <input className={fieldClass} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label className="block text-sm text-slate-700">
              Продукт и ценность
              <textarea rows={4} className={fieldClass} value={draft.product} onChange={(event) => setDraft({ ...draft, product: event.target.value })} />
            </label>
            <label className="block text-sm text-slate-700">
              Как агент должен общаться
              <textarea rows={4} className={fieldClass} value={draft.systemPrompt} onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })} />
              <span className="mt-1 block text-xs text-slate-500">
                Документы из Telegram: «Анализируй документы и файлы, которые присылает клиент».
                Поиск в интернете по промпту (без галочки у агента): «Ищи информацию в интернете и на сайтах…».
                Либо включите галочку «Поиск в интернете» у агента — тогда ищет всегда.
              </span>
            </label>
            <label className="block text-sm text-slate-700">
              Цели
              <textarea rows={3} className={fieldClass} value={draft.goals} onChange={(event) => setDraft({ ...draft, goals: event.target.value })} />
            </label>
            <label className="block text-sm text-slate-700">
              Тон общения
              <textarea rows={3} className={fieldClass} value={draft.communicationStyle} onChange={(event) => setDraft({ ...draft, communicationStyle: event.target.value })} />
            </label>
            <label className="block text-sm text-slate-700">
              Ограничения
              <textarea rows={3} className={fieldClass} value={draft.restrictions} onChange={(event) => setDraft({ ...draft, restrictions: event.target.value })} />
            </label>
            <label className="block text-sm text-slate-700">
              Режим исходящих ответов
              <select className={fieldClass} value={draft.sendMode || "APPROVAL_REQUIRED"} onChange={(event) => setDraft({ ...draft, sendMode: event.target.value })}>
                <option value="APPROVAL_REQUIRED">С подтверждением менеджера</option>
                <option value="DRAFT_ONLY">Только черновики</option>
                <option value="AUTO">Автоматическая отправка</option>
              </select>
            </label>
            <fieldset className="rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-3">
              <legend className="px-1 text-sm font-medium text-slate-800">Каналы общения</legend>
              <p className="mb-2 text-xs text-slate-500">Можно включить один канал или оба сразу.</p>
              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-violet-300 text-violet-600 focus:ring-violet-200"
                    checked={draft.channelTelegramEnabled !== false}
                    onChange={(event) => setDraft({ ...draft, channelTelegramEnabled: event.target.checked })}
                  />
                  Telegram
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-violet-300 text-violet-600 focus:ring-violet-200"
                    checked={draft.channelEmailEnabled !== false}
                    onChange={(event) => setDraft({ ...draft, channelEmailEnabled: event.target.checked })}
                  />
                  Email
                </label>
              </div>
              {draft.channelTelegramEnabled === false && draft.channelEmailEnabled === false && (
                <p className="mt-2 text-xs text-amber-700">Сейчас оба канала выключены — агент не будет отвечать клиентам в Telegram и Email.</p>
              )}
            </fieldset>
            <label className="block text-sm text-slate-700">
              Квалифицирующие вопросы
              <textarea
                rows={4}
                className={fieldClass}
                value={draft.qualificationQuestions}
                onChange={(event) => setDraft({ ...draft, qualificationQuestions: event.target.value })}
                placeholder="Например: сколько менеджеров, какой объём обращений, когда нужен запуск"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy || !draft.name.trim()} onClick={() => void save()} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white disabled:bg-slate-200">
                Сохранить настройки
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void removePlaybook()}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                <Trash2 size={15} />
                Удалить навык
              </button>
            </div>
          </div>

          <div>
            <div className="mb-4 rounded-2xl border border-pink-200 bg-pink-50/60 p-4">
              <div className="flex items-center gap-2">
                <Instagram size={18} className="text-pink-600" />
                <h3 className="font-medium text-slate-900">Instagram Direct</h3>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Ответы на входящие сообщения. Холодные рассылки в Direct не отправляются. Пока приложение Meta не опубликовано, писать может только тестовый аккаунт.
              </p>
              <div className="mt-3 space-y-2 text-xs text-slate-600">
                <p>Адрес вебхука в Meta</p>
                <code className="block break-all rounded-lg bg-white px-2 py-1 text-[11px] text-slate-800">
                  {instagramSetup.webhookUrl || "https://yani.by/api/crm/instagram/webhook"}
                </code>
                <p>Маркер подтверждения</p>
                <code className="block break-all rounded-lg bg-white px-2 py-1 text-[11px] text-slate-800">
                  {instagramSetup.verifyToken || "откройте навык ещё раз"}
                </code>
              </div>
              {instagram ? (
                <div className="mt-3">
                  <p className="text-sm font-medium text-slate-800">
                    @{instagram.username || instagram.igUserId} · {instagram.status}
                  </p>
                  {instagram.lastError && <p className="mt-2 text-xs text-rose-600">{instagram.lastError}</p>}
                  <p className="mt-2 text-xs text-slate-500">
                    Навык должен быть запущен. В режиме «Автоматическая отправка» ответ уйдёт сам. В остальных режимах черновик появится в карточке, и его нужно подтвердить.
                  </p>
                  <button type="button" disabled={busy} onClick={() => void disconnectInstagram()} className="mt-3 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-rose-700">
                    Отключить
                  </button>
                </div>
              ) : (
                <>
                  <p className="mt-3 text-xs text-slate-500">
                    Нужен токен доступа аккаунта из сценария Instagram в Meta. Маркер подтверждения выше и секрет приложения сюда не подходят.
                  </p>
                  <input
                    type="password"
                    autoComplete="off"
                    className={fieldClass}
                    value={instagramToken}
                    onChange={(event) => setInstagramToken(event.target.value)}
                    placeholder="Токен Instagram"
                  />
                  <button type="button" disabled={busy} onClick={() => void connectInstagram()} className="mt-2 rounded-xl bg-pink-600 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-200">
                    {busy ? "Проверяем…" : "Проверить и подключить"}
                  </button>
                  {instagramMessage && <p className="mt-2 text-xs text-rose-700">{instagramMessage}</p>}
                </>
              )}
            </div>

            <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
              <div className="flex items-center gap-2">
                <MessageCircle size={18} className="text-sky-600" />
                <h3 className="font-medium text-slate-900">Telegram-бот</h3>
              </div>
              {telegram ? (
                <div className="mt-3">
                  <p className="text-sm font-medium text-slate-800">
                    @{telegram.username || telegram.firstName} · {telegram.status}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {telegram.lastPolledAt
                      ? `Последняя проверка: ${new Date(telegram.lastPolledAt).toLocaleString("ru-RU")}`
                      : "Worker ещё не получил обновления"}
                  </p>
                  {telegram.lastError && <p className="mt-2 text-xs text-rose-600">{telegram.lastError}</p>}
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-slate-600">
                    <li>В Telegram откройте Настройки → Telegram Business → Чат-боты.</li>
                    <li>Добавьте @{telegram.username || telegram.firstName} и разрешите отвечать на сообщения.</li>
                    <li>Клиент пишет вашему рабочему аккаунту — черновик появится в его карточке.</li>
                  </ol>
                  <button type="button" disabled={busy} onClick={() => void disconnectTelegram()} className="mt-3 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-rose-700">
                    Отключить
                  </button>
                </div>
              ) : (
                <>
                  <p className="mt-1 text-xs text-slate-500">
                    Создайте бота через @BotFather и вставьте Bot Token. Код подтверждения боту не нужен: токен проверяется сразу. Бот не пишет человеку первым — клиент должен написать боту или написать вам, если бот подключён в Telegram Business.
                  </p>
                  <input
                    type="password"
                    autoComplete="off"
                    className={fieldClass}
                    value={telegramToken}
                    onChange={(event) => setTelegramToken(event.target.value)}
                    placeholder="123456789:AA..."
                  />
                  <button type="button" disabled={busy || !telegramToken.trim()} onClick={() => void connectTelegram()} className="mt-2 rounded-xl bg-sky-600 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-200">
                    Проверить и подключить
                  </button>
                </>
              )}
            </div>

            <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="font-medium text-slate-900">Интервал исходящих Telegram</h3>
              <p className="mt-1 text-xs text-slate-500">
                Пауза между отправками из очереди этого навыка (бот и аккаунт). Например 300 = раз в 5 минут.
              </p>
              <label className="mt-2 block text-sm text-slate-600">
                Секунды
                <input
                  type="number"
                  min={10}
                  max={86400}
                  className={fieldClass}
                  value={draft.telegramSendIntervalSeconds ?? 300}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      telegramSendIntervalSeconds: Number(event.target.value) || 300,
                    })
                  }
                />
              </label>
            </div>

            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <h3 className="font-medium text-slate-900">Рабочий Telegram-аккаунт</h3>
              <p className="mt-1 text-xs text-amber-800">
                Экспериментальный MTProto-режим. Не используйте для спама: Telegram контролирует неофициальные клиенты и может ограничить аккаунт.
              </p>
              {telegramAccount?.status === "CONNECTED" ? (
                <div className="mt-3">
                  <p className="text-sm font-medium text-slate-800">
                    @{telegramAccount.username || telegramAccount.firstName} · {telegramAccount.phoneMasked}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Можно отвечать на входящие и создавать первый черновик для контакта с Telegram username.
                  </p>
                  <button type="button" disabled={busy} onClick={() => void disconnectTelegramAccount()} className="mt-3 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-rose-700">
                    Отключить аккаунт
                  </button>
                </div>
              ) : telegramAccount && ["CODE_REQUIRED", "PASSWORD_REQUIRED"].includes(telegramAccount.status) ? (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-slate-600">
                    {telegramAccount.delivery === "SMS"
                      ? `Код отправлен по SMS на ${telegramAccount.phoneMasked}.`
                      : `Сейчас Telegram выбрал доставку в приложение, не SMS. Откройте на телефоне (${telegramAccount.phoneMasked}) чат «Telegram» / «Notification» и возьмите код оттуда. Кнопка ниже запрашивает повтор — часто уже как SMS.`}
                  </p>
                  {telegramAccount.lastError && <p className="text-xs text-rose-600">{telegramAccount.lastError}</p>}
                  <input className={fieldClass} inputMode="numeric" value={accountAuth.code} onChange={(event) => setAccountAuth({ ...accountAuth, code: event.target.value })} placeholder="Код из Telegram или SMS" />
                  {telegramAccount.status === "PASSWORD_REQUIRED" && (
                    <input type="password" className={fieldClass} value={accountAuth.password} onChange={(event) => setAccountAuth({ ...accountAuth, password: event.target.value })} placeholder="Пароль двухэтапной аутентификации" />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy || !accountAuth.code.trim()} onClick={() => void verifyAccount()} className="rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-200">
                      Подтвердить вход
                    </button>
                    <button type="button" disabled={busy} onClick={() => void resendAccountCode()} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-amber-800">
                      {busy ? "Отправляем…" : "Отправить ещё раз (через SMS)"}
                    </button>
                    <button type="button" disabled={busy} onClick={() => void disconnectTelegramAccount()} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <details className="rounded-xl border border-amber-200 bg-white p-3 text-xs text-slate-600">
                    <summary className="cursor-pointer font-medium text-slate-800">Как создать Telegram API-приложение</summary>
                    <ol className="mt-2 list-decimal space-y-1 pl-5">
                      <li>Откройте <a className="text-violet-700 underline" href="https://my.telegram.org" target="_blank" rel="noreferrer">my.telegram.org</a> и войдите по номеру.</li>
                      <li>Выберите API development tools.</li>
                      <li>Укажите App title: Yani CRM, Short name: yanicrm, Platform: Web.</li>
                      <li>Скопируйте API ID и API Hash в поля ниже.</li>
                    </ol>
                  </details>
                  <input className={fieldClass} inputMode="numeric" value={accountAuth.apiId} onChange={(event) => setAccountAuth({ ...accountAuth, apiId: event.target.value })} placeholder="API ID" />
                  <input type="password" autoComplete="off" className={fieldClass} value={accountAuth.apiHash} onChange={(event) => setAccountAuth({ ...accountAuth, apiHash: event.target.value })} placeholder="API Hash" />
                  <input type="tel" className={fieldClass} value={accountAuth.phone} onChange={(event) => setAccountAuth({ ...accountAuth, phone: event.target.value })} placeholder="+375..." />
                  <button type="button" disabled={busy || !accountAuth.apiId || !accountAuth.apiHash || !accountAuth.phone} onClick={() => void startAccountAuth()} className="rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-200">
                    Получить код
                  </button>
                </div>
              )}
            </div>

            <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
              <div className="flex items-center gap-2">
                <Mail size={18} className="text-emerald-700" />
                <h3 className="font-medium text-slate-900">Email · IMAP/SMTP</h3>
              </div>
              {emailConnection ? (
                <div className="mt-3">
                  <p className="text-sm font-medium text-slate-800">{emailConnection.email} · {emailConnection.status}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {emailConnection.lastPolledAt
                      ? `Последняя проверка: ${new Date(emailConnection.lastPolledAt).toLocaleString("ru-RU")}`
                      : "Worker ещё не проверял входящие"}
                  </p>
                  {emailConnection.lastError && <p className="mt-2 text-xs text-rose-600">{emailConnection.lastError}</p>}
                  <button type="button" disabled={busy} onClick={() => void disconnectEmail()} className="mt-3 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-rose-700">
                    Отключить почту
                  </button>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-slate-600">Используйте отдельный пароль приложения, а не основной пароль почты.</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => applyEmailPreset("YANDEX")} className="rounded-lg border border-emerald-200 bg-white px-2 py-1 text-xs text-emerald-800">Яндекс</button>
                    <button type="button" onClick={() => applyEmailPreset("GMAIL")} className="rounded-lg border border-emerald-200 bg-white px-2 py-1 text-xs text-emerald-800">Gmail</button>
                    <button type="button" onClick={() => applyEmailPreset("MAILRU")} className="rounded-lg border border-emerald-200 bg-white px-2 py-1 text-xs text-emerald-800">Mail.ru</button>
                  </div>
                  <input type="email" className={fieldClass} value={emailDraft.email} onChange={(event) => setEmailDraft({ ...emailDraft, email: event.target.value, username: emailDraft.username || event.target.value })} placeholder="Адрес отправителя" />
                  <input className={fieldClass} value={emailDraft.username} onChange={(event) => setEmailDraft({ ...emailDraft, username: event.target.value })} placeholder="Логин IMAP/SMTP" />
                  <input type="password" autoComplete="new-password" className={fieldClass} value={emailDraft.password} onChange={(event) => setEmailDraft({ ...emailDraft, password: event.target.value })} placeholder="Пароль приложения" />
                  <div className="grid grid-cols-[1fr_90px] gap-2">
                    <input className={fieldClass} value={emailDraft.imapHost} onChange={(event) => setEmailDraft({ ...emailDraft, imapHost: event.target.value })} placeholder="IMAP сервер" />
                    <input type="number" className={fieldClass} value={emailDraft.imapPort} onChange={(event) => setEmailDraft({ ...emailDraft, imapPort: Number(event.target.value) })} placeholder="993" />
                    <input className={fieldClass} value={emailDraft.smtpHost} onChange={(event) => setEmailDraft({ ...emailDraft, smtpHost: event.target.value })} placeholder="SMTP сервер" />
                    <input type="number" className={fieldClass} value={emailDraft.smtpPort} onChange={(event) => setEmailDraft({ ...emailDraft, smtpPort: Number(event.target.value) })} placeholder="465" />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={emailDraft.imapSecure} onChange={(event) => setEmailDraft({ ...emailDraft, imapSecure: event.target.checked })} />
                    IMAP через TLS
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={emailDraft.smtpSecure} onChange={(event) => setEmailDraft({ ...emailDraft, smtpSecure: event.target.checked })} />
                    SMTP через TLS
                  </label>
                  <input className={fieldClass} value={emailDraft.fromName} onChange={(event) => setEmailDraft({ ...emailDraft, fromName: event.target.value })} placeholder="Имя отправителя" />
                  <textarea rows={3} className={fieldClass} value={emailDraft.signature} onChange={(event) => setEmailDraft({ ...emailDraft, signature: event.target.value })} placeholder="Подпись в письмах" />
                  <button type="button" disabled={busy || !emailDraft.email || !emailDraft.password || !emailDraft.imapHost || !emailDraft.smtpHost} onClick={() => void connectEmail()} className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-200">
                    Проверить и подключить
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
              <h3 className="font-medium text-slate-900">Материалы навыка</h3>
              <p className="mt-1 text-xs text-slate-500">
                DOCX/PDF/PPTX — база знаний (текст). Презентации, PDF и картинки агент может прислать клиенту файлом, если попросить в диалоге или указать имя / [[FILE:имя]].
              </p>
              <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50">
                <Upload size={16} />
                Загрузить файл
                <input
                  type="file"
                  className="sr-only"
                  accept=".docx,.pdf,.pptx,.png,.jpg,.jpeg,.webp,.gif,image/*"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>

            <div className="mt-3 space-y-2">
              {documents.map((document) => (
                <article key={document.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start gap-3">
                    {document.isImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={document.url}
                        alt={document.fileName}
                        className="h-12 w-12 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <FileText className="mt-0.5 shrink-0 text-violet-600" size={18} />
                    )}
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        if (document.isImage) {
                          setPreview({ fileName: document.fileName, text: `Картинка: ${document.url}` });
                          return;
                        }
                        void showPreview(document);
                      }}
                    >
                      <p className="truncate text-sm font-medium text-slate-900">{document.fileName}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {document.isImage ? (
                          <span className="inline-flex items-center gap-1">
                            <ImageIcon size={12} /> вложение · {Math.max(1, Math.round(document.sizeBytes / 1024))} КБ
                          </span>
                        ) : (
                          <>
                            обучение · {Math.max(1, Math.round(document.sizeBytes / 1024))} КБ ·{" "}
                            {document.textLength.toLocaleString("ru-RU")} символов
                            <span className="text-slate-400"> · можно приложить файлом, если указать имя в промпте</span>
                          </>
                        )}
                      </p>
                    </button>
                    <a
                      href={fileDownloadUrl(document.url, document.fileName)}
                      download={document.fileName}
                      aria-label={`Скачать ${document.fileName}`}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-violet-50 hover:text-violet-700"
                    >
                      <Download size={15} />
                    </a>
                    <button type="button" aria-label="Удалить документ" onClick={() => void remove(document)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))}
              {!documents.length && <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">Материалы ещё не загружены</p>}
            </div>

            {preview && (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="truncate text-sm font-medium text-slate-900">{preview.fileName}</h3>
                  <button type="button" aria-label="Закрыть предпросмотр" onClick={() => setPreview(null)}><X size={16} /></button>
                </div>
                {/\.(png|jpe?g|webp|gif)$/i.test(preview.fileName) || preview.text.startsWith("Картинка:") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={documents.find((item) => item.fileName === preview.fileName)?.url ?? ""}
                    alt={preview.fileName}
                    className="mt-3 max-h-80 w-full rounded-xl object-contain"
                  />
                ) : (
                  <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-slate-600">{preview.text}</pre>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
