"use client";

import {
  agentStatusToCharacterState,
  isVideoAsset,
  normalizeAssetUrl,
  resolveCharacterAsset,
  type CharacterAssetView,
} from "@/characters/CharacterRenderer";
import type { CharacterState } from "@prisma/client";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

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
  const asset = resolveCharacterAsset(assets, state);
  const video = isVideoAsset(asset);
  const primary = asset ? normalizeAssetUrl(asset.url) : "";
  const [src, setSrc] = useState(primary);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setSrc(asset ? normalizeAssetUrl(asset.url) : "");
  }, [asset?.url]);

  useEffect(() => {
    if (!video) return;
    void videoRef.current?.play().catch(() => undefined);
  }, [video, src]);

  const dim =
    size === "sm" ? "h-10 w-10" : size === "md" ? "h-24 w-24" : "h-40 w-40 sm:h-48 sm:w-48";

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full bg-transparent",
        dim,
        className,
      )}
    >
      {asset && src ? (
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
            aria-label={name}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src}
            src={src}
            alt={name}
            className="absolute inset-0 h-full w-full object-contain"
            onError={() => {
              if (src.endsWith(".png")) setSrc(src.replace(/\.png$/i, ".jpg"));
              else if (/\.jpe?g$/i.test(src)) setSrc(src.replace(/\.jpe?g$/i, ".png"));
            }}
          />
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-sky-50 text-2xl font-semibold text-sky-600">
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}
    </div>
  );
}
