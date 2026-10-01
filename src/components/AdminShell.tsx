"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bot,
  ClipboardList,
  KeyRound,
  LayoutDashboard,
  Logs,
  Settings,
  Sparkles,
  Wrench,
  ListTodo,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Обзор", icon: LayoutDashboard },
  { href: "/admin/agents", label: "Агенты", icon: Bot },
  { href: "/admin/forms", label: "Формы", icon: ClipboardList },
  { href: "/admin/tasks", label: "Задачи", icon: ListTodo },
  { href: "/admin/skills", label: "Навыки", icon: Sparkles },
  { href: "/admin/tools", label: "Инструменты", icon: Wrench },
  { href: "/admin/api-keys", label: "API-ключи", icon: KeyRound },
  { href: "/admin/logs", label: "Логи", icon: Logs },
  { href: "/admin/settings", label: "Настройки", icon: Settings },
];

export function AdminShell({
  children,
  userName,
}: {
  children: React.ReactNode;
  userName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#f5f3ff_0%,_#fafafa_45%,_#ffffff_100%)] text-slate-800">
      <div className="mx-auto flex min-h-screen max-w-[1400px]">
        <aside className="hidden w-64 shrink-0 border-r border-violet-100 bg-white/70 p-5 backdrop-blur md:block">
          <div className="mb-8">
            <Link href="/admin" className="block px-1 py-1">
              <Image
                src="/brand/yani-logo.png"
                alt="YANI"
                width={140}
                height={48}
                className="h-9 w-auto object-contain"
                priority
              />
            </Link>
            <p className="mt-3 text-xs text-slate-500">Платформа AI-агентов</p>
          </div>
          <nav className="space-y-1">
            {NAV.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/admin" && pathname.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                    active
                      ? "bg-violet-100 font-medium text-violet-800"
                      : "text-slate-600 hover:bg-violet-50 hover:text-slate-900",
                  )}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-10 space-y-2 border-t border-violet-100 pt-4 text-xs text-slate-500">
            <p className="text-slate-700">{userName}</p>
            <Link href="/chat" className="block text-violet-600 hover:underline">
              Открыть чат клиента
            </Link>
            <button onClick={logout} className="text-slate-500 hover:text-violet-700">
              Выйти
            </button>
          </div>
        </aside>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
