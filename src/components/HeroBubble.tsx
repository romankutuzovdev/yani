"use client";

import {
  agentStatusToCharacterState,
  isVideoAsset,
  normalizeAssetUrl,
  resolveCharacterAsset,
  type CharacterAssetView,
} from "@/characters/CharacterRenderer";
import { DEFAULT_HERO_ASSETS } from "@/characters/defaults";
import type { CharacterState } from "@prisma/client";
import { cn } from "@/lib/utils";
import { useKeepVideoPlaying } from "@/lib/useKeepVideoPlaying";
import { useEffect, useMemo, useRef, useState } from "react";

/** Compact circular hero for chat empty-state / header */
export function HeroBubble({
  name,
  assets,
  status,
  size = "lg",
  className,
}: {
  name: string;
  assets: CharacterAssetView[];
  status: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const state = agentStatusToCharacterState(status) as CharacterState;
  const effectiveAssets = useMemo(
    () => (assets?.length ? assets : (DEFAULT_HERO_ASSETS as CharacterAssetView[])),
    [assets],
  );
  const idle = resolveCharacterAsset(effectiveAssets, "IDLE");
  const live = resolveCharacterAsset(effectiveAssets, state);
  // Public chat bubble is a looping avatar: keep IDLE video, don't swap src on THINKING/WORKING.
  const asset = isVideoAsset(idle) ? idle : live;
  const video = isVideoAsset(asset);
  const primary = asset ? normalizeAssetUrl(asset.url) : "/characters/yani/idle.png";
  const [src, setSrc] = useState(primary);
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setFailed(false);
    setSrc(primary);
  }, [primary]);

  useKeepVideoPlaying(videoRef, video && !failed, src);

  const dim =
    size === "sm"
      ? "h-10 w-10"
      : size === "md"
        ? "h-20 w-20 sm:h-24 sm:w-24"
        : "h-28 w-28 sm:h-44 sm:w-44 md:h-52 md:w-52";

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full bg-yani-soft/80 ring-1 ring-yani-ring/60",
        dim,
        className,
      )}
      title={failed ? `Не загрузилось: ${src}` : name}
    >
      {!failed && src ? (
        video ? (
          <video
            ref={videoRef}
            key={src}
            src={src}
            className="absolute inset-0 h-full w-full object-contain"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            webkit-playsinline="true"
            aria-label={name}
            onError={() => {
              const el = videoRef.current;
              if (el?.dataset.heroReloading === "1") return;
              const tries = Number(el?.dataset.heroRetries || "0");
              // iOS PWA fires error when the decoder is dropped in background.
              if (el && tries < 4) {
                el.dataset.heroRetries = String(tries + 1);
                return;
              }
              setFailed(true);
            }}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src}
            src={src}
            alt={name}
            className="absolute inset-0 h-full w-full object-contain"
            onError={() => {
              if (src.endsWith(".png") && !src.includes("idle.png")) {
                setSrc("/characters/yani/idle.png");
                return;
              }
              if (src.endsWith(".png")) {
                setSrc(src.replace(/\.png$/i, ".jpg"));
                return;
              }
              if (/\.jpe?g$/i.test(src)) {
                setSrc(src.replace(/\.jpe?g$/i, ".png"));
                return;
              }
              setFailed(true);
            }}
          />
        )
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center bg-yani-soft text-yani-ink">
          <span className="text-3xl font-semibold">{name.slice(0, 1).toUpperCase()}</span>
        </div>
      )}
    </div>
  );
}
