"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type ListRow = {
  id: string;
  name: string;
  channel: "EMAIL" | "TELEGRAM";
  _count?: { contacts: number };
};

type Contact = {
  id: string;
  displayName: string;
  company: string;
  email: string;
  phone: string;
  telegram: string;
  notes: string;
};

const fieldClass =
  "mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100";

type Props = {
  agentId: string;
  playbookId: string;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onNotice: (message: string) => void;
};

export function SalesCrmContacts({ agentId, playbookId, busy, setBusy, onNotice }: Props) {
  const [lists, setLists] = useState<ListRow[]>([]);
  const [channelFilter, setChannelFilter] = useState<"ALL" | "EMAIL" | "TELEGRAM">("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [newListName, setNewListName] = useState("");
  const [newListChannel, setNewListChannel] = useState<"EMAIL" | "TELEGRAM">("EMAIL");
  const [rename, setRename] = useState("");
  const [draft, setDraft] = useState({
    displayName: "",
    company: "",
    email: "",
    phone: "",
    telegram: "",
    notes: "",
  });

  const selected = lists.find((list) => list.id === selectedId) ?? null;
  const visibleLists =
    channelFilter === "ALL" ? lists : lists.filter((list) => list.channel === channelFilter);

  async function loadLists() {
    try {
      const res = await fetch(`/api/crm/playbooks/${playbookId}/contact-lists?agentId=${agentId}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setLists(data.lists ?? []);
    } catch {
      /* offline */
    }
  }

  async function loadContacts(listId: string) {
    try {
      const res = await fetch(`/api/crm/contact-lists/${listId}?agentId=${agentId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onNotice(data.error ?? "Не удалось загрузить контакты");
        return;
      }
      setContacts(data.contacts ?? []);
      setRename(data.list?.name ?? "");
      setSelectedContactIds(new Set());
    } catch {
      onNotice("Сервер CRM недоступен");
    }
  }

  useEffect(() => {
    void loadLists();
  }, [agentId, playbookId]);

  useEffect(() => {
    if (!selectedId) {
      setContacts([]);
      return;
    }
    void loadContacts(selectedId);
  }, [selectedId, agentId]);

  async function createList() {
    if (!newListName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/playbooks/${playbookId}/contact-lists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          name: newListName.trim(),
          channel: newListChannel,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onNotice(data.error ?? "Список не создан");
        return;
      }
      setNewListName("");
      await loadLists();
      setSelectedId(data.list.id);
      onNotice(`Список «${data.list.name}» создан`);
    } finally {
      setBusy(false);
    }
  }

  async function saveRename() {
    if (!selectedId || !rename.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/contact-lists/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, name: rename.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onNotice(data.error ?? "Не удалось переименовать");
        return;
      }
      await loadLists();
      onNotice("Название сохранено");
    } finally {
      setBusy(false);
    }
  }

  async function deleteList() {
    if (!selectedId || !selected) return;
    if (!window.confirm(`Удалить список «${selected.name}» и все контакты в нём?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/contact-lists/${selectedId}?agentId=${agentId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onNotice(data.error ?? "Не удалось удалить список");
        return;
      }
      setSelectedId(null);
      await loadLists();
      onNotice("Список удалён");
    } finally {
      setBusy(false);
    }
  }

  async function addContact() {
    if (!selectedId || !selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/contact-lists/${selectedId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, contacts: [draft] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onNotice(data.error ?? "Контакт не добавлен");
        return;
      }
      if (!data.created) {
        onNotice(data.skipped ? "Дубль или пустой контакт" : "Контакт не добавлен");
        return;
      }
      setDraft({ displayName: "", company: "", email: "", phone: "", telegram: "", notes: "" });
      await loadContacts(selectedId);
      await loadLists();
      onNotice("Контакт добавлен");
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File | null) {
    if (!file || !selectedId) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("agentId", agentId);
      form.set("file", file);
      const res = await fetch(`/api/crm/contact-lists/${selectedId}/contacts`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onNotice(data.error ?? "Импорт в список не удался");
        return;
      }
      await loadContacts(selectedId);
      await loadLists();
      onNotice(`В список: +${data.created}, пропущено ${data.skipped}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelectedContacts() {
    if (!selectedId || !selectedContactIds.size) return;
    if (!window.confirm(`Удалить контактов: ${selectedContactIds.size}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/contact-lists/${selectedId}/contacts`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          contactIds: [...selectedContactIds],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onNotice(data.error ?? "Не удалось удалить");
        return;
      }
      await loadContacts(selectedId);
      await loadLists();
      onNotice(`Удалено: ${data.deleted}`);
    } finally {
      setBusy(false);
    }
  }

  function toggleContact(id: string) {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedContactIds.size === contacts.length) {
      setSelectedContactIds(new Set());
      return;
    }
    setSelectedContactIds(new Set(contacts.map((contact) => contact.id)));
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: "ALL" as const, label: "Все" },
            { id: "EMAIL" as const, label: "Email" },
            { id: "TELEGRAM" as const, label: "Telegram" },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setChannelFilter(item.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium",
              channelFilter === item.id
                ? "bg-violet-600 text-white"
                : "border border-slate-200 text-slate-600 hover:bg-slate-50",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <input
          className={fieldClass}
          placeholder="Название списка"
          value={newListName}
          onChange={(e) => setNewListName(e.target.value)}
        />
        <select
          className={fieldClass}
          value={newListChannel}
          onChange={(e) => setNewListChannel(e.target.value as "EMAIL" | "TELEGRAM")}
          aria-label="Канал списка"
        >
          <option value="EMAIL">Email</option>
          <option value="TELEGRAM">Telegram</option>
        </select>
        <button
          type="button"
          disabled={busy || !newListName.trim()}
          onClick={() => void createList()}
          className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-3 text-sm font-medium text-white disabled:bg-slate-200"
        >
          <Plus size={16} /> Создать
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <ul className="max-h-80 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
          {!visibleLists.length && (
            <li className="px-2 py-6 text-center text-sm text-slate-400">Списков пока нет</li>
          )}
          {visibleLists.map((list) => (
            <li key={list.id}>
              <button
                type="button"
                onClick={() => setSelectedId(list.id)}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-left text-sm",
                  selectedId === list.id ? "bg-violet-100 text-violet-900" : "hover:bg-slate-50",
                )}
              >
                <span className="font-medium">{list.name}</span>
                <span className="mt-0.5 block text-[11px] text-slate-500">
                  {list.channel === "EMAIL" ? "Email" : "Telegram"} · {list._count?.contacts ?? 0}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="min-w-0 space-y-4">
          {!selected ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">
              Выберите список или создайте новый
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[12rem] flex-1 text-sm text-slate-600">
                  Название
                  <input
                    className={fieldClass}
                    value={rename}
                    onChange={(e) => setRename(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveRename()}
                  className="rounded-xl border border-violet-200 px-3 py-2 text-sm text-violet-700"
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void deleteList()}
                  className="rounded-xl border border-rose-200 px-3 py-2 text-sm text-rose-700"
                >
                  Удалить список
                </button>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-violet-200 px-3 py-2 text-sm text-violet-700">
                  <Upload size={15} />
                  CSV/XLSX
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    disabled={busy}
                    onChange={(e) => void importFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  className={fieldClass}
                  placeholder="Имя"
                  value={draft.displayName}
                  onChange={(e) => setDraft((d) => ({ ...d, displayName: e.target.value }))}
                />
                <input
                  className={fieldClass}
                  placeholder="Компания"
                  value={draft.company}
                  onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))}
                />
                {selected.channel === "EMAIL" ? (
                  <input
                    className={fieldClass}
                    placeholder="Email *"
                    value={draft.email}
                    onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                  />
                ) : (
                  <input
                    className={fieldClass}
                    placeholder="@telegram *"
                    value={draft.telegram}
                    onChange={(e) => setDraft((d) => ({ ...d, telegram: e.target.value }))}
                  />
                )}
                <input
                  className={fieldClass}
                  placeholder="Телефон"
                  value={draft.phone}
                  onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                />
                <input
                  className={cn(fieldClass, "sm:col-span-2")}
                  placeholder="Заметки"
                  value={draft.notes}
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                />
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void addContact()}
                className="rounded-xl bg-violet-600 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-200"
              >
                Добавить контакт
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600"
                >
                  {selectedContactIds.size === contacts.length && contacts.length
                    ? "Снять все"
                    : "Выбрать все"}
                </button>
                <button
                  type="button"
                  disabled={busy || !selectedContactIds.size}
                  onClick={() => void deleteSelectedContacts()}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs text-rose-700 disabled:opacity-40"
                >
                  <Trash2 size={13} />
                  Удалить выбранные ({selectedContactIds.size})
                </button>
              </div>

              <div className="max-h-72 overflow-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-left text-xs text-slate-600">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 w-8" />
                      <th className="px-3 py-2">Имя</th>
                      <th className="px-3 py-2">
                        {selected.channel === "EMAIL" ? "Email" : "Telegram"}
                      </th>
                      <th className="px-3 py-2">Компания</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!contacts.length && (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                          В списке пока пусто
                        </td>
                      </tr>
                    )}
                    {contacts.map((contact) => (
                      <tr key={contact.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedContactIds.has(contact.id)}
                            onChange={() => toggleContact(contact.id)}
                            aria-label="Выбрать контакт"
                          />
                        </td>
                        <td className="px-3 py-2">{contact.displayName || "—"}</td>
                        <td className="px-3 py-2">
                          {selected.channel === "EMAIL"
                            ? contact.email || "—"
                            : contact.telegram || "—"}
                        </td>
                        <td className="px-3 py-2">{contact.company || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
