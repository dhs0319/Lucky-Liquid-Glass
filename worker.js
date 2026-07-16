const STATUS_PREFIX = "stun:status:";
const STATUS_CACHE_TTL = 30; // 状态页 / API 的边缘缓存时长（秒）

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (pathname === "/update") {
      return handleUpdate(request, env, ctx);
    }
    if (pathname === "/api/status") {
      return withCache(request, ctx, () => buildStatusApi(env));
    }
    if (pathname === "/status" || pathname === "/status/") {
      return withCache(request, ctx, () => buildStatusPage(env));
    }

    return handleRedirect(env);
  },
};

async function handleUpdate(request, env, ctx) {
  const url = new URL(request.url);
  const params = await readParams(request, url);

  if (!env.API_KEY || getAuthKey(request, params) !== env.API_KEY) {
    return json({ success: false, error: "Forbidden" }, 403);
  }

  const ruleName = String(params.get("ruleName") || "").trim();
  const target = String(params.get("target") || "").trim();

  if (!ruleName) {
    return json({ success: false, error: "Missing ruleName" }, 400);
  }
  if (!isValidTarget(target)) {
    return json({ success: false, error: "Invalid target URL" }, 400);
  }

  const status = { ruleName, target, lastUpdate: new Date().toISOString() };
  await putStatus(env, status);
  await purgeCache(url, ctx);

  return json({ success: true, message: "Updated", ...status });
}

async function handleRedirect(env) {
  const statuses = await getStatuses(env, true);
  const target = statuses.find((s) => isValidTarget(s.target))?.target;

  if (!target) {
    return new Response("Target not configured", { status: 404 });
  }
  return Response.redirect(target, 302);
}

async function buildStatusApi(env) {
  const statuses = await getStatuses(env);

  return json(
    {
      statuses: statuses.map((s) => ({ ...s, online: isOnline(s) })),
    },
    200,
    true,
  );
}

async function buildStatusPage(env) {
  const statuses = await getStatuses(env);
  return html(renderPage(statuses, env.CF_VERSION_METADATA?.timestamp));
}

// firstOnly：命中第一个可用 target 即返回，供重定向使用，避免全量遍历 + 排序。
async function getStatuses(env, firstOnly = false) {
  const statuses = [];
  let cursor;

  do {
    const result = await env.STUN.list({ prefix: STATUS_PREFIX, cursor });

    for (const item of result.keys) {
      const status = await readStatus(env, item);
      if (status) {
        statuses.push(status);
      }
      if (firstOnly && status && isValidTarget(status.target)) {
        return statuses;
      }
    }

    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  // 兼容旧的单条 status 数据。
  const legacy = await getLegacyStatus(env);
  if (legacy) {
    const exists = statuses.some(
      (s) => normalizeRuleName(s.ruleName) === normalizeRuleName(legacy.ruleName),
    );
    if (!exists) {
      statuses.push(legacy);
    }
  }

  if (firstOnly) {
    return statuses;
  }
  return statuses.sort((a, b) => a.ruleName.localeCompare(b.ruleName, "zh-CN"));
}

// 优先用 list 返回的 metadata，避免逐条 get 的 N+1；旧数据无 metadata 时才回退 get。
async function readStatus(env, item) {
  if (item.metadata?.ruleName) {
    return normalizeStatus(item.metadata);
  }

  const value = await env.STUN.get(item.name);
  if (!value) {
    return null;
  }

  try {
    return normalizeStatus(JSON.parse(value));
  } catch {
    return null;
  }
}

async function getLegacyStatus(env) {
  const opts = { cacheTtl: 3600 };
  const [statusValue, ruleName, target, lastUpdate] = await Promise.all([
    env.STUN.get("status", opts),
    env.STUN.get("ruleName", opts),
    env.STUN.get("target", opts),
    env.STUN.get("lastUpdate", opts),
  ]);

  if (statusValue) {
    try {
      const status = normalizeStatus(JSON.parse(statusValue));
      if (status.ruleName && isValidTarget(status.target)) {
        return status;
      }
    } catch {
      // 继续尝试旧的独立 KV key。
    }
  }

  if (ruleName && isValidTarget(target)) {
    return { ruleName, target, lastUpdate: lastUpdate || "" };
  }
  return null;
}

async function putStatus(env, status) {
  const s = normalizeStatus(status);
  await env.STUN.put(getStatusKey(s.ruleName), JSON.stringify(s), { metadata: s });
}

// 从 body（JSON / 表单）与 query 合并读参，兼容旧的 GET query 调用。
async function readParams(request, url) {
  const params = new Map(url.searchParams);

  if (request.method === "POST") {
    const type = request.headers.get("content-type") || "";
    try {
      if (type.includes("json")) {
        const body = (await request.json()) || {};
        for (const [k, v] of Object.entries(body)) {
          params.set(k, v);
        }
      } else if (type.includes("form")) {
        for (const [k, v] of await request.formData()) {
          params.set(k, v);
        }
      }
    } catch {
      // 忽略解析失败的 body，回退到 query 参数。
    }
  }

  return params;
}

// 优先 Authorization: Bearer / X-API-Key，兼容旧的 query key。
function getAuthKey(request, params) {
  const auth = request.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return request.headers.get("x-api-key") || params.get("key") || "";
}

async function withCache(request, ctx, generate) {
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await generate();
  if (response.ok) {
    ctx?.waitUntil?.(cache.put(cacheKey, response.clone()));
  }
  return response;
}

async function purgeCache(url, ctx) {
  const cache = caches.default;
  const work = Promise.all(
    ["/status", "/status/", "/api/status"].map((path) =>
      cache.delete(new Request(new URL(path, url.origin).toString(), { method: "GET" })),
    ),
  );

  if (ctx?.waitUntil) {
    ctx.waitUntil(work);
  } else {
    await work;
  }
}

// 只要 target 是合法 URL 就视为 Online。
function isOnline(status) {
  return isValidTarget(status.target);
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
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
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

function json(data, status = 200, cacheable = false) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": cacheable ? `public, max-age=${STATUS_CACHE_TTL}` : "no-store",
    },
  });
}

function html(content) {
  return new Response(content, {
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": `public, max-age=${STATUS_CACHE_TTL}`,
    },
  });
}

function renderRule(status, online) {
  const name = escapeHtml(status.ruleName || "Unnamed Rule");
  const linkable = isValidTarget(status.target);
  const href = escapeHtml(status.target);
  const value = escapeHtml(linkable ? status.target : "Not configured");
  const lastUpdate = escapeHtml(status.lastUpdate || "");

  const actions = linkable
    ? `<div class="btns">
<a class="primary" href="${href}" target="_blank" rel="noopener noreferrer">Open ${name}</a>
<button class="secondary copy-button" type="button" data-target="${href}">Copy URL</button>
</div>`
    : "";

  return `<section class="rule">
<div class="rule-head">
<div class="rule-title">${name}</div>
<div class="status ${online ? "online" : "offline"}">
<span class="dot"></span>
${online ? "Online" : "Offline"}
</div>
</div>

<div class="row">
<div class="label">${name} URL</div>
<div class="value">${value}</div>
</div>

<div class="row">
<div class="label">Port Last Update</div>
<div class="value last-update" data-value="${lastUpdate}">-</div>
</div>

${actions}
</section>`;
}

function renderPage(statuses, deployedAt) {
  const rules = statuses.length
    ? statuses.map((s) => renderRule(s, isOnline(s))).join("")
    : `<div class="empty">Waiting for STUN updates.</div>`;
  const deploymentTime = escapeHtml(deployedAt || "");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>STUN Status</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main class="card">
<h1>STUN Status</h1>

${rules}

<footer><a href="https://github.com/dhs0319/Lucky-Liquid-Glass" target="_blank" rel="noopener noreferrer">Powered by Lucky-Liquid-Glass</a></footer>
<div class="deployment-time">Page Last Update：<span class="local-time" data-value="${deploymentTime}">${deploymentTime ? "-" : ""}</span></div>
</main>

<script>${PAGE_SCRIPT}</script>
</body>
</html>`;
}

const PAGE_STYLE = `
:root{
  color-scheme:light dark;
}

*{
  box-sizing:border-box;
}

body{
  margin:0;
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:safe center;
  padding:24px;
  padding-top:max(24px,env(safe-area-inset-top));
  padding-right:max(24px,env(safe-area-inset-right));
  padding-bottom:max(24px,env(safe-area-inset-bottom));
  padding-left:max(24px,env(safe-area-inset-left));
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
  flex:none;
  width:min(92vw,760px);
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
  margin:0 0 8px;
  text-align:center;
  font-size:28px;
}

.deployment-time{
  margin-top: 4px;
  text-align:center;
  opacity:.72;
  font-size:.86rem;
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

footer a{
  flex:none;
  padding:0;
  border-radius:0;
  color:inherit;
  font-weight:inherit;
  text-decoration:underline;
}

@media (max-width:520px){
  body{
    padding:16px;
    padding-top:calc(16px + env(safe-area-inset-top));
    padding-right:max(16px,env(safe-area-inset-right));
    padding-bottom:max(16px,env(safe-area-inset-bottom));
    padding-left:max(16px,env(safe-area-inset-left));
  }

  h1{
    font-size:24px;
  }

  .deployment-time{
    margin-bottom:20px;
  }

  .card{
    width:100%;
    padding:24px 20px;
    border-radius:22px;
  }

  .rule-head{
    align-items:flex-start;
    gap:8px;
  }

  .btns{
    flex-direction:column;
  }
}
`;

const PAGE_SCRIPT = `
for (const el of document.querySelectorAll(".last-update, .local-time")) {
  const value = el.dataset.value;

  if (!value) {
    continue;
  }

  const date = new Date(value);
  el.textContent = Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false });
}

for (const btn of document.querySelectorAll(".copy-button")) {
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.target);
      const text = btn.textContent;
    } catch {
      btn.textContent = "Copy failed";
    }
  });
}
`;
