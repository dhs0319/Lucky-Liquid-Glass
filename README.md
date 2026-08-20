# Lucky STUN Worker

基于 Cloudflare Workers 和 KV 的 Lucky STUN 动态跳转服务，支持多个规则独立更新和访问。

Lucky 的 STUN 端口变化后，会通过 WebHook 将规则名称、目标 URL 和更新时间写入 Cloudflare KV。访问规则路径即可获得 302 跳转；`/status` 提供全部规则的状态页。

服务不会采集、保存或展示访问 IP。

## 功能

- 多规则 STUN 状态管理
- Lucky WebHook 自动更新
- 按规则名称 302 跳转
- Cloudflare KV 持久化
- 状态页展示规则名、当前 URL 和本地时间
- 一键复制目标 URL
- 移动端适配

## 环境要求

- Cloudflare 账号
- Cloudflare Workers
- Cloudflare KV
- Lucky 3.0 或更高版本

## 部署

### 1. 创建 KV Namespace

在 Cloudflare Dashboard 中进入 `Storage & Databases` > `KV`，创建一个 Namespace，例如：

```text
lucky-stun
```

### 2. 创建 Worker 并绑定 KV

创建 Worker 后，在 `Settings` > `Bindings` > `Add Binding` 中添加：

| 配置项 | 值 |
| --- | --- |
| Type | KV Namespace |
| Variable name | `STUN` |
| Namespace | `lucky-stun` |

### 3. 配置 API 密钥

在 `Settings` > `Variables` 中添加 Secret：

| 配置项 | 值 |
| --- | --- |
| Name | `API_KEY` |
| Value | 自行生成的高强度随机字符串 |

保存密钥后 Cloudflare 不会再次显示原值，请妥善保管。

### 4. 部署代码并绑定域名

将 `worker(1).js` 的内容部署到 Worker，然后在 `Triggers` > `Custom Domains` 绑定域名，例如：

```text
vpn.example.com
```

## Lucky WebHook

在 Lucky 的 STUN WebHook 中使用 `GET` 请求：

```text
https://vpn.example.com/update?key=123456abcdef&target=https%3A%2F%2Fsh.example.com%3A#{port}&ruleName=#{ruleName}
```

请将 `123456abcdef` 替换为实际的 `API_KEY`。若目标地址中包含查询参数，需对 `target` 的完整 URL 进行 URL 编码。

每次更新会保存：

- `ruleName`：规则名称
- `target`：目标 HTTP 或 HTTPS URL
- `lastUpdate`：UTC 更新时间

## 接口

### 更新规则

```text
GET /update
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `key` | 是 | 与 `API_KEY` 一致的密钥 |
| `ruleName` | 是 | Lucky 规则名称 |
| `target` | 是 | 完整的 HTTP 或 HTTPS 目标 URL |

示例：

```text
/update?key=123456abcdef&ruleName=Shanghai%20STUN&target=https%3A%2F%2Fsh.example.com%3A45678
```

成功响应：

```json
{
  "success": true,
  "message": "Updated",
  "ruleName": "Shanghai STUN",
  "target": "https://sh.example.com:45678",
  "lastUpdate": "2026-07-14T12:25:31.000Z"
}
```

### 状态 JSON

```text
GET /api/status
```

响应包含所有规则：

```json
{
  "statuses": [
    {
      "ruleName": "Shanghai STUN",
      "target": "https://sh.example.com:45678",
      "lastUpdate": "2026-07-14T12:25:31.000Z"
    }
  ]
}
```

### 状态页面

```text
GET /status
```

访问 `https://vpn.example.com/status` 可查看全部规则。页面将浏览器时区用于显示最后更新时间，并可一键复制每条规则的 URL。

### 规则跳转

```text
GET /<ruleName>
```

规则名会去除首尾空格、合并连续空格并转为小写。路径中含空格或特殊字符时需进行 URL 编码。

例如，规则名为 `Shanghai STUN`：

```text
https://vpn.example.com/shanghai%20stun
```

该地址将以 `302` 跳转到该规则当前的目标 URL。

根路径 `/` 显示默认欢迎页，不承担跳转功能。

## Lucky 变量

常用 Lucky WebHook 变量：

```text
#{port}
#{ip}
#{ipAddr}
#{ruleName}
#{time}
```

本项目的 WebHook 至少需要：

```text
#{port}
#{ruleName}
```

## License

MIT

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![Lucky](https://img.shields.io/badge/Lucky-STUN-00C853)
![MIT](https://img.shields.io/badge/License-MIT-blue.svg)
