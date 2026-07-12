# Lucky-Liquid-Glass
Beautiful Cloudflare Worker Dashboard for Lucky STUN
# 🚀 Lucky Liquid Glass Worker

一个基于 **Cloudflare Workers + KV** 的 Lucky STUN 动态跳转服务。

当 Lucky STUN 穿透端口发生变化时，Lucky 会自动通过 WebHook 更新 Cloudflare KV。

用户访问固定域名即可自动 302 跳转到最新地址，无需修改 Cloudflare Redirect Rules。

同时提供一个 iOS Liquid Glass 风格的状态页面。

---

# ✨ Features

- 🍎 iOS Liquid Glass UI
- 🚀 Lucky WebHook 自动更新
- 🔀 自动 302 Redirect
- ☁ Cloudflare Workers
- 💾 Cloudflare KV
- 🌙 Auto Dark Mode
- 📱 Mobile Friendly
- 📋 Copy Host
- 📋 Copy Port
- 📋 Copy Endpoint
- 🔄 Auto Refresh
- ⏱ Relative Time

---

# 📦 Requirements

Cloudflare Account

Cloudflare Workers

Cloudflare KV

Lucky >= 3.0

---

# 📁 Project Structure

```
worker.js
README.md
wrangler.toml
```

---

# ☁ Step 1

Create KV Namespace

Cloudflare Dashboard

Storage & Databases

↓

KV

↓

Create Namespace

例如：

```
lucky-stun
```

---

# ☁ Step 2

Create Worker

Workers & Pages

↓

Create Worker

例如：

```
lucky-liquid-glass
```

---

# ☁ Step 3

Bind KV

Worker

↓

Settings

↓

Bindings

↓

Add Binding

Type

```
KV Namespace
```

Variable

```
STUN
```

Namespace

```
lucky-stun
```

---

# ☁ Step 4

Create Secret

Worker

↓

Settings

↓

Variables

↓

Add Secret

Name

```
API_KEY
```

Value

```
123456abcdef
```

请自行修改。复制备用，保存cf就看不到了。

---

# ☁ Step 5

Deploy

将

```
worker.js
```

全部复制到 Worker。

Deploy。

---

# 🌐 Step 6

Bind Domain

Worker

↓

Triggers

↓

Custom Domain

例如：

```
vpn.example.com
```

---

# Lucky WebHook

Method

```
GET
```

URL

```
https://vpn.example.com/update?key=123456abcdef&target=https://sh.example.com:#{port}&ruleName=#{ruleName}
```

即可。

Lucky 每次 STUN 更新都会自动调用。

---

# API

## Update

```
GET /update
```

Parameters

| Name | Description |
|------|-------------|
| key | API_KEY |
| target | 完整目标地址 |

Example

```
/update?key=123456abcdef&target=https://sh.example.com:45678
```

---

## JSON Status

```
GET /api/status
```

Example

```json
{
    "target":"https://sh.example.com:45678",
    "lastUpdate":"2026-07-10T12:25:31Z"
}
```

---

## Status Page

```
GET /status
```

浏览器访问：

```
https://vpn.example.com/status
```

即可查看当前状态。

---

## Redirect

浏览器访问

```
https://vpn.example.com
```

自动

```
302
```

跳转至：

```
https://sh.example.com:45678
```

---

# Lucky Variables

Lucky WebHook 支持：

```
#{port}
#{ip}
#{ipAddr}
#{ruleName}
#{time}
```

本项目推荐：

```
#{port}
```

Example

```
https://vpn.example.com/update?key=123456abcdef&target=https://sh.example.com:#{port}&ruleName=#{ruleName}
```

---

# Telegram Notification

Lucky 可同时配置 Telegram WebHook。

Example

```
🌐 STUN Updated

https://sh.example.com:#{port}

#{time}
```

---

# Screenshots

Status Page

(Coming Soon)

---

# Credits

Powered by Lucky

Powered by Cloudflare Workers

Engineered with ChatGPT

---

# License

MIT

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)

![Lucky](https://img.shields.io/badge/Lucky-STUN-00C853)

![MIT](https://img.shields.io/badge/License-MIT-blue.svg)
