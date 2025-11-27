# Design: Bing Webmaster API Integration

## Context

### Bing Webmaster API 规范

**端点**:
```
POST https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch?apikey={apiKey}
```

**请求体**:
```json
{
  "siteUrl": "https://example.com",
  "urlList": [
    "https://example.com/page1",
    "https://example.com/page2"
  ]
}
```

**响应**:
```json
// 成功 (HTTP 200)
{ "d": null }

// 错误 (HTTP 400/401/403)
{ "ErrorCode": 2, "Message": "ERROR_INVALID_API_KEY" }
```

**限制**:
- 每个站点每天 100 条 URL 配额
- 配额按 UTC 时间每日 00:00 重置
- 单次请求最大 100 条 URL（系统强制限制）

**siteUrl 参数**:
- 从 `sitemapUrl` 提取 origin
- 示例: `https://example.com/sitemap.xml` → `https://example.com`

### 约束条件

1. **Cloudflare Workers 限制**
   - 单次请求最多 50 个子请求
   - CPU 时间限制（免费版 10ms，付费版 50ms）

2. **复用要求**
   - 必须复用现有 SiteConfig 结构
   - 必须复用现有 Sitemap 爬取逻辑
   - 必须保持 IndexNow 功能不变

## Goals / Non-Goals

### Goals
- 支持通过 Bing Webmaster API 提交 URL
- 每日配额精确追踪，避免超额
- URL 去重独立于 IndexNow（两个渠道分开追踪）
- 提供配额查询 API
- 错误隔离（Bing 失败不影响 IndexNow）

### Non-Goals
- 不支持 Bing URL Removal API
- 不支持 Bing URL Inspection API
- 不实现配额预警通知
- 不实现跨站点配额池化

## Decisions

### Decision 1: URL 缓存键设计

**选择**: 使用 `url_cache:{channel}:{siteId}:{urlHash}` 格式

**原因**:
- IndexNow 和 Bing 是独立渠道，URL 可能在一个渠道提交但另一个未提交
- 现有 `url_cache:{siteId}:{urlHash}` 保持不变（向后兼容）
- Bing 使用 `url_cache:bing:{siteId}:{urlHash}`

**替代方案**:
- ❌ 共用缓存键 - 会导致 Bing 无法提交 IndexNow 已提交的 URL
- ❌ 在值中存储渠道状态 - 需要读取后判断，增加复杂度

### Decision 2: 配额存储设计

**选择**: `bing:quota:{siteId}:{YYYY-MM-DD}` 存储当日已用数量

**原因**:
- 按日期分键，自然实现每日重置（无需清理逻辑）
- 查询简单：`GET` 一次即可知道已用配额
- KV TTL 设置 48 小时，自动清理过期数据

**数据格式**:
```json
{
  "used": 85,
  "lastUpdate": "2025-01-15T10:30:00Z"
}
```

**跨日执行处理**:
- 一次执行过程中，使用**执行开始时的 UTC 日期**作为配额键
- 即使执行跨越 UTC 00:00，配额仍归属于开始日期
- 避免配额计数混乱

**并发更新处理**:
- Cloudflare KV 不支持原子增量操作
- 接受配额为**软限制**：极端并发情况可能少量超额
- Bing API 会拒绝超配额请求，返回 403 错误
- 系统记录日志供审计，不影响功能正确性

### Decision 3: URL 优先级策略

**选择**: 支持两种策略，默认 `newest`

| 策略 | 说明 | 适用场景 |
|------|------|----------|
| `newest` | 按 `lastmod` 最新优先 | 新内容优先收录 |
| `random` | 随机选择 | 均匀覆盖 |

**原因**:
- 配额有限（100/天），需要策略选择最有价值的 URL
- `newest` 确保新内容优先被索引
- `random` 避免某些 URL 长期未提交

**lastmod 缺失处理**:
- 使用 `newest` 策略时，无 `lastmod` 的 URL 视为最旧（排在最后）
- 有 `lastmod` 的 URL 按日期降序排列
- 保证有更新时间的新内容优先提交

**不实现的策略**:
- ❌ `priority` (按 sitemap priority) - 多数站点 priority 都是 0.5，无区分度
- ❌ `oldest` - 老内容已有机会被自然收录

### Decision 4: 提交时机

**选择**: 在 IndexNow 提交后执行 Bing 提交

**流程**:
```
Sitemap 爬取 → URL 过滤 → IndexNow 提交 → Bing 提交 → 保存记录
                              ↓                ↓
                         无配额限制      检查配额 → 选择 URL → 提交
```

**原因**:
- IndexNow 无配额限制，应优先完成
- Bing 提交是增量能力，不应阻塞主流程
- 即使 Bing 失败，IndexNow 结果已保存

### Decision 5: 错误处理

**Bing API 错误码处理**:

| HTTP 状态 | 错误码 | 处理方式 |
|----------|--------|----------|
| 200 | - | 成功，更新配额计数 |
| 400 | ERROR_INVALID_URL | 记录错误，跳过该 URL |
| 401 | ERROR_INVALID_API_KEY | 记录错误，禁用该站点 Bing 提交 |
| 403 | ERROR_QUOTA_EXCEEDED | 停止提交，标记配额已满 |
| 429 | - | 等待后重试（指数退避） |
| 5xx | - | 重试 3 次后放弃 |

## Data Model

### SiteConfig 扩展

```typescript
interface SiteConfig {
  // ... 现有字段保持不变 ...

  // Bing Webmaster API 配置
  bingEnabled: boolean        // 默认 false
  bingApiKey?: string         // Bing API Key
  bingDailyQuota: number      // 默认 100
  bingPriority: 'newest' | 'random'  // 默认 'newest'
}
```

### CreateSiteInput 扩展

```typescript
interface CreateSiteInput {
  // ... 现有字段 ...

  // Bing 配置（可选）
  bingEnabled?: boolean
  bingApiKey?: string
  bingDailyQuota?: number
  bingPriority?: 'newest' | 'random'
}
```

### BingQuotaRecord

```typescript
interface BingQuotaRecord {
  used: number           // 当日已用
  lastUpdate: string     // ISO 8601 时间戳
}
```

### BingSubmissionResult

```typescript
interface BingSubmissionResult {
  success: boolean
  urlCount: number
  statusCode?: number
  errorCode?: string
  errorMessage?: string
  timestamp: number
}
```

## KV Storage Schema

| Key Pattern | Value | TTL | Description |
|-------------|-------|-----|-------------|
| `bing:quota:{siteId}:{date}` | BingQuotaRecord JSON | 48h | 当日配额使用 |
| `url_cache:bing:{siteId}:{hash}` | `"1"` | 30d | Bing 已提交标记 |

**注意**: Bing 执行历史不单独存储，而是扩展现有的 `sites:history:{siteId}` 记录，新增 `bingStats` 字段。这样避免数据冗余，保持执行记录的完整性。

## API Changes

### GET /status?site={siteId}

**响应扩展**:
```json
{
  "status": "running",
  "siteId": "example.com",
  "lastExecution": { ... },
  "bing": {
    "enabled": true,
    "todayQuotaUsed": 85,
    "todayQuotaRemaining": 15,
    "lastSubmission": "2025-01-15T10:30:00Z"
  }
}
```

### GET /api/stats/daily

**响应扩展**:
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

### GET /api/sites/:id

**响应扩展**:
```json
{
  "site": {
    "id": "example.com",
    "bingEnabled": true,
    "bingApiKey": "****...****",  // 脱敏显示
    "bingDailyQuota": 100,
    "bingPriority": "newest"
  }
}
```

## Module Structure

```
src/modules/
├── bing-submitter.ts      # NEW: Bing API 提交器
├── quota-manager.ts       # NEW: 配额管理器
├── url-cache.ts           # MODIFY: 支持渠道参数
├── scheduler.ts           # MODIFY: 集成 Bing 提交
├── site-config-manager.ts # MODIFY: Bing 配置验证
└── ... (其他模块不变)
```

## Risks / Trade-offs

### Risk 1: Bing API 不稳定
- **影响**: Bing 提交失败
- **缓解**: 错误隔离，不影响 IndexNow；重试机制；记录错误日志

### Risk 2: 配额计数不准确
- **影响**: 可能超额或浪费配额
- **缓解**: 提交成功后才更新计数；使用 KV 原子操作

### Risk 3: 时区问题
- **影响**: 配额重置时间不准确
- **缓解**: 统一使用 UTC 时间；Bing 配额按 UTC 00:00 重置

## Open Questions

1. ~~是否需要支持手动触发 Bing 提交？~~ **决定**: 通过 `/trigger?site=xxx&channel=bing` 支持
2. ~~是否需要配额预警？~~ **决定**: 不在本期实现，可通过 `/status` API 查询
