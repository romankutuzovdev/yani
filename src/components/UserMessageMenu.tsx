"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Pencil, Share2, Type } from "lucide-react";
import { copyText } from "@/lib/copyText";
import { cn } from "@/lib/utils";

function clearSelection() {
  const sel = window.getSelection();
  sel?.removeAllRanges();
}

function shareFromYani(text: string) {
  const link = window.location.href.split("#")[0];
  const shared = `${text}\n\nПоделились из сервиса Yani\n${link}`;
  const payload = { title: "Yani", text: shared };
  if (typeof navigator.share === "function") {
    void navigator.share(payload).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      void copyText(shared);
    });
    return;
  }
  void copyText(shared);
}

type Props = {
  text: string;
  canEdit: boolean;
  onEdit: () => void;
  children: ReactNode;
  className?: string;
};

/** Long-press on iOS: open only after finger lifts, menu above the touch — avoids native selection of "Копировать". */
export function UserMessageMenu({ text, canEdit, onEdit, children, className }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const armedRef = useRef(false);
  const pointRef = useRef({ x: 0, y: 0 });
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const value = text.trim();

  function clearTimer() {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function closeMenu() {
    armedRef.current = false;
    setOpen(false);
    clearSelection();
  }

  function openAt(clientX: number, clientY: number) {
    if (!value) return;
    clearSelection();
    const pad = 12;
    const menuW = 220;
    const menuH = canEdit ? 196 : 148;
    const x = Math.min(Math.max(pad, clientX - menuW / 2), window.innerWidth - menuW - pad);
    // Prefer above the finger so iOS selection / callout never lands on menu labels.
    let y = clientY - menuH - 16;
    if (y < pad) y = Math.min(clientY + 16, window.innerHeight - menuH - pad);
    setPos({ x, y });
    setOpen(true);
  }

  function selectText() {
    const node = contentRef.current;
    if (!node) return;
    node.style.webkitUserSelect = "text";
    node.style.userSelect = "text";
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  useEffect(() => {
    if (!open) return;
    clearSelection();
    const close = () => closeMenu();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => () => clearTimer(), []);

  const items = [
    {
      key: "copy",
      label: "Копировать",
      icon: Copy,
      onClick: () => {
        clearSelection();
        void copyText(value);
      },
    },
    {
      key: "select",
      label: "Выбрать текст",
      icon: Type,
      onClick: selectText,
    },
    ...(canEdit
      ? [
          {
            key: "edit",
            label: "Редактировать",
            icon: Pencil,
            onClick: onEdit,
          },
        ]
      : []),
    {
      key: "share",
      label: "Поделиться",
      icon: Share2,
      onClick: () => {
        clearSelection();
        shareFromYani(value);
      },
    },
  ];

  return (
    <>
      <div
        className={cn(
          className,
          "select-none touch-manipulation [-webkit-touch-callout:none] [-webkit-user-select:none] [user-select:none]",
        )}
        style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
        onContextMenu={(e) => {
          e.preventDefault();
          openAt(e.clientX, e.clientY);
        }}
        onTouchStart={(e) => {
          if (e.touches.length !== 1) return;
          const touch = e.touches[0];
          armedRef.current = false;
          pointRef.current = { x: touch.clientX, y: touch.clientY };
          clearTimer();
          clearSelection();
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            armedRef.current = true;
            clearSelection();
            if (typeof navigator.vibrate === "function") navigator.vibrate(12);
          }, 480);
        }}
        onTouchMove={(e) => {
          if (!timerRef.current && !armedRef.current) return;
          const touch = e.touches[0];
          if (!touch) return;
          const dx = touch.clientX - pointRef.current.x;
          const dy = touch.clientY - pointRef.current.y;
          if (dx * dx + dy * dy > 100) {
            armedRef.current = false;
            clearTimer();
          }
        }}
        onTouchEnd={(e) => {
          clearTimer();
          if (!armedRef.current) return;
          armedRef.current = false;
          e.preventDefault();
          clearSelection();
          openAt(pointRef.current.x, pointRef.current.y);
        }}
        onTouchCancel={() => {
          armedRef.current = false;
          clearTimer();
        }}
      >
        <div
          ref={contentRef}
          className="select-none [-webkit-user-select:none] [user-select:none]"
          style={{ WebkitUserSelect: "none", userSelect: "none" }}
        >
          {children}
        </div>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-[80] select-none [-webkit-touch-callout:none] [-webkit-user-select:none] [user-select:none]"
          style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
          onClick={closeMenu}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            role="menu"
            className="absolute min-w-[200px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white py-1.5 shadow-[0_12px_40px_rgba(15,23,42,0.16)] select-none [-webkit-user-select:none] [user-select:none]"
            style={{
              left: pos.x,
              top: pos.y,
              WebkitUserSelect: "none",
              userSelect: "none",
              WebkitTouchCallout: "none",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                tabIndex={0}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-slate-800 select-none [-webkit-user-select:none] [user-select:none] hover:bg-slate-50 active:bg-slate-100"
                style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
                onClick={() => {
                  closeMenu();
                  item.onClick();
                }}
              >
                <item.icon size={18} strokeWidth={2} className="pointer-events-none shrink-0 text-slate-500" aria-hidden />
                <span className="pointer-events-none" aria-hidden={false}>
                  {item.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
