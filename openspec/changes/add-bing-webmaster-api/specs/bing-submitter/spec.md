# Bing Webmaster API Submission Capability

## ADDED Requirements

### Requirement: Bing Webmaster API Submission

系统 SHALL 支持通过 Bing Webmaster API 提交 URL 到 Bing 搜索引擎。

**API 规范**:
- 端点: `POST https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch?apikey={apiKey}`
- Content-Type: `application/json; charset=utf-8`
- 请求体: `{ "siteUrl": "{siteUrl}", "urlList": ["{url1}", "{url2}", ...] }`

#### Scenario: 成功提交 URL 到 Bing

- **GIVEN** 站点已配置有效的 `bingApiKey`
- **AND** `bingEnabled` 为 `true`
- **AND** 当日配额未用完
- **WHEN** 系统执行 Bing 提交
- **THEN** 系统 SHALL 发送 POST 请求到 Bing API
- **AND** 请求体包含 `siteUrl` 和 `urlList`
- **AND** HTTP 200 响应表示成功

#### Scenario: Bing API 返回错误

- **GIVEN** Bing API 返回非 200 状态码
- **WHEN** 系统收到错误响应
- **THEN** 系统 SHALL 记录错误日志，包含 `ErrorCode` 和 `Message`
- **AND** 系统 SHALL 不更新配额计数
- **AND** 系统 SHALL 不缓存这些 URL 为已提交

#### Scenario: Bing API 限流 (HTTP 429)

- **GIVEN** Bing API 返回 HTTP 429 Too Many Requests
- **WHEN** 系统收到限流响应
- **THEN** 系统 SHALL 等待 60 秒后重试
- **AND** 最多重试 3 次
- **AND** 重试失败后记录错误并放弃

---

### Requirement: 每日配额管理

系统 SHALL 追踪每个站点每日的 Bing 提交配额使用情况。

**配额规则**:
- 默认配额: 100 条/站点/天
- 重置时间: UTC 00:00
- 配额范围: 1-500（可配置）

#### Scenario: 查询剩余配额

- **GIVEN** 站点 `example.com` 今日已提交 85 条
- **AND** 配置的 `bingDailyQuota` 为 100
- **WHEN** 系统查询剩余配额
- **THEN** 系统 SHALL 返回 15

#### Scenario: 配额耗尽时跳过提交

- **GIVEN** 站点今日配额已用完（remaining = 0）
- **WHEN** 调度器执行 Bing 提交步骤
- **THEN** 系统 SHALL 跳过 Bing 提交
- **AND** 系统 SHALL 记录日志 "Bing quota exhausted, skipping"
- **AND** IndexNow 提交不受影响

#### Scenario: 跨日配额重置

- **GIVEN** 站点昨日已用配额 100 条
- **WHEN** UTC 时间进入新的一天
- **THEN** 系统 SHALL 自动重置配额为 0
- **AND** 系统 SHALL 允许提交新的 100 条

#### Scenario: 提交成功后更新配额

- **GIVEN** 站点今日已用 50 条配额
- **WHEN** 成功提交 30 条 URL
- **THEN** 系统 SHALL 更新已用配额为 80
- **AND** 系统 SHALL 记录更新时间戳

#### Scenario: 执行跨越 UTC 午夜

- **GIVEN** 执行开始于 UTC 2025-01-15 23:58:00
- **AND** 站点当日（2025-01-15）已用 90 条配额
- **AND** 执行过程持续 5 分钟
- **WHEN** 执行于 UTC 2025-01-16 00:03:00 完成
- **THEN** 系统 SHALL 使用执行开始日期 2025-01-15 的配额键
- **AND** 新提交的 10 条 URL 计入 2025-01-15 配额
- **AND** 总计已用配额为 100

#### Scenario: 并发执行配额冲突

- **GIVEN** 站点今日已用 95 条配额
- **AND** 两个并发请求同时读取到剩余配额为 5
- **WHEN** 两个请求分别提交 5 条 URL
- **THEN** 系统 SHALL 记录实际已用配额为 105（接受软限制超额）
- **AND** Bing API 可能拒绝部分请求返回 403
- **AND** 系统 SHALL 记录超额日志供审计

---

### Requirement: URL 渠道隔离

系统 SHALL 分别追踪 IndexNow 和 Bing 渠道的 URL 提交状态。

**存储规则**:
- IndexNow: `url_cache:{siteId}:{urlHash}` (保持现有格式)
- Bing: `url_cache:bing:{siteId}:{urlHash}`

#### Scenario: URL 已提交到 IndexNow 但未提交到 Bing

- **GIVEN** URL `https://example.com/page1` 已通过 IndexNow 提交
- **AND** 该 URL 未通过 Bing API 提交
- **WHEN** 系统过滤待提交 URL（channel=bing）
- **THEN** 该 URL SHALL 出现在待提交列表中

#### Scenario: URL 已提交到两个渠道

- **GIVEN** URL 已通过 IndexNow 和 Bing 都提交过
- **WHEN** 系统分别过滤两个渠道的待提交 URL
- **THEN** 该 URL SHALL 不出现在任何待提交列表中

---

### Requirement: URL 优先级选择

当待提交 URL 数量超过剩余配额时，系统 SHALL 根据配置的优先级策略选择 URL。

**策略选项**:
- `newest`: 按 sitemap 中的 `lastmod` 时间降序，最新优先
- `random`: 随机选择

#### Scenario: 使用 newest 策略选择 URL

- **GIVEN** 有 200 个待提交 URL
- **AND** 剩余配额为 50
- **AND** `bingPriority` 配置为 `newest`
- **WHEN** 系统选择待提交 URL
- **THEN** 系统 SHALL 返回 `lastmod` 最新的 50 个 URL
- **AND** URL 按 `lastmod` 降序排列

#### Scenario: 使用 random 策略选择 URL

- **GIVEN** 有 200 个待提交 URL
- **AND** 剩余配额为 50
- **AND** `bingPriority` 配置为 `random`
- **WHEN** 系统选择待提交 URL
- **THEN** 系统 SHALL 随机返回 50 个 URL
- **AND** 每次执行选择的 URL 可能不同

#### Scenario: 待提交 URL 少于剩余配额

- **GIVEN** 有 30 个待提交 URL
- **AND** 剩余配额为 100
- **WHEN** 系统选择待提交 URL
- **THEN** 系统 SHALL 返回全部 30 个 URL

#### Scenario: URL 缺少 lastmod 时的处理

- **GIVEN** 有 100 个待提交 URL
- **AND** 其中 30 个 URL 有 `lastmod` 字段
- **AND** 其中 70 个 URL 无 `lastmod` 字段
- **AND** `bingPriority` 配置为 `newest`
- **AND** 剩余配额为 50
- **WHEN** 系统选择待提交 URL
- **THEN** 系统 SHALL 优先返回有 `lastmod` 的 30 个 URL
- **AND** 然后从无 `lastmod` 的 URL 中随机选择 20 个补足配额

#### Scenario: 单次请求超过 100 条 URL

- **GIVEN** 有 150 个待提交 URL
- **AND** 剩余配额为 150
- **WHEN** 系统执行 Bing 提交
- **THEN** 系统 SHALL 分两批提交
- **AND** 第一批 100 条 URL
- **AND** 第二批 50 条 URL
- **AND** 总计更新配额 150

---

### Requirement: 站点配置扩展

系统 SHALL 在 `SiteConfig` 中支持 Bing 相关配置字段。

**字段定义**:

| 字段 | 类型 | 必填 | 默认值 | 验证规则 |
|------|------|------|--------|----------|
| `bingEnabled` | boolean | 否 | `false` | - |
| `bingApiKey` | string | 启用时必填 | - | 非空字符串 |
| `bingDailyQuota` | number | 否 | `100` | 1 ≤ n ≤ 500 |
| `bingPriority` | enum | 否 | `'newest'` | 'newest' \| 'random' |

#### Scenario: 创建站点时启用 Bing

- **GIVEN** 用户 POST `/api/sites` 包含 `bingEnabled: true` 和 `bingApiKey`
- **WHEN** 系统处理请求
- **THEN** 系统 SHALL 创建站点并启用 Bing 提交
- **AND** 使用提供的 `bingApiKey`
- **AND** 使用默认 `bingDailyQuota: 100`
- **AND** 使用默认 `bingPriority: 'newest'`

#### Scenario: 启用 Bing 但未提供 API Key

- **GIVEN** 用户 POST `/api/sites` 包含 `bingEnabled: true` 但无 `bingApiKey`
- **WHEN** 系统验证配置
- **THEN** 系统 SHALL 返回 HTTP 400
- **AND** 错误信息包含 "bingApiKey is required when bingEnabled is true"

#### Scenario: 为现有站点启用 Bing

- **GIVEN** 站点 `example.com` 已存在且未启用 Bing
- **WHEN** 用户 PUT `/api/sites/example.com` 包含 `bingEnabled: true` 和 `bingApiKey`
- **THEN** 系统 SHALL 更新站点配置
- **AND** 后续调度执行 SHALL 包含 Bing 提交

---

### Requirement: API 响应扩展

系统 SHALL 在相关 API 响应中包含 Bing 配额和统计信息。

#### Scenario: /status 返回 Bing 配额信息

- **GIVEN** 站点启用了 Bing 提交
- **AND** 今日已用配额 85
- **WHEN** 请求 `GET /status?site=example.com`
- **THEN** 响应 SHALL 包含:
  ```json
  {
    "bing": {
      "enabled": true,
      "todayQuotaUsed": 85,
      "todayQuotaRemaining": 15,
      "lastSubmission": "2025-01-15T10:30:00Z"
    }
  }
  ```

#### Scenario: /status 对未启用 Bing 的站点

- **GIVEN** 站点未启用 Bing 提交
- **WHEN** 请求 `GET /status?site=example.com`
- **THEN** 响应 SHALL 包含:
  ```json
  {
    "bing": {
      "enabled": false
    }
  }
  ```

#### Scenario: /api/stats/daily 包含 Bing 统计

- **WHEN** 请求 `GET /api/stats/daily?days=7`
- **THEN** 每日统计 SHALL 分别显示 IndexNow 和 Bing 数据:
  ```json
  {
    "daily": [
      {
        "date": "2025-01-15",
        "indexnow": { "total": 1500, "successful": 1480 },
        "bing": { "total": 100, "successful": 98 }
      }
    ]
  }
  ```

---

### Requirement: 错误隔离

Bing 提交的成功或失败 SHALL NOT 影响 IndexNow 提交的执行。

#### Scenario: Bing 提交失败但 IndexNow 成功

- **GIVEN** IndexNow 提交成功
- **AND** Bing API 返回错误
- **WHEN** 调度执行完成
- **THEN** IndexNow 的结果 SHALL 正常保存
- **AND** IndexNow 已提交的 URL SHALL 正常缓存
- **AND** 执行记录 SHALL 标记 Bing 部分失败

#### Scenario: Bing 配置无效不阻塞 IndexNow

- **GIVEN** 站点的 `bingApiKey` 无效
- **AND** 站点的 IndexNow 配置正确
- **WHEN** 调度器执行
- **THEN** IndexNow 提交 SHALL 正常执行
- **AND** Bing 提交 SHALL 记录认证错误
- **AND** 整体执行 SHALL 不被中断

---

### Requirement: 手动触发支持渠道选择

`/trigger` 端点 SHALL 支持指定提交渠道。

**参数**: `channel` = `all` | `indexnow` | `bing`
**默认**: `all`

#### Scenario: 仅触发 Bing 提交

- **GIVEN** 站点启用了 Bing 提交
- **WHEN** 请求 `GET /trigger?site=example.com&channel=bing`
- **THEN** 系统 SHALL 仅执行 Bing 提交流程
- **AND** IndexNow 提交 SHALL 被跳过

#### Scenario: 触发全部渠道

- **WHEN** 请求 `GET /trigger?site=example.com&channel=all`
- **THEN** 系统 SHALL 执行 IndexNow 和 Bing 两个渠道的提交

#### Scenario: 触发 Bing 但站点未启用

- **GIVEN** 站点未启用 Bing 提交
- **WHEN** 请求 `GET /trigger?site=example.com&channel=bing`
- **THEN** 系统 SHALL 返回 HTTP 400
- **AND** 错误信息包含 "Bing submission is not enabled for this site"
