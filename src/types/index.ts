/**
 * Cloudflare Workers 环境绑定
 */
export interface Env {
  // KV 存储
  CACHE: KVNamespace

  // 环境变量（单网站模式 - 向后兼容）
  SITEMAP_URL?: string
  SITE_HOST?: string
  INDEXNOW_API_KEY?: string
  MAX_CONCURRENT_REQUESTS?: string
  REQUEST_INTERVAL_MS?: string
  CACHE_TTL_DAYS?: string
  MAX_RETRIES?: string
  CRON_SCHEDULE?: string

  // 管理认证
  ADMIN_TOKEN?: string
}

/**
 * 配置接口
 */
export interface Config {
  sitemapUrl: string
  siteHost: string
  apiKey: string
  maxConcurrentRequests: number
  requestIntervalMs: number
  cacheTtlDays: number
  maxRetries: number
  searchEngines: string[]
}

/**
 * Sitemap URL 条目
 */
export interface SitemapUrl {
  loc: string
  lastmod?: string
  changefreq?: string
  priority?: string
}

/**
 * IndexNow 提交结果
 */
export interface SubmissionResult {
  url: string
  success: boolean
  statusCode?: number
  error?: string
  timestamp: number
}

/**
 * 批次提交统计
 */
export interface SubmissionStats {
  total: number
  successful: number
  failed: number
  skipped: number
  duration: number
  errors: string[]
}

/**
 * 执行上下文
 */
export interface ExecutionContext {
  startTime: number
  processedUrls: number
  totalUrls: number
  stats: SubmissionStats
}

/**
 * 网站配置（多网站支持）
 */
export interface SiteConfig {
  // 基础信息
  id: string // 网站标识，如 "example.com"
  name: string // 显示名称，如 "Example Site"

  // IndexNow 配置
  sitemapUrl: string // https://example.com/sitemap.xml
  apiKey: string // IndexNow API 密钥
  keyLocation: string // https://example.com/{key}.txt
  searchEngines: string[] // ["api.indexnow.org"]

  // Bing Webmaster 配置
  bingEnabled: boolean // 是否启用 Bing 提交
  bingApiKey?: string // Bing Webmaster API Key (可选)
  bingDailyQuota: number // Bing 每日配额限制
  bingPriority: 'newest' | 'random' // URL 优先级策略

  // 调度配置
  enabled: boolean // 是否启用自动提交
  interval: number // 提交间隔（小时）
  lastRunTime: number // 上次执行时间戳

  // 性能配置
  maxConcurrentRequests: number // 最大并发请求数
  requestIntervalMs: number // 请求间隔（毫秒）
  maxRetries: number // 最大重试次数
  cacheTtlDays: number // 缓存TTL天数

  // 元数据
  createdAt: string // ISO 8601 时间戳
  updatedAt: string // ISO 8601 时间戳
}

/**
 * 创建网站配置的输入接口（简化版）
 * 只需要必填字段，其他字段使用智能默认值
 */
export interface CreateSiteInput {
  // 必填字段
  sitemapUrl: string
  apiKey: string

  // 可选字段（可覆盖默认值）
  id?: string
  name?: string
  keyLocation?: string
  searchEngines?: string[]
  enabled?: boolean
  interval?: number
  lastRunTime?: number
  maxConcurrentRequests?: number
  requestIntervalMs?: number
  maxRetries?: number
  cacheTtlDays?: number

  // Bing Webmaster 可选字段
  bingEnabled?: boolean
  bingApiKey?: string
  bingDailyQuota?: number
  bingPriority?: 'newest' | 'random'
}

/**
 * 网站配置验证结果
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * 执行记录（多网站）
 */
export interface ExecutionRecord {
  siteId: string
  timestamp: string
  stats: SubmissionStats
  batches: Array<{
    success: boolean
    statusCode?: number
    error?: string | null
  }>
  bingStats?: BingStats  // Bing 提交统计
}

/**
 * 全局统计
 */
export interface GlobalStats {
  totalSites: number
  enabledSites: number
  totalUrlsSubmitted: number
  totalExecutions: number
  lastUpdate: string
}

/**
 * Bing Webmaster 提交结果
 */
export interface BingSubmissionResult {
  success: boolean
  statusCode?: number
  errorCode?: string
  errorMessage?: string
  urlCount: number
  timestamp: number
}

/**
 * Bing 配额记录（KV 存储格式）
 */
export interface BingQuotaRecord {
  used: number        // 当日已用
  lastUpdate: string  // ISO 8601 时间戳
}

/**
 * Bing 提交统计（执行记录中的字段）
 */
export interface BingStats {
  enabled: boolean
  submitted: number   // 本次提交数量
  successful: number  // 成功数量
  failed: number      // 失败数量
  skipped: number     // 跳过数量（配额不足等）
  quotaUsed: number   // 配额使用
  quotaRemaining: number // 剩余配额
  error?: string      // 错误信息
}
