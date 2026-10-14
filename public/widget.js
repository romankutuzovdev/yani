(function () {
  "use strict";

  var script =
    document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName("script");
      return scripts[scripts.length - 1];
    })();

  var agentId = script && script.getAttribute("data-agent-id");
  var agentSlug = script && script.getAttribute("data-agent-slug");
  var base =
    (script && script.getAttribute("data-base-url")) ||
    (script && script.src ? script.src.replace(/\/widget\.js.*$/, "") : "");

  if (!agentId && !agentSlug) {
    agentSlug = "primary";
  }

  var host = document.createElement("div");
  host.id = "yani-widget-host";
  document.body.appendChild(host);
  var shadow = host.attachShadow({ mode: "open" });
  var root = document.createElement("div");
  shadow.appendChild(root);

  var cfg = {
    position: "bottom-right",
    size: 68,
    offsetBottom: 2,
    offsetSide: 2,
    asideText: "",
  };

  function clamp(n, min, max) {
    n = Number(n);
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function side() {
    return cfg.position === "bottom-left" ? "left" : "right";
  }

  function paint() {
    var s = side();
    var size = clamp(cfg.size, 44, 140);
    var bottom = clamp(cfg.offsetBottom, 0, 40);
    var sidePct = clamp(cfg.offsetSide, 0, 40);
    var gap = 12;
    var lift = size + gap;
    var sideGap = "calc(" + sidePct + "vw + 12px)";
    var roomW = "calc(100vw - " + sidePct + "vw - 24px)";
    var roomH = "calc(100dvh - " + bottom + "vh - " + (lift + 16) + "px)";
    var panelW = "min(400px, " + roomW + ", calc(" + roomH + " * 0.68))";
    var panelH = "min(" + roomH + ", 720px, calc(" + panelW + " * 1.55))";
    var style = shadow.querySelector("style");
    if (!style) {
      style = document.createElement("style");
      shadow.insertBefore(style, root);
    }
    style.textContent =
      ":host{all:initial}" +
      ".yani-dock{position:fixed;" +
      s +
      ":" +
      sidePct +
      "vw;bottom:" +
      bottom +
      "vh;z-index:2147483000;display:flex;align-items:center;gap:10px;" +
      (s === "left" ? "flex-direction:row" : "flex-direction:row-reverse") +
      "}" +
      ".yani-fab{width:" +
      size +
      "px;height:" +
      size +
      "px;padding:0;border-radius:999px;border:3px solid #fff;cursor:pointer;background:#f3eefc;box-shadow:0 10px 30px rgba(107,82,176,.28);overflow:hidden;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}" +
      ".yani-fab-hero{width:100%;height:100%;object-fit:contain;object-position:center;display:block;background:#f3eefc}" +
      ".yani-aside{max-width:min(220px,36vw);padding:8px 12px;border-radius:16px;background:#fff;border:1px solid #c9b5f5;box-shadow:0 8px 24px rgba(107,82,176,.18);font:600 13px/1.3 system-ui,sans-serif;color:#4c3a7a;white-space:pre-wrap;word-break:break-word}" +
      ".yani-aside:empty{display:none}" +
      ".yani-panel{position:fixed;" +
      s +
      ":" +
      sideGap +
      ";bottom:calc(" +
      bottom +
      "vh + " +
      lift +
      "px);z-index:2147483000;width:" +
      panelW +
      ";height:" +
      panelH +
      ";max-width:" +
      roomW +
      ";max-height:" +
      roomH +
      ";aspect-ratio:5/8;border-radius:24px;overflow:hidden;background:#fff;color:#0f172a;box-shadow:0 25px 80px rgba(107,82,176,.28);display:none;flex-direction:column;border:1px solid #c9b5f5;box-sizing:border-box}" +
      ".yani-panel.open{display:flex}" +
      ".yani-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;height:40px;padding:0 8px 0 14px;background:#f3eefc;border-bottom:1px solid #c9b5f5;flex-shrink:0;font:600 13px/1 system-ui,sans-serif;color:#6b52b0}" +
      ".yani-frame{flex:1;width:100%;min-height:0;border:0;background:#fff}" +
      ".yani-x{width:32px;height:32px;border-radius:999px;border:0;background:#f3ebfe;color:#6b52b0;font-size:20px;line-height:1;cursor:pointer}" +
      "@media (max-width:700px){.yani-panel{left:0!important;right:0!important;top:0!important;bottom:0!important;width:100%!important;height:100%!important;max-width:none;max-height:none;aspect-ratio:auto;border-radius:0;border:0}.yani-dock{bottom:max(" +
      bottom +
      "vh,env(safe-area-inset-bottom));" +
      s +
      ":max(" +
      sidePct +
      "vw,env(safe-area-inset-" +
      s +
      "))}}";
  }

  root.innerHTML =
    '<div class="yani-dock">' +
    '  <button class="yani-fab" type="button" aria-label="Открыть чат"></button>' +
    '  <div class="yani-aside" hidden></div>' +
    "</div>" +
    '<div class="yani-panel" role="dialog" aria-label="Чат">' +
    '  <div class="yani-bar"><span>Чат</span><button class="yani-x" type="button" aria-label="Закрыть">×</button></div>' +
    '  <iframe class="yani-frame" title="Чат"></iframe>' +
    "</div>";

  paint();

  var fab = root.querySelector(".yani-fab");
  var aside = root.querySelector(".yani-aside");
  var panel = root.querySelector(".yani-panel");
  var frame = root.querySelector(".yani-frame");
  var closeBtn = root.querySelector(".yani-x");
  var chatUrl = "";
  var fabCleanup = null;

  function detachFabVideo() {
    if (fabCleanup) fabCleanup();
    fabCleanup = null;
  }

  function toggle(open) {
    var next = typeof open === "boolean" ? open : !panel.classList.contains("open");
    panel.classList.toggle("open", next);
    if (next && chatUrl && frame.getAttribute("src") !== chatUrl) frame.src = chatUrl;
  }

  fab.addEventListener("click", function () {
    toggle();
  });
  closeBtn.addEventListener("click", function () {
    toggle(false);
  });

  function pickAsset(agent, status) {
    var assets = (agent.character && agent.character.assets) || [];
    var map = {
      THINKING: "THINKING",
      WORKING: "WORKING",
      SUCCESS: "SUCCESS",
      ERROR: "ERROR",
      WAITING: "WAITING",
      SPEAKING: "SPEAKING",
    };
    var state = map[status] || "IDLE";
    var found = assets.find(function (a) {
      return a.state === state;
    });
    if (!found) {
      found = assets.find(function (a) {
        return a.state === "IDLE";
      });
    }
    return found;
  }

  function isVideoAsset(asset) {
    if (!asset) return false;
    if (asset.type === "VIDEO") return true;
    if (asset.mimeType && String(asset.mimeType).indexOf("video/") === 0) return true;
    return /\.(webm|mp4|ogv|ogg)(\?|$)/i.test(asset.url || "");
  }

  function setFab(asset, logoUrl) {
    if (!fab) return;
    detachFabVideo();
    var url = (asset && asset.url) || logoUrl || "";
    fab.textContent = "";
    if (!url) return;
    var src = url.indexOf("http") === 0 ? url : base + url;
    if (asset && isVideoAsset(asset)) {
      var video = document.createElement("video");
      video.className = "yani-fab-hero";
      video.src = src;
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.defaultMuted = true;
      video.setAttribute("autoplay", "");
      video.setAttribute("loop", "");
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      var wrapped = false;
      var hiddenAt = 0;
      var lastSeen = Date.now();
      var recoveries = 0;
      var recovering = false;
      var verifyTimers = [];
      var NEAR_END_SEC = 0.06;
      var LEFT_START_SEC = 0.2;
      var HARD_AWAY_MS = 1500;
      var STANDALONE_HARD_AWAY_MS = 300;
      var STANDALONE_UNSEEN_MS = 5000;
      var seenTimer = setInterval(function () {
        if (document.visibilityState === "visible") lastSeen = Date.now();
      }, 1000);
      function isStandaloneApp() {
        try {
          return (
            (window.matchMedia &&
              window.matchMedia("(display-mode: standalone)").matches) ||
            window.navigator.standalone === true
          );
        } catch (e) {
          return false;
        }
      }
      function playSafe() {
        var play = video.play();
        if (play && play.catch) play.catch(function () {});
      }
      function clearVerify() {
        while (verifyTimers.length) {
          clearTimeout(verifyTimers.pop());
        }
      }
      function looksAlive() {
        return (
          !video.paused &&
          !video.ended &&
          video.readyState >= 2 &&
          video.videoWidth > 0
        );
      }
      function standaloneWasAway() {
        if (!isStandaloneApp()) return false;
        var now = Date.now();
        if (hiddenAt > 0 && now - hiddenAt >= STANDALONE_HARD_AWAY_MS) return true;
        return now - lastSeen >= STANDALONE_UNSEEN_MS;
      }
      function needsHardRecover(force) {
        if (video.ended) return true;
        if (video.readyState < 2) return true;
        if (video.videoWidth === 0) return true;
        if (force && standaloneWasAway()) return true;
        if (!force || hiddenAt <= 0) return false;
        return Date.now() - hiddenAt >= HARD_AWAY_MS;
      }
      function scheduleVerify() {
        clearVerify();
        [350, 1200].forEach(function (ms) {
          verifyTimers.push(
            setTimeout(function () {
              if (document.visibilityState === "hidden") return;
              if (looksAlive()) {
                recoveries = 0;
                return;
              }
              hardRecover();
            }, ms),
          );
        });
      }
      function hardRecover() {
        if (recovering || recoveries >= 6) return;
        recovering = true;
        recoveries += 1;
        var resumeAt = video.currentTime;
        wrapped = true;
        var src = (video.currentSrc || video.getAttribute("src") || "").replace(/#.*$/, "");
        function restore() {
          video.removeEventListener("loadeddata", restore);
          recovering = false;
          if (isFinite(resumeAt) && resumeAt > 0.05) {
            try {
              video.currentTime = resumeAt;
            } catch (e) {}
          }
          refillAfterShow();
        }
        video.addEventListener("loadeddata", restore);
        try {
          video.pause();
          video.removeAttribute("src");
          video.load();
          if (src) video.src = src;
          video.load();
        } catch (e) {
          recovering = false;
          video.removeEventListener("loadeddata", restore);
        }
        setTimeout(function () {
          recovering = false;
        }, 4000);
        var attempt = video.play();
        if (attempt && attempt.then) {
          attempt.then(
            function () {
              scheduleVerify();
            },
            function () {
              scheduleVerify();
            },
          );
        } else {
          scheduleVerify();
        }
      }
      function rewindNearEnd() {
        var duration = video.duration;
        var time = video.currentTime;
        if (!isFinite(duration) || duration <= 0.25) return;
        var remaining = duration - time;
        if (wrapped) {
          if (time > LEFT_START_SEC && remaining > 0.15) wrapped = false;
          return;
        }
        if (time <= LEFT_START_SEC) return;
        if (remaining > NEAR_END_SEC || remaining < -0.05) return;
        wrapped = true;
        try {
          video.currentTime = 0;
        } catch (e) {
          wrapped = false;
          return;
        }
        playSafe();
      }
      function onEnded() {
        wrapped = true;
        try {
          video.currentTime = 0;
        } catch (e) {}
        playSafe();
      }
      function fillFrame() {
        if (document.visibilityState === "hidden") return;
        var parent = video.parentElement;
        if (!parent) return;
        var size = Math.round(Math.min(parent.clientWidth, parent.clientHeight));
        if (size < 8) return;
        video.removeAttribute("width");
        video.removeAttribute("height");
        video.style.margin = "0";
        video.style.transform = "none";
        video.style.setProperty("width", size + "px", "important");
        video.style.setProperty("height", size + "px", "important");
        video.style.setProperty("object-fit", "contain", "important");
        video.style.setProperty("object-position", "center center", "important");
      }
      function refillAfterShow() {
        if (document.visibilityState === "hidden") return;
        fillFrame();
        requestAnimationFrame(function () {
          fillFrame();
          var parent = video.parentElement;
          if (!parent) return;
          var size = Math.min(parent.clientWidth, parent.clientHeight);
          if (size >= 8 && (video.clientWidth < size * 0.8 || video.clientHeight < size * 0.8)) {
            video.style.display = "none";
            void video.offsetWidth;
            video.style.display = "block";
            fillFrame();
            playSafe();
          }
        });
      }
      function wake(force) {
        if (document.visibilityState === "hidden") return;
        if (force && standaloneWasAway()) recoveries = 0;
        refillAfterShow();
        if (needsHardRecover(!!force)) {
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
        var attempt = video.play();
        if (attempt && attempt.then) {
          attempt.then(
            function () {
              scheduleVerify();
            },
            function () {
              scheduleVerify();
            },
          );
        } else {
          scheduleVerify();
        }
        hiddenAt = 0;
        lastSeen = Date.now();
      }
      function wakeStandaloneSoon() {
        if (!isStandaloneApp()) {
          wake(false);
          return;
        }
        wake(true);
        setTimeout(function () {
          wake(true);
        }, 500);
      }
      function onShow() {
        wakeStandaloneSoon();
      }
      function onPageShow() {
        wakeStandaloneSoon();
      }
      function onFreeze() {
        hiddenAt = Date.now();
        clearVerify();
      }
      function onVideoError() {
        if (recovering || document.visibilityState === "hidden") return;
        if (!isStandaloneApp()) return;
        hardRecover();
      }
      function onVisibility() {
        if (document.visibilityState === "hidden") {
          hiddenAt = Date.now();
          clearVerify();
          return;
        }
        wakeStandaloneSoon();
      }
      function onPause() {
        if (document.visibilityState === "hidden") return;
        if (video.ended) {
          onEnded();
          return;
        }
        playSafe();
      }
      function onPlaying() {
        if (video.videoWidth > 0) recoveries = 0;
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
      document.addEventListener("freeze", onFreeze);
      document.addEventListener("resume", onShow);
      window.addEventListener("pageshow", onPageShow);
      window.addEventListener("focus", onShow);
      fabCleanup = function () {
        clearVerify();
        clearInterval(seenTimer);
        video.removeEventListener("timeupdate", rewindNearEnd);
        video.removeEventListener("ended", onEnded);
        video.removeEventListener("pause", onPause);
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("error", onVideoError);
        video.removeEventListener("loadeddata", refillAfterShow);
        video.removeEventListener("resize", refillAfterShow);
        document.removeEventListener("visibilitychange", onVisibility);
        document.removeEventListener("freeze", onFreeze);
        document.removeEventListener("resume", onShow);
        window.removeEventListener("pageshow", onPageShow);
        window.removeEventListener("focus", onShow);
      };
      fab.appendChild(video);
      onShow();
      return;
    }
    var img = document.createElement("img");
    img.className = "yani-fab-hero";
    img.alt = "";
    img.src = src;
    fab.appendChild(img);
  }

  function setAside(text) {
    if (!aside) return;
    var t = (text || "").trim();
    aside.textContent = t;
    if (t) aside.removeAttribute("hidden");
    else aside.setAttribute("hidden", "");
  }

  function applyAgent(agent) {
    var wcfg =
      (agent.widget && agent.widget.config) ||
      (typeof agent.widget === "object" && agent.widget) ||
      {};
    if (typeof wcfg === "string") {
      try {
        wcfg = JSON.parse(wcfg);
      } catch (e) {
        wcfg = {};
      }
    }
    cfg.position = wcfg.position === "bottom-left" ? "bottom-left" : "bottom-right";
    cfg.size = clamp(wcfg.size != null ? wcfg.size : cfg.size, 44, 140);
    cfg.offsetBottom = clamp(
      wcfg.offsetBottom != null ? wcfg.offsetBottom : cfg.offsetBottom,
      0,
      40,
    );
    cfg.offsetSide = clamp(wcfg.offsetSide != null ? wcfg.offsetSide : cfg.offsetSide, 0, 40);
    paint();
    setAside(agent.asideText || wcfg.asideText || "");
    var slug = agent.slug || "";
    chatUrl = slug ? base + "/chat?slug=" + encodeURIComponent(slug) : base + "/chat";
    setFab(pickAsset(agent, "IDLE"), agent.logoUrl);
  }

  function bootstrapUrl() {
    if (agentId) return base + "/api/v1/agents/" + encodeURIComponent(agentId);
    return base + "/api/v1/agents/by-slug/" + encodeURIComponent(agentSlug);
  }

  fetch(bootstrapUrl())
    .then(function (r) {
      return r.json().then(function (data) {
        return { ok: r.ok, data: data };
      });
    })
    .then(function (res) {
      if (!res.ok || !res.data.agent) {
        console.error("[Yani Widget]", res.data.error || "Agent unavailable");
        host.remove();
        return;
      }
      if (res.data.agent.widget === null && res.data.agent.widgetEnabled === false) {
        host.remove();
        return;
      }
      applyAgent(res.data.agent);
    })
    .catch(function (err) {
      console.error("[Yani Widget]", err);
    });
})();
