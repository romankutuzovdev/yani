"use client";

import { useEffect, useRef, useState } from "react";
import {
  agentStatusToCharacterState,
  isVideoAsset,
  normalizeAssetUrl,
  resolveCharacterAsset,
  STATE_LABELS,
  type CharacterAssetView,
} from "@/characters/CharacterRenderer";
import type { CharacterState } from "@prisma/client";
import { cn } from "@/lib/utils";

function CharacterMedia({
  asset,
  name,
  state,
}: {
  asset: CharacterAssetView;
  name: string;
  state: CharacterState;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const video = isVideoAsset(asset);
  const primary = normalizeAssetUrl(asset.url);
  const [src, setSrc] = useState(primary);

  useEffect(() => {
    setSrc(normalizeAssetUrl(asset.url));
  }, [asset.url]);

  useEffect(() => {
    if (!video) return;
    const el = videoRef.current;
    if (!el) return;
    el.load();
    void el.play().catch(() => undefined);
  }, [video, src, state]);

  if (video) {
    return (
      <video
        ref={videoRef}
        key={src}
        src={src}
        className={cn(
          "absolute inset-0 h-full w-full object-contain transition-all duration-500",
          state === "WORKING" && "scale-105",
        )}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-label={`${name} — ${STATE_LABELS[state]}`}
      />
    );
  }

  return (
    // Use native img: more reliable for /public + /uploads than next/image fill
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src}
      alt={`${name} — ${STATE_LABELS[state]}`}
      className={cn(
        "absolute inset-0 h-full w-full object-contain transition-all duration-500",
        state === "THINKING" && "animate-pulse",
        state === "WORKING" && "scale-105",
        state === "SUCCESS" && "brightness-110",
        (state === "ERROR" || state === "SAD" || state === "ANGRY") && "grayscale-[15%]",
      )}
      onError={() => {
        if (src.endsWith(".png")) {
          setSrc(src.replace(/\.png$/i, ".jpg"));
        } else if (/\.jpe?g$/i.test(src)) {
          setSrc(src.replace(/\.jpe?g$/i, ".png"));
        }
      }}
    />
  );
}

export function CharacterStage({
  name,
  assets,
  status,
  statusMessage,
  previewState,
  className,
  variant = "light",
  compact = false,
}: {
  name: string;
  assets: CharacterAssetView[];
  status: string;
  statusMessage?: string;
  previewState?: CharacterState | null;
  className?: string;
  variant?: "light" | "dark";
  compact?: boolean;
}) {
  const liveState = agentStatusToCharacterState(status) as CharacterState;
  const state = previewState ?? liveState;
  const asset = resolveCharacterAsset(assets, state);
  const label = previewState
    ? STATE_LABELS[previewState]
    : statusMessage || STATE_LABELS[liveState];
  const light = variant === "light";

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden rounded-3xl border p-6 text-center shadow-sm",
        light
          ? "border-violet-100 bg-gradient-to-b from-violet-50 via-white to-violet-50/40"
          : "border-violet-400/15 bg-gradient-to-b from-[#1a1030] via-[#0b0614] to-black shadow-2xl",
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          light
            ? "bg-[radial-gradient(circle_at_50%_15%,rgba(167,139,250,0.18),transparent_55%)]"
            : "bg-[radial-gradient(circle_at_50%_20%,rgba(167,139,250,0.22),transparent_55%)]",
        )}
      />
      <div
        className={cn(
          "relative overflow-hidden rounded-full border bg-transparent",
          compact ? "mb-3 h-44 w-44" : "mb-4 h-56 w-56 md:h-64 md:w-64",
          light ? "border-violet-200/60" : "border-violet-300/20",
        )}
      >
        {asset ? (
          <CharacterMedia asset={asset} name={name} state={state} />
        ) : (
          <div
            className={cn(
              "flex h-full w-full items-center justify-center text-5xl font-semibold",
              light ? "bg-violet-100 text-violet-600" : "bg-violet-950 text-violet-200",
            )}
          >
            {name.slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>
      <h2
        className={cn(
          "relative font-semibold tracking-tight",
          compact ? "text-xl" : "text-2xl",
          light ? "text-slate-900" : "text-white",
        )}
      >
        {name}
      </h2>
      <p
        className={cn(
          "relative mt-2 text-sm tracking-[0.12em]",
          light ? "text-violet-600" : "uppercase text-violet-300/80",
        )}
      >
        {label}
      </p>
      <div className="relative mt-3 flex items-center gap-2">
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            (status === "ERROR" || state === "ANGRY") && "bg-rose-400",
            (status === "SUCCESS" || state === "SUCCESS") && "bg-emerald-400",
            status === "WORKING" && "animate-pulse bg-amber-400",
            status === "THINKING" && "animate-pulse bg-violet-400",
            state === "SAD" && "bg-sky-400",
            (status === "IDLE" || status === "ONLINE") && !previewState && "bg-emerald-400",
            status === "OFFLINE" && "bg-slate-400",
            previewState && "bg-violet-400",
          )}
        />
        <span className={cn("text-xs", light ? "text-slate-500" : "text-slate-400")}>
          {previewState ? `Превью · ${STATE_LABELS[previewState]}` : STATE_LABELS[liveState]}
          {asset && isVideoAsset(asset) ? " · видео" : ""}
        </span>
      </div>
    </div>
  );
}
