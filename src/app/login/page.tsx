"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@yani.by");
  const [password, setPassword] = useState("admin123456");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Ошибка входа");
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_#f5f3ff_0%,_#ffffff_60%)] px-4 text-slate-800">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-3xl border border-violet-100 bg-white p-8 shadow-lg"
      >
        <div className="flex flex-col items-center text-center">
          <Image
            src="/brand/yani-logo.png"
            alt="YANI"
            width={160}
            height={56}
            className="h-12 w-auto object-contain"
            priority
          />
          <p className="mt-4 text-sm text-slate-500">Вход в админ-панель</p>
        </div>
        <label className="mt-8 block text-sm text-slate-700">
          Email
          <input
            className="mt-2 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-4 py-3 outline-none focus:border-violet-400"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
          />
        </label>
        <label className="mt-4 block text-sm text-slate-700">
          Пароль
          <input
            className="mt-2 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-4 py-3 outline-none focus:border-violet-400"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
          />
        </label>
        {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}
        <button
          disabled={loading}
          className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 font-medium text-white transition hover:bg-violet-500 disabled:opacity-60"
        >
          {loading ? "Входим…" : "Войти"}
        </button>
        <Link href="/chat" className="mt-4 block text-center text-sm text-violet-600 hover:underline">
          Вернуться в чат
        </Link>
      </form>
    </div>
  );
}
