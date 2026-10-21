"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileText, Mail, MessageCircle, Trash2, Upload, X } from "lucide-react";

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
};

type SalesDocument = {
  id: string;
  fileName: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  textLength: number;
  textPreview: string;
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
  onNotice,
}: {
  playbook: PlaybookSetup;
  agentId: string;
  onClose: () => void;
  onSaved: (playbook: PlaybookSetup) => void;
  onNotice: (message: string) => void;
}) {
  const [draft, setDraft] = useState(playbook);
  const [documents, setDocuments] = useState<SalesDocument[]>([]);
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
    void loadDocuments();
    void loadTelegram();
    void loadTelegramAccount();
    void loadEmail();
    // playbook.id and agentId identify this modal instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbook.id, agentId]);

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
        data.connection.delivery === "SMS" || !data.connection.codeViaApp
          ? "Код отправлен по SMS"
          : "Код отправлен внутри Telegram: откройте чат «Telegram» на телефоне, где этот номер уже вошёл. Это не SMS.",
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
            <button type="button" disabled={busy || !draft.name.trim()} onClick={() => void save()} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white disabled:bg-slate-200">
              Сохранить настройки
            </button>
          </div>

          <div>
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
                      : `Код обычно приходит не SMS, а в приложение Telegram: откройте чат «Telegram» / «Notification» на телефоне, где ${telegramAccount.phoneMasked} уже вошёл.`}
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
              <p className="mt-1 text-xs text-slate-500">DOCX, PDF или PPTX, до 15 МБ. Ответы будут основаны только на этих материалах.</p>
              <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50">
                <Upload size={16} />
                Загрузить документ
                <input
                  type="file"
                  className="sr-only"
                  accept=".docx,.pdf,.pptx"
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
                    <FileText className="mt-0.5 shrink-0 text-violet-600" size={18} />
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void showPreview(document)}>
                      <p className="truncate text-sm font-medium text-slate-900">{document.fileName}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {Math.max(1, Math.round(document.sizeBytes / 1024))} КБ · {document.textLength.toLocaleString("ru-RU")} символов
                      </p>
                    </button>
                    <a href={document.url} target="_blank" rel="noreferrer" aria-label="Открыть исходный файл" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-violet-700">
                      <ExternalLink size={15} />
                    </a>
                    <button type="button" aria-label="Удалить документ" onClick={() => void remove(document)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))}
              {!documents.length && <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">Документы ещё не загружены</p>}
            </div>

            {preview && (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="truncate text-sm font-medium text-slate-900">{preview.fileName}</h3>
                  <button type="button" aria-label="Закрыть предпросмотр" onClick={() => setPreview(null)}><X size={16} /></button>
                </div>
                <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-slate-600">{preview.text}</pre>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
