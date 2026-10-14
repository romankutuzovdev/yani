"use client";

import { agentChatUrl } from "@/lib/chatLink";
import { copyText } from "@/lib/copyText";
import { useState } from "react";

export function AgentChatLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const clean = slug.trim();
  if (!clean) return null;
  const url = agentChatUrl(clean);

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="break-all text-violet-700 underline"
      >
        {url}
      </a>
      <button
        type="button"
        className="rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-xs font-medium text-violet-800 hover:bg-violet-50"
        onClick={() => {
          void copyText(url).then((ok) => {
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Скопировано" : "Скопировать"}
      </button>
    </div>
  );
}
