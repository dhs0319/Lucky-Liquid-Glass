const STATUS_PREFIX = "stun:status:";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/update") {
      return handleUpdate(url, env);
    }

    if (url.pathname === "/api/status") {
      return json({
        statuses: await getStatuses(env),
      });
    }

    if (url.pathname === "/status" || url.pathname === "/status/") {
      return html(renderPage(await getStatuses(env)));
    }

    const statuses = await getStatuses(env);
    const target = statuses.find((status) => isValidTarget(status.target))?.target;

    if (!target) {
      return new Response("Target not configured", { status: 404 });
    }

    return Response.redirect(target, 302);
  },
};

async function handleUpdate(url, env) {
  const key = url.searchParams.get("key");
  const ruleName = String(url.searchParams.get("ruleName") || "").trim();
  const target = String(url.searchParams.get("target") || "").trim();

  if (!env.API_KEY || key !== env.API_KEY) {
    return json({ success: false, error: "Forbidden" }, 403);
  }

  if (!ruleName) {
    return json({ success: false, error: "Missing ruleName" }, 400);
  }

  if (!isValidTarget(target)) {
    return json({ success: false, error: "Invalid target URL" }, 400);
  }

  const status = {
    ruleName,
    target,
    lastUpdate: new Date().toISOString(),
  };

  await env.STUN.put(getStatusKey(ruleName), JSON.stringify(status));

  return json({
    success: true,
    message: "Updated",
    ...status,
  });
}

async function getStatuses(env) {
  const statuses = [];
  let cursor;

  do {
    const result = await env.STUN.list({
      prefix: STATUS_PREFIX,
      cursor,
    });

    const records = await Promise.all(
      result.keys.map(async (item) => {
        const value = await env.STUN.get(item.name);

        if (!value) {
          return null;
        }

        try {
          return normalizeStatus(JSON.parse(value));
        } catch {
          return null;
        }
      }),
    );

    statuses.push(...records.filter(Boolean));
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  // 兼容之前的单条 status 数据。
  const legacyStatus = await getLegacyStatus(env);

  if (legacyStatus) {
    const legacyId = normalizeRuleName(legacyStatus.ruleName);
    const exists = statuses.some(
      (status) => normalizeRuleName(status.ruleName) === legacyId,
    );

    if (!exists) {
      statuses.push(legacyStatus);
    }
  }

  return statuses.sort((a, b) =>
    a.ruleName.localeCompare(b.ruleName, "zh-CN"),
  );
}

async function getLegacyStatus(env) {
  const [statusValue, ruleName, target, lastUpdate] = await Promise.all([
    env.STUN.get("status"),
    env.STUN.get("ruleName"),
    env.STUN.get("target"),
    env.STUN.get("lastUpdate"),
  ]);

  if (statusValue) {
    try {
      const status = normalizeStatus(JSON.parse(statusValue));

      if (status.ruleName && isValidTarget(status.target)) {
        return status;
      }
    } catch {
      // Continue with the old individual KV keys.
    }
  }

  if (ruleName && isValidTarget(target)) {
    return {
      ruleName,
      target,
      lastUpdate: lastUpdate || "",
    };
  }

  return null;
}

function getStatusKey(ruleName) {
  return `${STATUS_PREFIX}${encodeURIComponent(normalizeRuleName(ruleName))}`;
}

function normalizeRuleName(ruleName) {
  return String(ruleName || "").trim().toLowerCase();
}

function normalizeStatus(value) {
  return {
    ruleName: String(value?.ruleName || "").trim(),
    target: String(value?.target || "").trim(),
    lastUpdate: String(value?.lastUpdate || ""),
  };
}

function isValidTarget(value) {
  try {
    const target = new URL(value);
    return target.protocol === "http:" || target.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

function html(content) {
  return new Response(content, {
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

function renderRule(status) {
  const online = isValidTarget(status.target);
  const safeRuleName = escapeHtml(status.ruleName || "Unnamed Rule");
  const safeTarget = escapeHtml(
    online ? status.target : "Not configured",
  );
  const safeHref = escapeHtml(status.target);
  const safeLastUpdate = escapeHtml(status.lastUpdate || "");

  const actions = online
    ? `<div class="btns">
<a class="primary" href="${safeHref}" target="_blank" rel="noopener noreferrer">Open ${safeRuleName}</a>
<button class="secondary copy-button" type="button" data-target="${safeHref}">Copy URL</button>
</div>`
    : "";

  return `<section class="rule">
<div class="rule-head">
<div class="rule-title">${safeRuleName}</div>
<div class="status ${online ? "online" : "offline"}">
<span class="dot"></span>
${online ? "Online" : "Offline"}
</div>
</div>

<div class="row">
<div class="label">${safeRuleName} URL</div>
<div class="value">${safeTarget}</div>
</div>

<div class="row">
<div class="label">Last Update</div>
<div class="value last-update" data-value="${safeLastUpdate}">-</div>
</div>

${actions}
</section>`;
}

function renderPage(statuses) {
  const rules = statuses.length
    ? statuses.map(renderRule).join("")
    : `<div class="empty">Waiting for STUN updates.</div>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>STUN Status</title>
<style>
:root{
  color-scheme:light dark;
}

*{
  box-sizing:border-box;
}

body{
  margin:0;
  min-height:100vh;
  padding:24px;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif;
  background:linear-gradient(135deg,#6ea8fe,#a78bfa,#7dd3fc);
  background-size:300% 300%;
  animation:bg 18s ease infinite;
}

@keyframes bg{
  0%{background-position:0 50%}
  50%{background-position:100% 50%}
  100%{background-position:0 50%}
}

.card{
  width:min(92vw,760px);
  margin:0 auto;
  padding:34px;
  border:1px solid rgba(255,255,255,.25);
  border-radius:28px;
  color:#172033;
  background:rgba(255,255,255,.18);
  box-shadow:0 20px 60px rgba(0,0,0,.18);
  backdrop-filter:blur(24px) saturate(180%);
  -webkit-backdrop-filter:blur(24px) saturate(180%);
}

h1{
  margin:0 0 24px;
  text-align:center;
  font-size:28px;
}

.rule{
  padding:20px 0;
  border-top:1px solid rgba(255,255,255,.3);
}

.rule:first-of-type{
  padding-top:0;
  border-top:0;
}

.rule:last-of-type{
  padding-bottom:0;
}

.rule-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  margin-bottom:18px;
}

.rule-title{
  min-width:0;
  overflow-wrap:anywhere;
  font-size:20px;
  font-weight:700;
}

.status{
  display:flex;
  flex:none;
  align-items:center;
  gap:8px;
  font-weight:700;
}

.online{
  color:#15803d;
}

.offline{
  color:#b45309;
}

.dot{
  width:12px;
  height:12px;
  flex:none;
  border-radius:50%;
  background:currentColor;
}

.online .dot{
  animation:pulse 2s infinite;
}

@keyframes pulse{
  0%,100%{
    transform:scale(1);
    opacity:1;
  }

  50%{
    transform:scale(1.35);
    opacity:.55;
  }
}

.row{
  margin:16px 0;
}

.label{
  margin-bottom:6px;
  opacity:.72;
  font-size:.9rem;
}

.value{
  overflow-wrap:anywhere;
  line-height:1.55;
  font-size:1.02rem;
}

.btns{
  display:flex;
  gap:12px;
  margin-top:24px;
}

button,
a{
  flex:1;
  padding:14px 18px;
  border:0;
  border-radius:16px;
  font:inherit;
  font-weight:700;
  text-align:center;
  text-decoration:none;
  cursor:pointer;
}

.primary{
  color:#fff;
  background:#0a84ff;
}

.secondary{
  color:inherit;
  background:rgba(255,255,255,.3);
}

.empty{
  padding:18px 0;
  text-align:center;
  opacity:.75;
}

footer{
  margin-top:28px;
  text-align:center;
  opacity:.7;
  font-size:.82rem;
}

@media (max-width:520px){
  body{
    padding:16px;
  }

  .card{
    width:100%;
    padding:24px 20px;
    border-radius:22px;
  }

  .rule-head{
    align-items:flex-start;
    flex-direction:column;
    gap:8px;
  }

  .btns{
    flex-direction:column;
  }
}
</style>
</head>
<body>
<main class="card">
<h1>STUN Status</h1>

${rules}

<footer>Powered by Lucky + Cloudflare Workers</footer>
</main>

<script>
for (const element of document.querySelectorAll(".last-update")) {
  const value = element.dataset.value;

  if (!value) {
    element.textContent = "-";
    continue;
  }

  const date = new Date(value);

  element.textContent = Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false });
}

for (const button of document.querySelectorAll(".copy-button")) {
  button.addEventListener("click", async () => {
    const target = button.dataset.target;

    try {
      await navigator.clipboard.writeText(target);
      const originalText = button.textContent;

      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = originalText;
      }, 1500);
    } catch {
      button.textContent = "Copy failed";
    }
  });
}
</script>
</body>
</html>`;
}
