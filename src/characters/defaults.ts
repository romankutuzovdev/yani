import type { CharacterState } from "@prisma/client";

export const DEFAULT_HERO_PACK = "yani";

export const DEFAULT_HERO_ASSETS: Array<{
  state: CharacterState;
  type: "IMAGE";
  url: string;
  mimeType: string;
}> = [
  "IDLE",
  "THINKING",
  "WORKING",
  "SUCCESS",
  "ERROR",
  "SPEAKING",
  "WAITING",
  "SAD",
  "ANGRY",
].map((state) => ({
  state: state as CharacterState,
  type: "IMAGE" as const,
  url: `/characters/${DEFAULT_HERO_PACK}/${state.toLowerCase()}.png`,
  mimeType: "image/png",
}));

/** Merge DB assets with defaults so hero always has something to show */
export function withDefaultHeroAssets<
  T extends { state: string; url: string; type?: string; mimeType?: string },
>(assets: T[] | null | undefined) {
  const list = assets ?? [];
  if (list.length > 0) {
    return list.map((a) => ({
      ...a,
      url: a.url.replace(/\.jpe?g$/i, ".png"),
      mimeType: a.mimeType?.startsWith("video/") ? a.mimeType : a.mimeType || "image/png",
    }));
  }
  return DEFAULT_HERO_ASSETS;
}
