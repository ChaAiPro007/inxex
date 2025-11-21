# IndexNow 多网站架构设计方案

## 📋 需求分析

### 当前问题
1. ❌ 配置硬编码在 `wrangler.toml`，只支持单个网站
2. ❌ 无法通过参数区分不同网站
3. ❌ Cron 触发器无法处理多个网站
4. ❌ KV 缓存没有网站隔离

### 目标需求
1. ✅ 支持动态添加/删除网站配置
2. ✅ 手动触发：`/trigger?site=example.com`
3. ✅ 自动提交：Cron 轮询所有网站
4. ✅ 数据隔离：每个网站独立的缓存和历史记录

---

## 🏗️ 架构设计

### 方案对比

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **KV 存储配置** | 动态管理、无需重新部署、支持Web UI | KV读取延迟 | ⭐⭐⭐⭐⭐ |
| **环境变量 JSON** | 快速读取、简单直接 | 修改需重新部署、有大小限制 | ⭐⭐ |
| **Durable Objects** | 强一致性、复杂逻辑 | 成本高、过度设计 | ⭐ |

**最终选择**: **KV 存储 + 配置管理 API**

---

## 📦 数据结构设计

### 1. 网站配置 (SiteConfig)

```typescript
interface SiteConfig {
  // 基础信息
  id: string                    // 网站标识，如 "example.com"
  name: string                  // 显示名称，如 "Example Site"

  // IndexNow 配置
  sitemapUrl: string            // https://example.com/sitemap.xml
  apiKey: string                // IndexNow API 密钥
  keyLocation: string           // https://example.com/{key}.txt
  searchEngines: string[]       // ["api.indexnow.org"]

  // 调度配置
  enabled: boolean              // 是否启用自动提交
  interval: number              // 提交间隔（小时），如 6
  lastRunTime: number           // 上次执行时间戳

  // 性能配置
  maxConcurrentRequests: number // 最大并发请求数（默认3）
  requestIntervalMs: number     // 请求间隔（默认100ms）
  maxRetries: number            // 最大重试次数（默认3）
  cacheTtlDays: number          // 缓存TTL天数（默认30）

  // 元数据
  createdAt: string             // ISO 8601 时间戳
  updatedAt: string             // ISO 8601 时间戳
}
```

### 2. KV 存储结构

```
# 配置存储
sites:config:{siteId}                → SiteConfig JSON
sites:list                           → string[] (所有网站ID)

# URL 缓存（每个网站独立）
sites:cache:{siteId}:url:{urlHash}   → timestamp

# 执行历史（每个网站独立）
sites:history:{siteId}               → ExecutionRecord[] (最近100次 + 1年内自动清理)
sites:last_execution:{siteId}        → ExecutionRecord

# 全局统计
sites:stats:global                   → GlobalStats
```

**历史记录自动清理策略**:
- **数量限制**: 最多保留 100 条记录
- **时间限制**: 只保留 1 年内（365天）的数据
- **清理时机**: 每次保存新记录时自动清理过期数据
- **清理逻辑**: 先按数量取前100条，再过滤掉1年前的记录
- **存储优化**: 约 100-200 KB/站点，远低于 KV 25MB 限制

### 3. 执行记录 (ExecutionRecord)

```typescript
interface ExecutionRecord {
  siteId: string
  timestamp: string
  stats: {
    total: number
    successful: number
    failed: number
    skipped: number
    duration: number
    errors: string[]
  }
  batches: Array<{
    success: boolean
    statusCode?: number
    error?: string
  }>
}
```

---

## 🛣️ API 路由设计

### 管理 API

```
# 网站配置管理
GET    /api/sites                    列出所有网站
GET    /api/sites/:siteId            查看网站配置
POST   /api/sites                    添加新网站
PUT    /api/sites/:siteId            更新网站配置
DELETE /api/sites/:siteId            删除网站

# 批量操作
POST   /api/sites/import             批量导入网站
GET    /api/sites/export             导出所有配置
```

### 提交 API

```
# 手动触发
GET /trigger?site=:siteId             触发指定网站
GET /trigger?site=all                 触发所有网站（串行）
GET /trigger                          触发所有网站（默认行为）

# 状态查询
GET /status?site=:siteId              查看网站状态
GET /status                           查看所有网站状态

# 历史记录
GET /history?site=:siteId             查看网站历史
GET /history                          查看所有网站历史
```

### 请求示例

```bash
# 添加新网站
curl -X POST https://your-worker.workers.dev/api/sites \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "example.com",
    "name": "Example Site",
    "sitemapUrl": "https://example.com/sitemap.xml",
    "apiKey": "your-api-key",
    "enabled": true,
    "interval": 6
  }'

# 触发特定网站
curl "https://your-worker.workers.dev/trigger?site=example.com"

# 查看网站状态
curl "https://your-worker.workers.dev/status?site=example.com"
```

---

## ⚙️ 核心模块改造

### 1. SiteConfigManager (新增)

```typescript
class SiteConfigManager {
  private kv: KVNamespace

  // CRUD 操作
  async getSite(siteId: string): Promise<SiteConfig | null>
  async listSites(): Promise<SiteConfig[]>
  async addSite(config: SiteConfig): Promise<void>
  async updateSite(siteId: string, config: Partial<SiteConfig>): Promise<void>
  async deleteSite(siteId: string): Promise<void>

  // 验证
  async validateSite(config: SiteConfig): Promise<ValidationResult>

  // 查询
  async getEnabledSites(): Promise<SiteConfig[]>
  async getSitesToRun(): Promise<SiteConfig[]>  // 检查 interval
}
```

### 2. Scheduler (改造)

```typescript
class Scheduler {
  private env: Env
  private siteId: string  // ← 新增：网站ID

  constructor(env: Env, siteId: string) {
    this.env = env
    this.siteId = siteId
  }

  // 执行流程（基本不变，但使用动态配置）
  async run(): Promise<SubmissionStats> {
    // 1. 从 KV 加载网站配置
    const config = await this.loadSiteConfig()

    // 2. 使用带 siteId 的缓存键
    const cache = new UrlCache(
      this.env.CACHE,
      config.cacheTtlDays,
      this.siteId  // ← 传入 siteId 实现隔离
    )

    // 3. 保存执行记录时使用 siteId
    await this.saveExecutionRecord(stats, results, this.siteId)

    // ...
  }
}
```

### 3. UrlCache (改造)

```typescript
class UrlCache {
  private kv: KVNamespace
  private ttlSeconds: number
  private siteId: string  // ← 新增：网站ID

  constructor(kv: KVNamespace, ttlDays: number, siteId: string) {
    this.kv = kv
    this.ttlSeconds = ttlDays * 86400
    this.siteId = siteId
  }

  // 生成带网站前缀的键
  private getCacheKey(url: string): string {
    const hash = this.hashUrl(url)
    return `sites:cache:${this.siteId}:url:${hash}`
  }

  // 其他方法保持不变，但使用新的键格式
}
```

### 4. IndexNowSubmitter (无需改造)

不需要改动，因为它只负责提交逻辑，与网站管理无关。

---

## 🔄 自动提交策略

### Cron 调度器

```typescript
// Cron: 每小时执行一次
async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
  logger.info('=== Multi-Site Cron Started ===')

  const manager = new SiteConfigManager(env.CACHE)

  // 1. 获取所有启用的网站
  const sites = await manager.getEnabledSites()
  logger.info(`Found ${sites.length} enabled sites`)

  // 2. 筛选需要执行的网站（检查 interval）
  const sitesToRun = sites.filter(site => {
    const now = Date.now()
    const elapsed = now - (site.lastRunTime || 0)
    const shouldRun = elapsed >= site.interval * 3600000
    return shouldRun
  })

  logger.info(`${sitesToRun.length} sites need to run`)

  // 3. 并发执行（最多 3 个网站同时处理）
  const BATCH_SIZE = 3
  for (let i = 0; i < sitesToRun.length; i += BATCH_SIZE) {
    const batch = sitesToRun.slice(i, i + BATCH_SIZE)

    await Promise.all(
      batch.map(async (site) => {
        try {
          logger.info(`Running site: ${site.id}`)

          const scheduler = new Scheduler(env, site.id)
          const stats = await scheduler.run()

          // 更新最后执行时间
          await manager.updateSite(site.id, {
            lastRunTime: Date.now()
          })

          logger.info(`Site ${site.id} completed:`, stats)
        } catch (error) {
          logger.error(`Site ${site.id} failed:`, error)
          // 不中断其他网站的执行
        }
      })
    )
  }

  logger.info('=== Multi-Site Cron Completed ===')
}
```

### 调度策略

1. **独立间隔**: 每个网站有自己的提交间隔（6小时、12小时、24小时等）
2. **并发控制**: 最多3个网站同时处理，避免资源耗尽
3. **错误隔离**: 一个网站失败不影响其他网站
4. **优先级**: 可选功能，支持高优先级网站优先执行

---

## 🔐 安全设计

### 1. API 认证

```typescript
// 管理 API 需要 Bearer Token
const ADMIN_TOKEN = env.ADMIN_TOKEN || 'default-secret-token'

function requireAuth(request: Request): void {
  const auth = request.headers.get('Authorization')
  if (!auth || auth !== `Bearer ${ADMIN_TOKEN}`) {
    throw new Error('Unauthorized')
  }
}
```

### 2. 网站验证

```typescript
async function validateSite(config: SiteConfig): Promise<ValidationResult> {
  const errors: string[] = []

  // 1. 验证 sitemap 可访问
  try {
    const response = await fetch(config.sitemapUrl, { method: 'HEAD' })
    if (!response.ok) {
      errors.push(`Sitemap not accessible: ${response.status}`)
    }
  } catch (error) {
    errors.push(`Sitemap fetch failed: ${error.message}`)
  }

  // 2. 验证 keyLocation 可访问
  try {
    const response = await fetch(config.keyLocation)
    const text = await response.text()
    if (text.trim() !== config.apiKey) {
      errors.push('API key verification failed')
    }
  } catch (error) {
    errors.push(`KeyLocation fetch failed: ${error.message}`)
  }

  // 3. 验证 API key 格式
  if (!/^[a-f0-9]{32}$/.test(config.apiKey)) {
    errors.push('Invalid API key format (expected 32 hex chars)')
  }

  return {
    valid: errors.length === 0,
    errors
  }
}
```

### 3. 访问控制

```typescript
// 不同级别的访问权限
enum AccessLevel {
  PUBLIC,   // /status, /history (只读)
  USER,     // /trigger (触发提交)
  ADMIN     // /api/sites (管理配置)
}
```

---

## 📊 性能优化

### 1. 配置缓存

```typescript
// 内存缓存配置，减少 KV 读取
class ConfigCache {
  private cache = new Map<string, { config: SiteConfig, expires: number }>()
  private TTL = 300000  // 5分钟

  async get(siteId: string, loader: () => Promise<SiteConfig>): Promise<SiteConfig> {
    const cached = this.cache.get(siteId)
    if (cached && cached.expires > Date.now()) {
      return cached.config
    }

    const config = await loader()
    this.cache.set(siteId, {
      config,
      expires: Date.now() + this.TTL
    })

    return config
  }
}
```

### 2. 批量操作

```typescript
// 批量读取配置
async function loadAllSites(): Promise<SiteConfig[]> {
  const siteIds = await kv.get('sites:list', 'json') || []

  // 并发读取所有配置
  const configs = await Promise.all(
    siteIds.map(id => kv.get(`sites:config:${id}`, 'json'))
  )

  return configs.filter(Boolean)
}
```

### 3. 限流保护

```typescript
// 全局限流：所有网站共享
class GlobalRateLimiter {
  private queue: Promise<any> = Promise.resolve()

  async throttle<T>(fn: () => Promise<T>, delayMs: number): Promise<T> {
    this.queue = this.queue.then(() =>
      fn().then(result => {
        return new Promise(resolve =>
          setTimeout(() => resolve(result), delayMs)
        )
      })
    )
    return this.queue
  }
}
```

---

## 🚀 实施计划

### Phase 1: 核心改造 (2-3小时)

- [x] 创建 `SiteConfigManager` 类
- [ ] 改造 `Scheduler` 支持 `siteId` 参数
- [ ] 改造 `UrlCache` 添加命名空间隔离
- [ ] 改造执行记录保存逻辑

### Phase 2: API 开发 (1-2小时)

- [ ] 实现配置管理 API (`/api/sites/*`)
- [ ] 改造触发 API (`/trigger?site=xxx`)
- [ ] 改造状态查询 API
- [ ] 添加 API 认证中间件

### Phase 3: 自动调度 (1小时)

- [ ] 改造 Cron 调度器
- [ ] 实现并发控制
- [ ] 添加错误隔离
- [ ] 更新最后执行时间

### Phase 4: 数据迁移 (30分钟)

- [ ] 迁移现有配置到 KV
- [ ] 迁移现有缓存到新键格式
- [ ] 迁移执行历史记录
- [ ] 验证数据完整性

### Phase 5: 测试 (1小时)

- [ ] 单元测试
- [ ] 集成测试
- [ ] 手动触发测试
- [ ] 自动调度测试
- [ ] 并发处理测试

### Phase 6: 文档和部署 (30分钟)

- [ ] 更新 README
- [ ] 创建迁移指南
- [ ] 部署到生产环境
- [ ] 监控运行状态

**预计总时间**: 6-8 小时

---

## 📝 配置示例

### 单个网站配置

```json
{
  "id": "example.com",
  "name": "Example Site",
  "sitemapUrl": "https://example.com/sitemap.xml",
  "apiKey": "your-32-character-api-key-here",
  "keyLocation": "https://example.com/your-32-character-api-key-here.txt",
  "searchEngines": ["api.indexnow.org"],
  "enabled": true,
  "interval": 6,
  "lastRunTime": 0,
  "maxConcurrentRequests": 3,
  "requestIntervalMs": 100,
  "maxRetries": 3,
  "cacheTtlDays": 30,
  "createdAt": "2025-11-10T08:00:00Z",
  "updatedAt": "2025-11-10T08:00:00Z"
}
```

### 批量导入

```json
{
  "sites": [
    {
      "id": "site1.com",
      "sitemapUrl": "https://site1.com/sitemap.xml",
      "apiKey": "key1...",
      "enabled": true,
      "interval": 6
    },
    {
      "id": "site2.com",
      "sitemapUrl": "https://site2.com/sitemap.xml",
      "apiKey": "key2...",
      "enabled": true,
      "interval": 12
    }
  ]
}
```

---

## 🎯 总结

### 优势

1. **灵活性**: 动态添加/删除网站，无需重新部署
2. **隔离性**: 每个网站独立的缓存和历史记录
3. **可扩展性**: 支持无限数量的网站（受KV限制）
4. **可维护性**: 清晰的数据结构和API设计
5. **性能**: 并发处理、配置缓存、批量操作

### 技术栈

- **存储**: Cloudflare KV
- **调度**: Cloudflare Cron Triggers
- **语言**: TypeScript
- **框架**: Cloudflare Workers

### 后续增强

1. **Web UI**: 可视化管理界面
2. **Webhook**: 提交完成后发送通知
3. **统计分析**: 全局统计和趋势分析
4. **导入导出**: 批量管理配置
5. **权限系统**: 多用户访问控制

---

**文档版本**: 1.0
**创建时间**: 2025-11-10
**作者**: Claude Code
