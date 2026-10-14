"use client";

import { Home, Info, Share, Smartphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function inFrame() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function installedAlready() {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

function isIos() {
  const ua = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function InstallAppButton({
  slug,
  name,
  iconUrl,
}: {
  slug: string;
  name: string;
  iconUrl: string;
}) {
  const [visible, setVisible] = useState(false);
  const [guide, setGuide] = useState<"ios" | "other" | null>(null);
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const icon = iconUrl || "/characters/yani/idle.png";

  useEffect(() => {
    if (inFrame() || installedAlready()) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const applyLinks = () => {
      let manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (!manifest) {
        manifest = document.createElement("link");
        manifest.rel = "manifest";
        document.head.appendChild(manifest);
      }
      manifest.href = `/api/pwa/${encodeURIComponent(slug)}`;
      const apples = document.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]');
      if (apples.length === 0) {
        const apple = document.createElement("link");
        apple.rel = "apple-touch-icon";
        apple.href = icon;
        document.head.appendChild(apple);
      } else {
        apples.forEach((apple) => {
          apple.href = icon;
        });
      }
    };
    applyLinks();
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      promptRef.current = event as BeforeInstallPromptEvent;
    };
    const onInstalled = () => setVisible(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [slug, icon]);

  if (!visible) return null;

  async function install() {
    const prompt = promptRef.current;
    if (prompt) {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      promptRef.current = null;
      if (choice.outcome === "accepted") setVisible(false);
      return;
    }
    setGuide(isIos() ? "ios" : "other");
  }

  return (
    <div className="relative md:hidden">
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-yani-btn bg-transparent px-4 text-[11px] font-medium leading-none !text-slate-900"
        aria-label="Приложение"
      >
        <Smartphone size={14} strokeWidth={2} />
        Приложение
      </button>
      {guide ? <InstallGuide name={name} icon={icon} ios={guide === "ios"} onClose={() => setGuide(null)} /> : null}
    </div>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-yani-deep text-sm font-semibold text-white">
      {n}
    </span>
  );
}

function InstallGuide({
  name,
  icon,
  ios,
  onClose,
}: {
  name: string;
  icon: string;
  ios: boolean;
  onClose: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-[28px] bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2.5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-guide-title"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300" />
        <div className="flex items-center gap-3 rounded-2xl border border-yani-ring/50 bg-gradient-to-r from-yani-soft to-white px-3 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon} alt="" className="h-14 w-14 rounded-[18px] object-cover shadow-sm" />
          <div className="min-w-0">
            <p id="install-guide-title" className="truncate text-[17px] font-semibold leading-tight text-slate-900">
              {name || "Yani"}
            </p>
            <p className="mt-0.5 text-sm text-slate-500">Добавить на экран Домой</p>
          </div>
        </div>
        {ios ? (
          <ol className="mt-3 space-y-2">
            <li className="flex items-center gap-3 rounded-2xl bg-[#f2f2f7] px-3 py-3">
              <StepBadge n={1} />
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[#0a84ff] text-white">
                <Share size={16} />
              </span>
              <p className="min-w-0 flex-1 text-[15px] leading-snug text-slate-900">
                Нажмите кнопку «Поделиться» внизу
                <br />
                Safari
              </p>
            </li>
            <li className="flex items-center gap-3 rounded-2xl bg-[#f2f2f7] px-3 py-3">
              <StepBadge n={2} />
              <p className="min-w-0 flex-1 text-[15px] leading-snug text-slate-900">
                Прокрутите список и выберите «На экран Домой»
              </p>
              <Home size={18} className="shrink-0 text-slate-500" />
            </li>
            <li className="flex items-center gap-3 rounded-2xl bg-[#f2f2f7] px-3 py-3">
              <StepBadge n={3} />
              <p className="min-w-0 flex-1 text-[15px] leading-snug text-slate-900">
                Нажмите «Добавить» в правом верхнем углу
              </p>
            </li>
          </ol>
        ) : (
          <ol className="mt-3 space-y-2">
            {[
              "Откройте меню браузера (три точки или «Поделиться»)",
              "Выберите «Установить приложение» или «На экран Домой»",
              "Подтвердите добавление",
            ].map((text, index) => (
              <li key={text} className="flex items-center gap-3 rounded-2xl bg-[#f2f2f7] px-3 py-3">
                <StepBadge n={index + 1} />
                <p className="min-w-0 flex-1 text-[15px] leading-snug text-slate-900">{text}</p>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 flex items-start gap-2 px-1 text-[13px] leading-relaxed text-slate-400">
          <Info size={15} className="mt-0.5 shrink-0" />
          {ios
            ? "Кнопка «Поделиться» — в нижней панели браузера Safari."
            : "Пункт может называться «Установить приложение» или «Добавить на главный экран»."}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-full bg-yani-deep py-3.5 text-base font-semibold text-white"
        >
          Понятно!
        </button>
      </div>
    </div>,
    document.body,
  );
}
