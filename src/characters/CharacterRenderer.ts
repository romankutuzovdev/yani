import type { CharacterState } from "@prisma/client";

export type CharacterAssetView = {
  state: CharacterState;
  type: string;
  url: string;
  mimeType: string;
};

export function isVideoAsset(asset: Pick<CharacterAssetView, "type" | "mimeType" | "url"> | null | undefined) {
  if (!asset) return false;
  if (asset.type === "VIDEO") return true;
  if (asset.mimeType?.startsWith("video/")) return true;
  return /\.(webm|mp4|ogv|ogg)(\?|$)/i.test(asset.url);
}

export interface CharacterRendererProps {
  assets: CharacterAssetView[];
  state: CharacterState;
  name: string;
  className?: string;
  statusMessage?: string;
}

export const ALL_CHARACTER_STATES: CharacterState[] = [
  "IDLE",
  "THINKING",
  "WORKING",
  "SUCCESS",
  "ERROR",
  "SPEAKING",
  "WAITING",
  "SAD",
  "ANGRY",
];

/** Abstraction for character presentation — swap implementation for Live2D/3D later */
export function resolveCharacterAsset(
  assets: CharacterAssetView[],
  state: CharacterState,
): CharacterAssetView | null {
  return (
    assets.find((a) => a.state === state) ??
    assets.find((a) => a.state === "IDLE") ??
    assets[0] ??
    null
  );
}

export const STATE_LABELS: Record<CharacterState, string> = {
  IDLE: "На месте",
  THINKING: "Думает…",
  WORKING: "Работает…",
  SUCCESS: "Готово",
  ERROR: "Ошибка",
  SPEAKING: "Отвечает…",
  WAITING: "Ждёт…",
  SAD: "Грустит",
  ANGRY: "Злится",
};

export function agentStatusToCharacterState(status: string): CharacterState {
  switch (status) {
    case "THINKING":
      return "THINKING";
    case "WORKING":
      return "WORKING";
    case "SUCCESS":
      return "SUCCESS";
    case "ERROR":
      return "ERROR";
    case "WAITING":
      return "WAITING";
    case "SPEAKING":
      return "SPEAKING";
    case "SAD":
      return "SAD";
    case "ANGRY":
      return "ANGRY";
    case "ONLINE":
    case "IDLE":
    case "OFFLINE":
    default:
      return "IDLE";
  }
}
