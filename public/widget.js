(function () {
  "use strict";

  var script =
    document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName("script");
      return scripts[scripts.length - 1];
    })();

  var agentId = script && script.getAttribute("data-agent-id");
  var apiKey = script && script.getAttribute("data-api-key");
  var base =
    (script && script.getAttribute("data-base-url")) ||
    (script && script.src ? script.src.replace(/\/widget\.js.*$/, "") : "");

  if (!agentId) {
    console.error("[Yani Widget] data-agent-id is required");
    return;
  }

  var host = document.createElement("div");
  host.id = "yani-widget-host";
  document.body.appendChild(host);

  var shadow = host.attachShadow({ mode: "open" });
  var root = document.createElement("div");
  shadow.appendChild(root);

  var style = document.createElement("style");
  style.textContent =
    ":host{all:initial}" +
    ".yani-fab{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:56px;height:56px;border-radius:999px;border:0;cursor:pointer;background:linear-gradient(135deg,#22d3ee,#0284c7);box-shadow:0 10px 30px rgba(0,0,0,.35);color:#04111a;font:600 14px/1 system-ui,sans-serif}" +
    ".yani-panel{position:fixed;right:20px;bottom:88px;z-index:2147483000;width:340px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 120px);border-radius:20px;overflow:hidden;background:#0b1220;color:#e2e8f0;box-shadow:0 25px 80px rgba(0,0,0,.45);display:none;flex-direction:column;font:14px/1.45 system-ui,sans-serif;border:1px solid rgba(255,255,255,.08)}" +
    ".yani-panel.open{display:flex}" +
    ".yani-head{padding:14px 16px;background:linear-gradient(180deg,rgba(34,211,238,.15),transparent);display:flex;gap:12px;align-items:center}" +
    ".yani-avatar{width:48px;height:48px;border-radius:999px;object-fit:cover;background:#1e293b;border:1px solid rgba(34,211,238,.25)}" +
    ".yani-title{font-weight:650;margin:0}" +
    ".yani-sub{margin:2px 0 0;font-size:12px;color:#94a3b8}" +
    ".yani-msgs{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px}" +
    ".yani-msg{padding:10px 12px;border-radius:12px;max-width:90%;white-space:pre-wrap}" +
    ".yani-msg.user{align-self:flex-end;background:rgba(34,211,238,.15)}" +
    ".yani-msg.bot{align-self:flex-start;background:rgba(255,255,255,.06)}" +
    ".yani-foot{display:flex;gap:8px;padding:12px;border-top:1px solid rgba(255,255,255,.08)}" +
    ".yani-input{flex:1;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:#020617;color:#fff;padding:10px 12px;outline:none}" +
    ".yani-send{border:0;border-radius:12px;background:#22d3ee;color:#04111a;font-weight:650;padding:0 14px;cursor:pointer}";
  shadow.appendChild(style);

  root.innerHTML =
    '<button class="yani-fab" type="button" aria-label="Open chat">AI</button>' +
    '<div class="yani-panel" role="dialog" aria-label="AI agent widget">' +
    '  <div class="yani-head">' +
    '    <img class="yani-avatar" alt="" />' +
    "    <div><p class=\"yani-title\">Agent</p><p class=\"yani-sub\">Online</p></div>" +
    "  </div>" +
    '  <div class="yani-msgs"></div>' +
    '  <div class="yani-foot">' +
    '    <input class="yani-input" placeholder="Write a message" />' +
    '    <button class="yani-send" type="button">Send</button>' +
    "  </div>" +
    "</div>";

  var fab = root.querySelector(".yani-fab");
  var panel = root.querySelector(".yani-panel");
  var msgs = root.querySelector(".yani-msgs");
  var input = root.querySelector(".yani-input");
  var sendBtn = root.querySelector(".yani-send");
  var title = root.querySelector(".yani-title");
  var sub = root.querySelector(".yani-sub");
  var avatar = root.querySelector(".yani-avatar");
  var sessionId = "widget-" + Math.random().toString(36).slice(2);

  fab.addEventListener("click", function () {
    panel.classList.toggle("open");
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

  function applyAgent(agent) {
    title.textContent = agent.name || "Agent";
    sub.textContent = (agent.statusMessage || agent.status || "idle").toString();
    var asset = pickAsset(agent, agent.status);
    if (asset && asset.url) {
      avatar.src = asset.url.startsWith("http") ? asset.url : base + asset.url;
      avatar.style.display = "block";
    }
    var greeting =
      (agent.widget && agent.widget.config && agent.widget.config.greeting) ||
      "Hi! How can I help?";
    if (!msgs.childElementCount) addMsg("bot", greeting);
  }

  fetch(base + "/api/v1/agents/" + encodeURIComponent(agentId))
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      if (data.agent) applyAgent(data.agent);
    })
    .catch(function (err) {
      console.error("[Yani Widget]", err);
    });

  function send() {
    var text = (input.value || "").trim();
    if (!text) return;
    input.value = "";
    addMsg("user", text);
    sub.textContent = "Thinking…";

    var headers = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = "Bearer " + apiKey;

    fetch(base + "/api/v1/agents/" + encodeURIComponent(agentId) + "/chat", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ message: text, sessionId: sessionId }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        addMsg("bot", data.reply || data.error || "No response");
        sub.textContent = data.success === false ? "Error" : "Ready";
      })
      .catch(function () {
        addMsg("bot", "Network error");
        sub.textContent = "Error";
      });
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") send();
  });
})();
