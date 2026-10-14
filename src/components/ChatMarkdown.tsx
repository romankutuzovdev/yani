"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type Variant = "assistant" | "user";

function httpUrl(href?: string): string | undefined {
  if (!href) return undefined;
  try {
    const parsed = new URL(href);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return href;
  } catch {
    return undefined;
  }
  return undefined;
}

export function ChatMarkdown({
  text,
  variant = "assistant",
  className,
}: {
  text: string;
  variant?: Variant;
  className?: string;
}) {
  const user = variant === "user";
  const heading = user ? "font-semibold text-white" : "font-semibold text-slate-900";
  const link = user
    ? "underline decoration-white/50 underline-offset-2 hover:decoration-white"
    : "text-yani-deep underline decoration-yani-ring underline-offset-2 hover:text-yani-mid";
  const inlineCode = user
    ? "rounded bg-white/15 px-1 py-0.5 font-mono text-[0.9em]"
    : "rounded bg-slate-50 px-1 py-0.5 font-mono text-[0.9em] text-slate-800";
  const pre = user
    ? "my-2 max-w-full overflow-x-auto rounded-lg bg-white/10 p-2.5 font-mono text-[13px] leading-snug"
    : "my-2 max-w-full overflow-x-auto rounded-lg bg-slate-50 p-2.5 font-mono text-[13px] leading-snug text-slate-800";
  const th = user
    ? "border border-white/30 bg-white/10 px-2 py-1 font-medium"
    : "border border-yani-ring/70 bg-yani-soft/50 px-2 py-1 font-medium text-slate-900";
  const td = user
    ? "border border-white/25 px-2 py-1"
    : "border border-yani-ring/60 px-2 py-1";

  const components: Components = {
    h1: ({ children }) => (
      <h2 className={cn("mb-1.5 mt-2 text-[1.05em] leading-snug", heading)}>{children}</h2>
    ),
    h2: ({ children }) => (
      <h2 className={cn("mb-1.5 mt-2 text-[1.05em] leading-snug", heading)}>{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className={cn("mb-1 mt-2 text-[1em] leading-snug", heading)}>{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className={cn("mb-1 mt-1.5 text-[0.95em] leading-snug", heading)}>{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className={cn("mb-1 mt-1.5 text-[0.95em]", heading)}>{children}</h5>
    ),
    h6: ({ children }) => (
      <h6 className={cn("mb-1 mt-1.5 text-[0.95em]", heading)}>{children}</h6>
    ),
    p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => (
      <ul className="my-1.5 list-disc space-y-0.5 pl-5 marker:text-current">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-1.5 list-decimal space-y-0.5 pl-5 marker:text-current">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    strong: ({ children }) => (
      <strong className={cn("font-semibold", user ? "text-white" : "text-slate-900")}>{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => <del className="line-through opacity-80">{children}</del>,
    a: ({ href, children }) => {
      const safe = httpUrl(href);
      if (!safe) return <span>{children}</span>;
      return (
        <a href={safe} target="_blank" rel="noreferrer" className={link}>
          {children}
        </a>
      );
    },
    code: ({ className: codeClass, children }) => {
      if (codeClass) {
        return <code className={codeClass}>{children}</code>;
      }
      return <code className={inlineCode}>{children}</code>;
    },
    pre: ({ children }) => <pre className={pre}>{children}</pre>,
    table: ({ children }) => (
      <div className="my-2 max-w-full overflow-x-auto">
        <table className="w-auto max-w-full border-collapse text-left text-[13px] leading-snug">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => <thead>{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr>{children}</tr>,
    th: ({ children }) => <th className={th}>{children}</th>,
    td: ({ children }) => <td className={td}>{children}</td>,
    blockquote: ({ children }) => (
      <blockquote className={cn("my-1.5 border-l-2 pl-3", user ? "border-white/40" : "border-yani-ring")}>
        {children}
      </blockquote>
    ),
    hr: () => <hr className={cn("my-2", user ? "border-white/20" : "border-yani-ring/50")} />,
    img: () => null,
  };

  return (
    <div className={cn("break-words [overflow-wrap:anywhere]", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => httpUrl(url) ?? ""}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
