# Tasks: Add Bing Webmaster API Submission

## 1. 类型定义扩展

- [ ] 1.1 扩展 `SiteConfig` 接口，新增 Bing 字段
  - `bingEnabled: boolean` (默认 false)
  - `bingApiKey?: string`
  - `bingDailyQuota: number` (默认 100)
  - `bingPriority: 'newest' | 'random'` (默认 'newest')

- [ ] 1.2 扩展 `CreateSiteInput` 接口，支持 Bing 可选配置

- [ ] 1.3 新增 `BingSubmissionResult` 类型定义

- [ ] 1.4 新增 `BingQuotaRecord` 类型定义

## 2. QuotaManager 模块

- [ ] 2.1 创建 `src/modules/quota-manager.ts`

- [ ] 2.2 实现 `getQuotaKey(siteId, date)` - 生成 KV 键
  - 格式: `bing:quota:{siteId}:{YYYY-MM-DD}`
  - 使用 UTC 日期

- [ ] 2.3 实现 `getUsedToday(siteId)` - 获取当日已用配额
  - 返回数字，不存在则返回 0

- [ ] 2.4 实现 `getRemainingToday(siteId, dailyLimit)` - 获取剩余配额
  - 返回 `dailyLimit - usedToday`

- [ ] 2.5 实现 `incrementUsed(siteId, count)` - 增加已用配额
  - 读取当前值 → 加 count → 写回
  - 设置 TTL 48 小时

- [ ] 2.6 实现 `resetQuota(siteId)` - 手动重置配额（用于测试）

## 3. BingSubmitter 模块

- [ ] 3.1 创建 `src/modules/bing-submitter.ts`

- [ ] 3.2 实现 `BingSubmitter` 类构造函数
  - 接收 `siteUrl` 和 `apiKey`

- [ ] 3.3 实现 `submitBatch(urls: string[])` - 批量提交
  - 端点: `POST https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch?apikey={apiKey}`
  - 请求体: `{ siteUrl, urlList }`
  - Content-Type: `application/json; charset=utf-8`

- [ ] 3.4 实现错误处理
  - HTTP 200: 成功
  - HTTP 400: 记录 ErrorCode 和 Message
  - HTTP 401/403: 认证失败
  - HTTP 429: 限流，等待后重试
  - HTTP 5xx: 服务器错误，重试

- [ ] 3.5 实现重试机制
  - 使用现有 `retryWithBackoff` 工具
  - 最大重试 3 次

- [ ] 3.6 实现日志记录
  - 成功: `✓ Bing: {count} URLs submitted`
  - 失败: `✗ Bing: {errorCode} - {message}`

## 4. UrlCache 扩展

- [ ] 4.1 修改 `getCacheKey(url, channel?)` 方法
  - 默认 channel 为空（兼容现有 IndexNow）
  - channel='bing' 时使用 `url_cache:bing:{siteId}:{hash}`

- [ ] 4.2 修改 `filterNewUrls(urls, channel?)` 方法
  - 支持按渠道过滤

- [ ] 4.3 修改 `addBatch(urls, channel?)` 方法
  - 支持按渠道存储

- [ ] 4.4 添加 `getSubmittedCount(channel?)` 方法
  - 统计已提交 URL 数量

## 5. SiteConfigManager 扩展

- [ ] 5.1 修改 `buildSiteConfig()` - 添加 Bing 默认值
  - `bingEnabled: false`
  - `bingDailyQuota: 100`
  - `bingPriority: 'newest'`

- [ ] 5.2 修改 `validateSite()` - 添加 Bing 配置验证
  - 如果 `bingEnabled=true`，则 `bingApiKey` 必填
  - `bingDailyQuota` 必须在 1-500 之间
  - `bingPriority` 必须是 'newest' 或 'random'

- [ ] 5.3 修改 API Key 脱敏逻辑
  - `bingApiKey` 也需要脱敏显示

## 6. Scheduler 集成

- [ ] 6.1 在 `run()` 方法中添加 Bing 提交逻辑
  - 位置: IndexNow 提交完成后
  - 条件: `config.bingEnabled && config.bingApiKey`

- [ ] 6.2 实现配额检查
  - 调用 `quotaManager.getRemainingToday()`
  - 如果剩余为 0，跳过 Bing 提交

- [ ] 6.3 实现 URL 过滤（Bing 专用）
  - 调用 `urlCache.filterNewUrls(urls, 'bing')`

- [ ] 6.4 实现 URL 优先级选择
  - `selectUrlsByPriority(urls, limit, strategy)`
  - `newest`: 按 lastmod 排序取前 N
  - `random`: 随机取 N

- [ ] 6.5 执行 Bing 提交
  - 调用 `bingSubmitter.submitBatch()`
  - 成功后更新缓存和配额

- [ ] 6.6 修改 `saveExecutionRecord()` 保存 Bing 结果
  - 新增 `bingStats` 字段

- [ ] 6.7 修改 `calculateStats()` 包含 Bing 统计

## 7. API 扩展

- [ ] 7.1 修改 `/status` 响应
  - 新增 `bing` 对象
  - 包含 `enabled`, `todayQuotaUsed`, `todayQuotaRemaining`, `lastSubmission`

- [ ] 7.2 修改 `/api/stats/daily` 响应
  - 每日统计分 `indexnow` 和 `bing` 两部分

- [ ] 7.3 修改 `/api/stats/summary` 响应
  - 新增 Bing 汇总统计

- [ ] 7.4 修改 `/trigger` 支持指定渠道
  - 参数: `?site=xxx&channel=all|indexnow|bing`
  - 默认 `all` 执行全部

- [ ] 7.5 修改 `/api/sites/:id` 响应
  - 返回 Bing 配置（apiKey 脱敏）

## 8. 测试

- [ ] 8.1 QuotaManager 单元测试
  - 测试配额获取和增加
  - 测试日期边界（UTC 00:00）

- [ ] 8.2 BingSubmitter 单元测试
  - Mock Bing API 响应
  - 测试成功/失败场景
  - 测试重试逻辑

- [ ] 8.3 UrlCache 扩展测试
  - 测试渠道隔离
  - 测试向后兼容（无 channel 参数）

- [ ] 8.4 Scheduler 集成测试
  - 测试完整流程
  - 测试配额耗尽场景
  - 测试 Bing 禁用场景

- [ ] 8.5 API 测试
  - 测试新增字段返回

## 9. 文档更新

- [ ] 9.1 更新 README.md
  - 添加 Bing Webmaster API 说明
  - 添加配置示例

- [ ] 9.2 更新 CLAUDE.md
  - 添加 Bing 相关架构说明

- [ ] 9.3 添加 Bing API Key 获取指南
  - 如何在 Bing Webmaster Tools 创建 API Key

## 10. 部署验证

- [ ] 10.1 类型检查通过
  - `npm run type-check`

- [ ] 10.2 测试通过
  - `npm run test`

- [ ] 10.3 本地测试
  - `npm run dev`
  - 验证 API 响应

- [ ] 10.4 部署到 Cloudflare Workers
  - `npm run deploy`

- [ ] 10.5 生产验证
  - 添加测试站点
  - 验证 Bing 提交功能
  - 验证配额追踪
