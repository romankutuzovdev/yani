"use client";

import { useEffect, type RefObject } from "react";

/** Resume muted looping hero videos after the phone app is backgrounded. */
export function useKeepVideoPlaying(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    const el = videoRef.current;
    if (!el) return;

    function resume() {
      if (document.visibilityState === "hidden") return;
      const video = videoRef.current;
      if (!video) return;
      if (!video.paused && !video.ended) return;
      void video.play().catch(() => undefined);
    }

    resume();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("focus", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("focus", resume);
    };
  }, [enabled, videoRef]);
}
