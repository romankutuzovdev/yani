"use client";

import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { copyText } from "@/lib/copyText";

function sharedFromYani(answer: string) {
  const link = window.location.href.split("#")[0];
  return `${answer}\n\nПоделились из сервиса Yani\n${link}`;
}

export function ReplyActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const value = text.trim();
  if (!value) return null;

  return (
    <div className="mt-2 flex items-center gap-0.5">
      <button
        type="button"
        aria-label={copied ? "Скопировано" : "Скопировать"}
        title={copied ? "Скопировано" : "Скопировать"}
        className="rounded-lg p-1.5 text-slate-400 hover:bg-white/70 hover:text-slate-700"
        onClick={() => {
          void copyText(value).then((ok) => {
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check size={16} strokeWidth={2} /> : <Copy size={16} strokeWidth={2} />}
      </button>
      <button
        type="button"
        aria-label="Поделиться"
        title="Поделиться"
        className="rounded-lg p-1.5 text-slate-400 hover:bg-white/70 hover:text-slate-700"
        onClick={() => {
          const shared = sharedFromYani(value);
          const payload = { title: "Yani", text: shared };
          if (typeof navigator.share === "function") {
            void navigator.share(payload).catch((error: unknown) => {
              if (error instanceof DOMException && error.name === "AbortError") return;
              void copyText(shared);
            });
            return;
          }
          void copyText(shared);
        }}
      >
        <Share2 size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
