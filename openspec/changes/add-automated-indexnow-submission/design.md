# 技术设计文档：自动化 IndexNow 提交系统

## Context

IndexNow 是由 Microsoft 和 Yandex 联合推出的开放协议，允许网站主动通知搜索引擎内容变化。本系统需要在 Cloudflare Workers 边缘计算环境中运行，具有以下约束：

- **CPU 时间限制**：
  - 免费计划：10ms CPU 时间
  - 付费计划（$5/月）：50ms CPU 时间
  - **总执行时间**：最长 30 秒（包括网络等待）
- **内存限制**：128MB 内存
- **存储**：必须使用 Cloudflare KV（最终一致性）
- **网络**：只能发起 HTTP/HTTPS 请求，无 TCP/UDP
- **子请求限制**：单个请求最多 6 个子请求（免费计划）

## Goals / Non-Goals

### Goals
✅ 每日自动采集指定网站的 sitemap.xml 并提交到 IndexNow
✅ 支持大型网站地图（数万个 URL）的高效处理
✅ 去重机制，避免重复提交已索引的 URL
✅ 完整的错误处理和重试逻辑
✅ 灵活的配置系统，支持多站点
✅ 监控和日志，便于调试和维护

### Non-Goals
❌ 不支持实时增量提交（仅每日全量扫描）
❌ 不提供 Web UI 配置界面
❌ 不支持自定义网站地图格式（仅支持标准 XML）
❌ 不实现搜索引擎爬虫（仅通知索引）

## Architecture

### 系统架构图

```
┌─────────────────────────────────────────────────┐
│         Cloudflare Workers Runtime              │
│                                                  │
│  ┌──────────────────────────────────────────┐  │
│  │  Cron Trigger (Daily at 00:00 UTC)       │  │
│  └────────────────┬─────────────────────────┘  │
│                   │                             │
│                   ▼                             │
│  ┌──────────────────────────────────────────┐  │
│  │     Scheduler Handler                     │  │
│  │  - Load configuration                     │  │
│  │  - Initialize crawler                     │  │
│  └────────────────┬─────────────────────────┘  │
│                   │                             │
│                   ▼                             │
│  ┌──────────────────────────────────────────┐  │
│  │     Sitemap Crawler                       │  │
│  │  - Fetch sitemap.xml via HTTP             │  │
│  │  - Parse XML and extract URLs             │  │
│  │  - Handle sitemap index files             │  │
│  └────────────────┬─────────────────────────┘  │
│                   │                             │
│                   ▼                             │
│  ┌──────────────────────────────────────────┐  │
│  │     URL Deduplicator (KV Storage)         │  │
│  │  - Check if URL already submitted         │  │
│  │  - Store submitted URLs with TTL          │  │
│  └────────────────┬─────────────────────────┘  │
│                   │                             │
│                   ▼                             │
│  ┌──────────────────────────────────────────┐  │
│  │     IndexNow Client                       │  │
│  │  - Batch URLs (max 10,000 per request)    │  │
│  │  - Submit to api.indexnow.org             │  │
│  │  - Handle API errors and retry            │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
           │                         │
           ▼                         ▼
    ┌──────────┐            ┌────────────────┐
    │ Sitemap  │            │  IndexNow API  │
    │   XML    │            │ (Search Engine)│
    └──────────┘            └────────────────┘
```

### 数据流

1. **Cron Trigger** → 每天 UTC 00:00 触发定时任务
2. **Load Config** → 从环境变量读取站点配置和 API 密钥
3. **Fetch Sitemap** → HTTP GET 请求获取 sitemap.xml
4. **Parse XML** → 提取所有 `<loc>` 标签中的 URL
5. **Deduplicate** → 检查 KV 存储，过滤已提交的 URL
6. **Submit to IndexNow** → 逐个 URL 发送 GET 请求到 `https://api.indexnow.org/indexnow?url=<URL>&key=<API-key>`
7. **Rate Limiting** → 每个请求之间间隔 100ms，避免触发限流
8. **Update Cache** → 将成功提交的 URL 存入 KV（30天 TTL）
9. **Log Results** → 记录成功/失败的 URL 数量

## Decisions

### Decision 1: 使用 Cloudflare Workers 而非传统服务器

**选择原因**：
- ✅ 零服务器维护成本
- ✅ 全球边缘节点部署，低延迟
- ✅ 免费额度足够日常使用（每天 100,000 次请求）
- ✅ 内置 Cron Triggers，无需额外调度服务

**替代方案**：
- ❌ AWS Lambda + EventBridge：需要 AWS 账号，配置复杂
- ❌ GitHub Actions：不适合定时任务，缺乏持久化存储
- ❌ 传统服务器 + Cron：需要维护服务器，成本高

### Decision 2: 使用 Cloudflare KV 作为 URL 缓存

**选择原因**：
- ✅ Workers 原生集成，无需额外配置
- ✅ 免费额度充足（每天 100,000 次读取，1,000 次写入）
- ✅ 支持 TTL 自动过期，简化清理逻辑

**替代方案**：
- ❌ Durable Objects：过于复杂，成本高
- ❌ 外部数据库（Redis/PostgreSQL）：增加网络延迟和成本

**权衡**：
- ⚠️ KV 是最终一致性，可能有 60 秒延迟
- ✅ 对于每日执行的任务，最终一致性是可接受的

### Decision 3: IndexNow API GET 请求提交策略

**API 格式**：
```
GET https://api.indexnow.org/indexnow?url=<URL>&key=<API-key>
```

**策略**：
- 逐个 URL 发送 GET 请求
- 每个请求之间间隔 100ms（每秒最多 10 个 URL）
- 使用并发控制，最多 3 个并发请求（为多搜索引擎和子请求限制预留余地）
- 失败时重试 3 次，指数退避（1s, 2s, 4s）

**性能优化**：
- 对于大量 URL（>1000），分批处理，每批 100 个
- 使用 Promise.allSettled 并发提交，避免一个失败影响全部
- 记录每个 URL 的提交状态

**限流保护**：
- 每秒最多 10 个请求（100ms 间隔）
- 如果收到 HTTP 429，等待 60 秒后继续
- 总执行时间超过 5 分钟时，保存进度，下次继续

### Decision 4: Sitemap 解析策略

**支持的格式**：
- ✅ 标准 sitemap.xml（`<urlset>` 格式）
- ✅ Sitemap 索引文件（`<sitemapindex>` 格式）
- ❌ 不支持 sitemap.txt 或其他自定义格式

**解析逻辑**：
```typescript
// 检测是否为 sitemap 索引文件
if (xml.includes('<sitemapindex')) {
  // 递归获取所有子 sitemap
  const sitemaps = extractSitemapLocations(xml)
  for (const sitemap of sitemaps) {
    await parseSitemap(sitemap.loc)
  }
} else {
  // 直接提取 URL
  const urls = extractUrls(xml)
  return urls
}
```

**性能优化**：
- 使用流式解析（不将整个 XML 加载到内存）
- 限制单个 sitemap 最大大小为 50MB
- 超时时间设置为 30 秒

### Decision 5: 错误处理和重试机制

**错误分类**：
1. **网络错误**（sitemap 获取失败）：
   - 重试 3 次，间隔 2 秒
   - 失败后记录错误日志，跳过本次执行

2. **解析错误**（XML 格式错误）：
   - 不重试，记录错误日志
   - 尝试降级处理（忽略无效 URL）

3. **IndexNow API 错误**：
   - HTTP 429（限流）：等待 60 秒后重试
   - HTTP 5xx（服务器错误）：重试 3 次
   - HTTP 4xx（客户端错误）：不重试，记录错误

**日志级别**：
- `INFO`：正常执行流程
- `WARN`：可恢复的错误（如重试成功）
- `ERROR`：不可恢复的错误（如 API 拒绝）

## Data Models

### Configuration (Environment Variables)

```typescript
interface Config {
  // 站点配置
  SITEMAP_URL: string                // 网站地图 URL，例如: https://example.com/sitemap.xml
  SITE_HOST: string                  // 站点域名，例如: example.com

  // IndexNow 配置
  INDEXNOW_API_KEY: string           // IndexNow API 密钥
  INDEXNOW_SEARCH_ENGINES: string[]  // 搜索引擎列表，例如: ["api.indexnow.org", "www.bing.com/indexnow"]

  // 调度配置
  CRON_SCHEDULE: string              // Cron 表达式，例如: "0 0 * * *" (每天 UTC 00:00)

  // 性能配置（可选）
  MAX_CONCURRENT_REQUESTS?: number   // 默认: 3（并发请求数，考虑子请求限制）
  REQUEST_INTERVAL_MS?: number       // 默认: 100（请求间隔，毫秒）
  CACHE_TTL_DAYS?: number            // 默认: 30
  MAX_RETRIES?: number               // 默认: 3
}
```

### URL Cache Entry (KV Storage)

```typescript
interface CacheEntry {
  url: string           // URL 地址
  submitted_at: number  // 提交时间戳（Unix timestamp）
  status: 'success' | 'failed'
}

// KV Key: url:<url_hash>
// KV Value: JSON.stringify(CacheEntry)
// TTL: 30 天（可配置）
```

### IndexNow API Request

```typescript
// GET 请求格式（官方规范）
// URL: https://api.indexnow.org/indexnow?url={url}&key={api_key}&keyLocation={key_location}

interface IndexNowGetParams {
  url: string          // 要提交的 URL（需要 URL 编码）
  key: string          // API 密钥
  keyLocation: string  // 密钥文件位置（需要 URL 编码）
}

// keyLocation 构建规则：
// https://{SITE_HOST}/{API_KEY}.txt
// 例如：https://example.com/your-api-key-32-characters-here.txt

// 请求示例：
// GET https://api.indexnow.org/indexnow?
//   url=https%3A%2F%2Fexample.com%2Fpage1
//   &key=your-api-key-32-characters-here
//   &keyLocation=https%3A%2F%2Fexample.com%2Fyour-api-key-32-characters-here.txt

// 响应：
// - HTTP 200: 提交成功
// - HTTP 202: 已接受（异步处理）
// - HTTP 400: 请求错误（URL、key 或 keyLocation 无效）
// - HTTP 403: 密钥验证失败（keyLocation 文件不存在或内容不匹配）
// - HTTP 429: 限流（请稍后重试）
// - HTTP 503: 服务不可用
```

### Execution Log

```typescript
interface ExecutionLog {
  timestamp: number
  total_urls: number
  new_urls: number
  cached_urls: number
  submitted_urls: number
  failed_urls: number
  errors: string[]
}
```

## Risks / Trade-offs

### Risk 1: Cloudflare Workers CPU 时间限制

**风险描述**：

处理大型 sitemap（>10,000 个 URL）在 CPU 时间限制内极具挑战：

- **免费计划**：10ms CPU 时间 - 几乎无法处理大型 sitemap
- **付费计划**：50ms CPU 时间 - 可处理中等规模 sitemap
- **总执行时间**：30 秒 - 包括网络等待，通常足够

对于免费计划，解析和处理 10,000 个 URL 的 CPU 时间远超 10ms。

**缓解措施**：

- **推荐使用付费计划**（$5/月）获得 50ms CPU 时间
- 使用流式解析，避免一次性加载整个 XML
- 分批处理 URL，每批 100 个，利用总执行时间（30s）而非 CPU 时间
- 实现进度保存机制，超时后下次继续
- 如果站点 URL 数量 >5,000，考虑：
  - 增加 Cron 执行频率（每天多次）
  - 使用 sitemap 索引文件分割大型 sitemap
  - 或使用 Durable Objects（成本更高）

**监控指标**：
- CPU 时间使用率（关键指标）
- 总执行时间
- 单次执行处理的 URL 数量
- 超时次数

### Risk 2: KV 存储的最终一致性

**风险描述**：KV 写入后 60 秒内可能读取到旧数据，导致重复提交。

**影响评估**：
- 低风险：每日执行一次，间隔 24 小时，远大于 60 秒
- IndexNow API 本身支持去重，重复提交不会造成严重问题

**缓解措施**：
- 在本地内存中维护当前批次的 URL 集合，避免同一批次内重复

### Risk 3: IndexNow API 限流

**风险描述**：超出 API 限流限制（具体限制由搜索引擎决定）。

**缓解措施**：
- 实现速率限制：每批提交后等待 1 秒
- 检测 HTTP 429 响应，自动降低提交频率
- 记录失败的 URL，下次执行时优先提交

### Risk 4: KV 写入配额限制

**风险描述**：

Cloudflare KV 免费计划写入配额有限：

- **免费计划**：每天 1,000 次写入
- **付费计划**：$0.50 / 百万次写入

对于大型站点：
- 每天新增 2,000 个 URL → 需要 2,000 次 KV 写入 → 超出免费配额 ❌
- 每次写入一个 URL 的缓存记录

**影响评估**：
- 超出配额后，缓存功能失效，可能导致重复提交
- 或产生额外费用（每超出 1,000 次写入 ≈ $0.0005）

**缓解措施**：

1. **批量写入优化**：
   - 将多个 URL 的缓存记录合并为一个 JSON 对象
   - 例如：每批 100 个 URL 只需 1 次 KV 写入
   - 将每天写入次数从 2,000 降至 20 ✓

2. **增加缓存 TTL**：
   - 从 30 天增加到 60 天或 90 天
   - 减少缓存过期导致的重新写入

3. **选择性缓存**：
   - 只缓存成功提交的 URL
   - 失败的 URL 不写入缓存（下次重试）

4. **考虑付费计划**：
   - $0.50 / 百万次写入
   - 对于每天 2,000 次写入，每月成本 ≈ $0.03（几乎可忽略）

**监控指标**：
- 每日 KV 写入次数
- 免费配额使用百分比
- 批量写入效率

### Risk 5: Sitemap 获取失败

**风险描述**：网站宕机或网络故障导致 sitemap 无法获取。

**缓解措施**：
- 实现重试机制（最多 3 次）
- 使用备用 sitemap URL（如果配置了多个）
- 记录错误日志，发送告警通知（通过 Webhook）

## Migration Plan

### 阶段 1: 初始部署（第 1 周）
1. 创建 Cloudflare Workers 项目
2. 配置 KV 命名空间
3. 设置环境变量和 Cron Triggers
4. 部署到 Cloudflare 边缘网络
5. 手动触发测试执行

### 阶段 2: 监控和优化（第 2-3 周）
1. 监控执行日志和错误率
2. 优化 XML 解析性能
3. 调整批量大小和重试策略
4. 添加告警通知（可选）

### 阶段 3: 功能扩展（第 4 周及以后）
1. 支持多站点配置
2. 添加 Web UI 查看执行历史
3. 实现增量提交（仅提交变化的 URL）
4. 集成更多搜索引擎（Google, Yandex, Naver 等）

### 回滚计划

如果部署后出现严重问题：
1. 禁用 Cron Trigger（停止自动执行）
2. 回滚到上一个稳定版本
3. 清理 KV 存储中的错误数据
4. 修复问题后重新部署

## Open Questions

1. **Q**: 是否需要支持自定义 HTTP 请求头（如 User-Agent）？
   **A**: 待确认，建议初始版本使用默认 User-Agent。

2. **Q**: 是否需要实现 Webhook 告警（执行失败时通知）？
   **A**: 待确认，可以作为可选功能在第 2 阶段实现。

3. **Q**: 是否需要支持多个 sitemap URL（如不同语言版本）？
   **A**: 待确认，建议初始版本支持单个 sitemap。

4. **Q**: 缓存 TTL 应该设置为多少天？
   **A**: 建议 30 天，可通过环境变量配置。

5. **Q**: 是否需要记录每次执行的详细日志到外部存储？
   **A**: 待确认，初始版本仅使用 Workers 内置日志。
