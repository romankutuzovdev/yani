"use client";

import { useEffect, type RefObject } from "react";

const NEAR_END_SEC = 0.06;
const LEFT_START_SEC = 0.2;
/** After this long in background, always rebuild the decoder. */
const HARD_AWAY_MS = 1500;
/** Installed PWA (iOS) drops frames sooner — reload sooner. */
const STANDALONE_HARD_AWAY_MS = 300;
/**
 * iOS can freeze a PWA without a visibility "hidden" event. If the page
 * has not been seen for this long, the decoder is treated as gone.
 */
const STANDALONE_UNSEEN_MS = 5000;

function isStandaloneApp() {
  try {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    return (
      window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true
    );
  } catch {
    return false;
  }
}

/**
 * macOS Safari often ignores native `loop` and parks on the last frame.
 * Seek to 0 once, only in the last ~0.06s, then wait until playback has
 * left the start. Never seek a clip that is still in the middle.
 *
 * iOS installed PWA: after a long background the decoder can go blank while
 * readyState still looks fine — force load()+play() on resume, then verify.
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

  /**
   * macOS Safari paints a backgrounded <video> at its intrinsic size (a small
   * square). Pin it to the circle in pixels. Do not reload the file: that
   * resets the picture and the position.
   */
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

  function standaloneWasAway() {
    if (!isStandaloneApp()) return false;
    const now = Date.now();
    if (hiddenAt > 0 && now - hiddenAt >= STANDALONE_HARD_AWAY_MS) return true;
    return now - lastSeen >= STANDALONE_UNSEEN_MS;
  }

  function needsHardRecover(force: boolean) {
    if (video.ended) return true;
    if (video.readyState < 2) return true;
    if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) return true;
    if (video.videoWidth === 0) return true;
    if (force && standaloneWasAway()) return true;
    if (!force || hiddenAt <= 0) return false;
    return Date.now() - hiddenAt >= HARD_AWAY_MS;
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
      // Same src again is a no-op on iOS. Drop it so the decoder is rebuilt.
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
    if (!isStandaloneApp()) return;
    hardRecover();
  }

  function playAfterRecover() {
    const attempt = video.play();
    if (!attempt || typeof attempt.then !== "function") {
      scheduleVerify();
      return;
    }
    // Do not hardRecover in the same tick — iOS often reports readyState 0
    // for a moment after load(); verify timers check again shortly.
    void attempt.then(() => scheduleVerify()).catch(() => scheduleVerify());
  }

  function scheduleVerify() {
    clearVerify();
    for (const ms of [350, 1200]) {
      verifyTimers.push(
        window.setTimeout(() => {
          if (document.visibilityState === "hidden") return;
          if (looksAlive()) {
            recoveries = 0;
            if (boxIsTiny()) refillAfterShow();
            return;
          }
          hardRecover();
        }, ms),
      );
    }
  }

  function wake(force = false) {
    if (document.visibilityState === "hidden") return;
    if (force && standaloneWasAway()) recoveries = 0;
    refillAfterShow();
    if (needsHardRecover(force)) {
      hardRecover();
      hiddenAt = 0;
      lastSeen = Date.now();
      return;
    }
    if (video.ended) {
      onEnded();
      scheduleVerify();
      hiddenAt = 0;
      return;
    }
    const attempt = video.play();
    if (!attempt || typeof attempt.then !== "function") {
      scheduleVerify();
      hiddenAt = 0;
      return;
    }
    void attempt.then(() => scheduleVerify()).catch(() => scheduleVerify());
    hiddenAt = 0;
    lastSeen = Date.now();
  }

  function wakeStandaloneSoon() {
    if (!isStandaloneApp()) {
      wake(false);
      return;
    }
    wake(true);
    // iOS often reports the page hidden for a moment after resume.
    window.setTimeout(() => wake(true), 500);
  }

  function onShow() {
    // Focus while the PWA was frozen: visibility "hidden" often never fired.
    wakeStandaloneSoon();
  }

  function onPageShow() {
    wakeStandaloneSoon();
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
    // Mac Safari only needs the box put back and play() resumed.
    // Reloading the file is what turns the hero into a small square.
    wakeStandaloneSoon();
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
  onShow();

  return () => {
    clearVerify();
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
