"use client";

import { useEffect, type RefObject } from "react";

const NEAR_END_SEC = 0.06;
const LEFT_START_SEC = 0.2;
/** Phone: rebuild decoder after this long in background. */
const MOBILE_HARD_AWAY_MS = 300;
const MOBILE_UNSEEN_MS = 5000;

function isIosDevice() {
  try {
    const ua = window.navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    // iPadOS reports as MacIntel with touch
    return window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1;
  } catch {
    return false;
  }
}

/**
 * Real phone/tablet only. Mac desktop and Mac installed PWA must stay soft —
 * hard src reload paints the tiny square after tab/app switch.
 */
function isPhoneClass() {
  try {
    if (isIosDevice()) return true;
    const ua = window.navigator.userAgent || "";
    if (/Android/i.test(ua)) return true;
    // Desktop Mac/Windows with trackpad: never hard-reload.
    if (/Macintosh|Windows|Linux/i.test(ua) && !/Mobile|Android/i.test(ua)) return false;
    return window.matchMedia("(pointer: coarse)").matches && window.navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

/**
 * Loop: seek to 0 only in the last ~0.06s (Mac Safari ignores native loop).
 *
 * Desktop Mac (Safari/Chrome/PWA): after tab switch ONLY pin the box + play().
 * Reloading src paints a tiny intrinsic square — never do that on desktop.
 *
 * iPhone / Android: after background, rebuild decoder with load().
 */
export function bindHeroVideo(video: HTMLVideoElement) {
  video.loop = true;
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");

  let wrapped = false;
  let hiddenAt = 0;
  let lastSeen = Date.now();
  let recoveries = 0;
  let recovering = false;
  const verifyTimers: number[] = [];
  const softTimers: number[] = [];

  const seenTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") lastSeen = Date.now();
  }, 1000);

  function circleSize() {
    const parent = video.parentElement;
    if (!parent) return 0;
    return Math.round(Math.min(parent.clientWidth, parent.clientHeight));
  }

  function boxIsTiny() {
    const size = circleSize();
    if (size < 8) return false;
    return video.clientWidth < size * 0.8 || video.clientHeight < size * 0.8;
  }

  function fillFrame() {
    if (document.visibilityState === "hidden") return;
    const size = circleSize();
    if (size < 8) return;
    const parent = video.parentElement;
    video.removeAttribute("width");
    video.removeAttribute("height");
    video.style.inset = "auto";
    video.style.right = "auto";
    video.style.bottom = "auto";
    video.style.margin = "0";
    video.style.transform = "none";
    video.style.setProperty("width", `${size}px`, "important");
    video.style.setProperty("height", `${size}px`, "important");
    video.style.setProperty("max-width", "none", "important");
    video.style.setProperty("max-height", "none", "important");
    video.style.setProperty("min-width", `${size}px`, "important");
    video.style.setProperty("min-height", `${size}px`, "important");
    video.style.setProperty("object-fit", "contain", "important");
    video.style.setProperty("object-position", "center center", "important");
    if (parent && getComputedStyle(parent).position !== "static") {
      video.style.position = "absolute";
      video.style.left = "0px";
      video.style.top = "0px";
    }
  }

  function kickLayer() {
    video.style.display = "none";
    void video.offsetWidth;
    video.style.display = "block";
    fillFrame();
  }

  function refillAfterShow() {
    if (document.visibilityState === "hidden") return;
    fillFrame();
    requestAnimationFrame(() => {
      fillFrame();
      if (boxIsTiny()) kickLayer();
    });
  }

  function clearVerify() {
    while (verifyTimers.length) {
      const id = verifyTimers.pop();
      if (id != null) window.clearTimeout(id);
    }
  }

  function clearSoft() {
    while (softTimers.length) {
      const id = softTimers.pop();
      if (id != null) window.clearTimeout(id);
    }
  }

  function rewindNearEnd() {
    const duration = video.duration;
    const time = video.currentTime;
    if (!Number.isFinite(duration) || duration <= 0.25) return;
    const remaining = duration - time;

    if (wrapped) {
      if (time > LEFT_START_SEC && remaining > 0.15) wrapped = false;
      return;
    }

    if (time <= LEFT_START_SEC) return;
    if (remaining > NEAR_END_SEC || remaining < -0.05) return;

    wrapped = true;
    try {
      video.currentTime = 0;
    } catch {
      wrapped = false;
      return;
    }
    void video.play().catch(() => undefined);
  }

  function onEnded() {
    wrapped = true;
    try {
      video.currentTime = 0;
    } catch {
      /* metadata may not be ready */
    }
    void video.play().catch(() => undefined);
  }

  function looksAlive() {
    return (
      !video.paused &&
      !video.ended &&
      video.readyState >= 2 &&
      video.videoWidth > 0 &&
      video.networkState !== HTMLMediaElement.NETWORK_NO_SOURCE
    );
  }

  function decoderDead() {
    if (video.ended) return true;
    if (video.readyState < 2) return true;
    if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) return true;
    if (video.videoWidth === 0) return true;
    return false;
  }

  function phoneWasAway() {
    if (!isPhoneClass()) return false;
    const now = Date.now();
    if (hiddenAt > 0 && now - hiddenAt >= MOBILE_HARD_AWAY_MS) return true;
    return now - lastSeen >= MOBILE_UNSEEN_MS;
  }

  /**
   * Hard reload ONLY on phone after background / dead decoder.
   * Desktop Mac: NEVER — even if readyState/videoWidth dip after tab switch.
   * That dip used to trigger hardRecover → tiny square.
   */
  function needsHardRecover() {
    if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) return true;
    if (!isPhoneClass()) return false;
    if (decoderDead()) return true;
    return phoneWasAway();
  }

  function hardRecover() {
    if (recovering || recoveries >= 6) return;
    recovering = true;
    recoveries += 1;
    video.dataset.heroReloading = "1";
    const resumeAt = video.currentTime;
    wrapped = true;
    const src = (video.currentSrc || video.getAttribute("src") || "").replace(/#.*$/, "");
    const restore = () => {
      video.removeEventListener("loadeddata", restore);
      recovering = false;
      if (Number.isFinite(resumeAt) && resumeAt > 0.05) {
        try {
          video.currentTime = resumeAt;
        } catch {
          /* metadata may not be ready */
        }
      }
      refillAfterShow();
    };
    video.addEventListener("loadeddata", restore);
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (src) video.src = src;
      video.load();
    } catch {
      recovering = false;
      video.removeEventListener("loadeddata", restore);
    }
    window.setTimeout(() => {
      recovering = false;
    }, 4000);
    void playAfterRecover();
  }

  function onVideoError() {
    if (recovering || document.visibilityState === "hidden") return;
    // Mac: never nuke src on error — soft retry. Phone may hard-reload.
    if (!isPhoneClass()) {
      refillAfterShow();
      void video.play().catch(() => undefined);
      return;
    }
    hardRecover();
  }

  function playAfterRecover() {
    const attempt = video.play();
    if (!attempt || typeof attempt.then !== "function") {
      scheduleVerify();
      return;
    }
    void attempt.then(() => scheduleVerify()).catch(() => scheduleVerify());
  }

  function scheduleVerify() {
    clearVerify();
    for (const ms of [200, 600, 1400]) {
      verifyTimers.push(
        window.setTimeout(() => {
          if (document.visibilityState === "hidden") return;
          refillAfterShow();
          if (looksAlive()) {
            recoveries = 0;
            if (boxIsTiny()) kickLayer();
            return;
          }
          if (needsHardRecover()) {
            hardRecover();
            return;
          }
          // Desktop: soft retry only
          void video.play().catch(() => undefined);
          if (boxIsTiny()) kickLayer();
        }, ms),
      );
    }
  }

  /** Pin + play without touching src. This is the Mac-safe path. */
  function softWake() {
    if (document.visibilityState === "hidden") return;
    refillAfterShow();
    if (video.ended) {
      onEnded();
    } else {
      void video.play().catch(() => undefined);
    }
    scheduleVerify();
    hiddenAt = 0;
    lastSeen = Date.now();
  }

  function wake() {
    if (document.visibilityState === "hidden") return;
    if (needsHardRecover()) {
      if (phoneWasAway()) recoveries = 0;
      refillAfterShow();
      hardRecover();
      hiddenAt = 0;
      lastSeen = Date.now();
      return;
    }
    softWake();
  }

  function wakeSoon() {
    clearSoft();
    wake();
    // Re-pin after Safari finishes layout (Mac often paints tiny first).
    for (const ms of [80, 250, 700]) {
      softTimers.push(
        window.setTimeout(() => {
          if (document.visibilityState === "hidden") return;
          refillAfterShow();
          if (boxIsTiny()) kickLayer();
          if (needsHardRecover()) {
            hardRecover();
            return;
          }
          void video.play().catch(() => undefined);
        }, ms),
      );
    }
  }

  function onShow() {
    wakeSoon();
  }

  function onPageShow() {
    wakeSoon();
  }

  function onFreeze() {
    hiddenAt = Date.now();
    clearVerify();
  }

  function onVisibility() {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      clearVerify();
      return;
    }
    wakeSoon();
  }

  function onPause() {
    if (document.visibilityState === "hidden") return;
    if (video.ended) {
      onEnded();
      return;
    }
    void video.play().catch(() => undefined);
  }

  function onPlaying() {
    if (video.videoWidth > 0) {
      recoveries = 0;
      delete video.dataset.heroRetries;
      delete video.dataset.heroReloading;
    }
    refillAfterShow();
  }

  video.addEventListener("timeupdate", rewindNearEnd);
  video.addEventListener("ended", onEnded);
  video.addEventListener("pause", onPause);
  video.addEventListener("playing", onPlaying);
  video.addEventListener("error", onVideoError);
  video.addEventListener("loadeddata", refillAfterShow);
  video.addEventListener("resize", refillAfterShow);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("freeze", onFreeze as EventListener);
  document.addEventListener("resume", onShow as EventListener);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("focus", onShow);
  wakeSoon();

  return () => {
    clearVerify();
    clearSoft();
    window.clearInterval(seenTimer);
    video.removeEventListener("timeupdate", rewindNearEnd);
    video.removeEventListener("ended", onEnded);
    video.removeEventListener("pause", onPause);
    video.removeEventListener("playing", onPlaying);
    video.removeEventListener("error", onVideoError);
    video.removeEventListener("loadeddata", refillAfterShow);
    video.removeEventListener("resize", refillAfterShow);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("freeze", onFreeze as EventListener);
    document.removeEventListener("resume", onShow as EventListener);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("focus", onShow);
  };
}

export function useKeepVideoPlaying(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  src?: string,
) {
  useEffect(() => {
    if (!enabled) return;
    const el = videoRef.current;
    if (!el) return;
    return bindHeroVideo(el);
  }, [enabled, src, videoRef]);
}
