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

function isStoredVideo(asset: { url: string; type?: string; mimeType?: string }) {
  if (asset.type === "VIDEO") return true;
  if (asset.mimeType?.startsWith("video/")) return true;
  return /\.(webm|mp4|ogv|ogg)(\?|$)/i.test(asset.url);
}

/** Fill missing hero media. Leave stored mp4/webm URLs and video mime types as they are. */
export function withDefaultHeroAssets<
  T extends { state: string; url: string; type?: string; mimeType?: string },
>(assets: T[] | null | undefined) {
  const list = assets ?? [];
  if (list.length > 0) {
    return list.map((asset) => {
      if (isStoredVideo(asset)) return asset;
      return {
        ...asset,
        url: asset.url.replace(/\.jpe?g$/i, ".png"),
        mimeType: asset.mimeType || "image/png",
      };
    });
  }
  return DEFAULT_HERO_ASSETS;
}
