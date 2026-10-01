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
  var apiKey = script && script.getAttribute("data-api-key");
  var base =
    (script && script.getAttribute("data-base-url")) ||
    (script && script.src ? script.src.replace(/\/widget\.js.*$/, "") : "");

  if (!agentId && !agentSlug) {
    console.error("[Yani Widget] data-agent-id or data-agent-slug is required");
    return;
  }

  var host = document.createElement("div");
  host.id = "yani-widget-host";
  document.body.appendChild(host);
  var shadow = host.attachShadow({ mode: "open" });
  var root = document.createElement("div");
  shadow.appendChild(root);

  var cfg = {
    position: "bottom-right",
    theme: "light",
    primaryColor: "#0284c7",
    buttonLabel: "Чат",
    greeting: "Привет! Чем могу помочь?",
  };

  function side() {
    return cfg.position === "bottom-left" ? "left" : "right";
  }

  function isDark() {
    return cfg.theme === "dark";
  }

  function paint() {
    var s = side();
    var dark = isDark();
    var bg = dark ? "#0b1220" : "#ffffff";
    var fg = dark ? "#e2e8f0" : "#0f172a";
    var muted = dark ? "#94a3b8" : "#64748b";
    var border = dark ? "rgba(255,255,255,.1)" : "rgba(15,23,42,.1)";
    var userBg = cfg.primaryColor || "#0284c7";
    var botBg = dark ? "rgba(255,255,255,.06)" : "#f1f5f9";
    var inputBg = dark ? "#020617" : "#f8fafc";

    var style = shadow.querySelector("style");
    if (!style) {
      style = document.createElement("style");
      shadow.insertBefore(style, root);
    }
    style.textContent =
      ":host{all:initial}" +
      ".yani-fab{position:fixed;" +
      s +
      ":16px;bottom:16px;z-index:2147483000;min-width:56px;height:56px;padding:0 18px;border-radius:999px;border:0;cursor:pointer;background:" +
      userBg +
      ";box-shadow:0 10px 30px rgba(15,23,42,.25);color:#fff;font:600 14px/1 system-ui,-apple-system,sans-serif;display:inline-flex;align-items:center;justify-content:center;gap:8px}" +
      ".yani-fab img,.yani-fab video{width:28px;height:28px;border-radius:999px;object-fit:contain;background:rgba(255,255,255,.2)}" +
      ".yani-panel{position:fixed;" +
      s +
      ":16px;bottom:84px;z-index:2147483000;width:min(380px,calc(100vw - 24px));height:min(560px,calc(100vh - 110px));border-radius:20px;overflow:hidden;background:" +
      bg +
      ";color:" +
      fg +
      ";box-shadow:0 25px 80px rgba(15,23,42,.28);display:none;flex-direction:column;font:14px/1.45 system-ui,-apple-system,sans-serif;border:1px solid " +
      border +
      "}" +
      ".yani-panel.open{display:flex}" +
      ".yani-head{padding:14px 16px;border-bottom:1px solid " +
      border +
      ";display:flex;gap:12px;align-items:center;background:" +
      (dark ? "linear-gradient(180deg,rgba(255,255,255,.04),transparent)" : "#fff") +
      "}" +
      ".yani-avatar-wrap{width:44px;height:44px;border-radius:999px;overflow:hidden;flex-shrink:0;background:" +
      (dark ? "rgba(255,255,255,.06)" : "#e0f2fe") +
      ";border:1px solid " +
      border +
      "}" +
      ".yani-avatar{width:100%;height:100%;object-fit:contain;display:block}" +
      ".yani-title{font-weight:650;margin:0;font-size:15px}" +
      ".yani-sub{margin:2px 0 0;font-size:12px;color:" +
      muted +
      "}" +
      ".yani-close{margin-left:auto;border:0;background:transparent;color:" +
      muted +
      ";cursor:pointer;font-size:20px;line-height:1;padding:4px 6px}" +
      ".yani-msgs{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px;-webkit-overflow-scrolling:touch}" +
      ".yani-msg{padding:10px 12px;border-radius:14px;max-width:90%;white-space:pre-wrap;word-break:break-word}" +
      ".yani-msg.user{align-self:flex-end;background:" +
      userBg +
      ";color:#fff}" +
      ".yani-msg.bot{align-self:flex-start;background:" +
      botBg +
      ";color:" +
      fg +
      "}" +
      ".yani-foot{display:flex;gap:8px;padding:12px;border-top:1px solid " +
      border +
      ";background:" +
      bg +
      "}" +
      ".yani-input{flex:1;border-radius:12px;border:1px solid " +
      border +
      ";background:" +
      inputBg +
      ";color:" +
      fg +
      ";padding:10px 12px;outline:none;font:14px/1.4 system-ui,sans-serif}" +
      ".yani-send{border:0;border-radius:12px;background:" +
      userBg +
      ";color:#fff;font-weight:650;padding:0 14px;cursor:pointer;min-width:72px}" +
      ".yani-send:disabled{opacity:.5;cursor:default}" +
      "@media (max-width:480px){.yani-panel{right:0!important;left:0!important;bottom:0;width:100vw;height:100dvh;max-height:100dvh;border-radius:0}.yani-fab{bottom:max(16px,env(safe-area-inset-bottom));" +
      s +
      ":max(16px,env(safe-area-inset-right))}}";
  }

  root.innerHTML =
    '<button class="yani-fab" type="button" aria-label="Открыть чат"><span class="yani-fab-label">Чат</span></button>' +
    '<div class="yani-panel" role="dialog" aria-label="Чат с AI-агентом">' +
    '  <div class="yani-head">' +
    '    <div class="yani-avatar-wrap"></div>' +
    '    <div><p class="yani-title">Агент</p><p class="yani-sub">Онлайн</p></div>' +
    '    <button class="yani-close" type="button" aria-label="Закрыть">×</button>' +
    "  </div>" +
    '  <div class="yani-msgs"></div>' +
    '  <div class="yani-foot">' +
    '    <input class="yani-input" placeholder="Напишите сообщение…" />' +
    '    <button class="yani-send" type="button">Отпр.</button>' +
    "  </div>" +
    "</div>";

  paint();

  var fab = root.querySelector(".yani-fab");
  var fabLabel = root.querySelector(".yani-fab-label");
  var panel = root.querySelector(".yani-panel");
  var msgs = root.querySelector(".yani-msgs");
  var input = root.querySelector(".yani-input");
  var sendBtn = root.querySelector(".yani-send");
  var title = root.querySelector(".yani-title");
  var sub = root.querySelector(".yani-sub");
  var avatarWrap = root.querySelector(".yani-avatar-wrap");
  var closeBtn = root.querySelector(".yani-close");
  var sessionId = "widget-" + Math.random().toString(36).slice(2);
  var resolvedAgentId = agentId;
  var busy = false;

  function toggle(open) {
    if (typeof open === "boolean") {
      panel.classList.toggle("open", open);
    } else {
      panel.classList.toggle("open");
    }
  }

  fab.addEventListener("click", function () {
    toggle();
  });
  closeBtn.addEventListener("click", function () {
    toggle(false);
  });

  function addMsg(role, text) {
    var el = document.createElement("div");
    el.className = "yani-msg " + (role === "user" ? "user" : "bot");
    el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }

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

  function setAvatar(asset, logoUrl) {
    if (!avatarWrap) return;
    var url = (asset && asset.url) || logoUrl || "";
    if (!url) {
      avatarWrap.innerHTML = "";
      return;
    }
    var src = url.indexOf("http") === 0 ? url : base + url;
    if (asset && isVideoAsset(asset)) {
      avatarWrap.innerHTML =
        '<video class="yani-avatar" src="' +
        src +
        '" autoplay loop muted playsinline></video>';
    } else {
      avatarWrap.innerHTML = '<img class="yani-avatar" alt="" src="' + src + '" />';
    }
  }

  function applyAgent(agent) {
    resolvedAgentId = agent.id || resolvedAgentId;
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
    cfg.position = wcfg.position || cfg.position;
    cfg.theme = wcfg.theme || cfg.theme;
    cfg.primaryColor = wcfg.primaryColor || cfg.primaryColor;
    cfg.buttonLabel = wcfg.buttonLabel || cfg.buttonLabel;
    cfg.greeting =
      wcfg.greeting || agent.greeting || agent.description || cfg.greeting;

    paint();
    title.textContent = agent.name || "Агент";
    sub.textContent = agent.statusMessage || "Онлайн";
    fabLabel.textContent = cfg.buttonLabel || "Чат";
    setAvatar(pickAsset(agent, agent.status), agent.logoUrl);
    if (!msgs.childElementCount) addMsg("bot", cfg.greeting);
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

  function send() {
    var text = (input.value || "").trim();
    if (!text || busy || !resolvedAgentId) return;
    input.value = "";
    addMsg("user", text);
    sub.textContent = "Думаю…";
    busy = true;
    sendBtn.disabled = true;

    var headers = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = "Bearer " + apiKey;

    fetch(base + "/api/v1/agents/" + encodeURIComponent(resolvedAgentId) + "/chat", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ message: text, sessionId: sessionId }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        addMsg("bot", data.reply || data.error || "Нет ответа");
        sub.textContent = data.success === false ? "Ошибка" : "Онлайн";
      })
      .catch(function () {
        addMsg("bot", "Сетевая ошибка");
        sub.textContent = "Ошибка";
      })
      .finally(function () {
        busy = false;
        sendBtn.disabled = false;
      });
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") send();
  });
})();
