/**
 * 调度器模块
 * 协调各模块完成 URL 采集和提交
 */

import { Env, SubmissionStats, Config, BingSubmissionResult, SitemapUrl, BingStats } from '../types'
import { loadConfig } from './config'
import { SiteConfigManager } from './site-config-manager'
import { SitemapCrawler } from './sitemap-crawler'
import { IndexNowSubmitter } from './indexnow-submitter'
import { BingSubmitter } from './bing-submitter'
import { QuotaManager } from './quota-manager'
import { UrlCache } from './url-cache'
import { logger } from '../utils/logger'

/**
 * 提交渠道类型
 */
export type SubmissionChannel = 'all' | 'indexnow' | 'bing'

/**
 * 主调度器
 * 支持多网站运行
 */
export class Scheduler {
  private env: Env
  private siteId: string
  private channel: SubmissionChannel

  constructor(env: Env, siteId?: string, channel?: SubmissionChannel) {
    this.env = env
    // 默认使用 'default' 作为站点ID（向后兼容）
    this.siteId = siteId || 'default'
    // 默认使用 'all' 提交所有渠道
    this.channel = channel || 'all'
  }

  /**
   * 执行完整的采集和提交流程
   */
  async run(): Promise<SubmissionStats> {
    const startTime = Date.now()

    try {
      logger.info('=== IndexNow Scheduler Started ===')
      logger.info(`Site ID: ${this.siteId}`)

      // 1. 加载配置
      let config: Config

      if (this.siteId === 'default') {
        // 向后兼容：使用环境变量
        config = loadConfig(this.env)
      } else {
        // 多站点模式：从KV加载站点配置
        const manager = new SiteConfigManager(this.env.CACHE)
        const siteConfig = await manager.getSite(this.siteId)

        if (!siteConfig) {
          throw new Error(`Site configuration not found: ${this.siteId}`)
        }

        if (!siteConfig.enabled) {
          throw new Error(`Site is disabled: ${this.siteId}`)
        }

        // 转换 SiteConfig 为 Config
        config = {
          sitemapUrl: siteConfig.sitemapUrl,
          siteHost: new URL(siteConfig.sitemapUrl).hostname,
          apiKey: siteConfig.apiKey,
          maxConcurrentRequests: siteConfig.maxConcurrentRequests,
          requestIntervalMs: siteConfig.requestIntervalMs,
          cacheTtlDays: siteConfig.cacheTtlDays,
          maxRetries: siteConfig.maxRetries,
          searchEngines: siteConfig.searchEngines,
        }
      }

      logger.info('Config loaded:', {
        sitemap: config.sitemapUrl,
        host: config.siteHost,
      })

      // 2. 初始化模块
      const crawler = new SitemapCrawler(config.sitemapUrl)
      const submitter = new IndexNowSubmitter(config)
      const cache = new UrlCache(this.env.CACHE, config.cacheTtlDays, this.siteId)

      // 3. 测试 KV 连接
      const kvConnected = await cache.testConnection()
      if (!kvConnected) {
        throw new Error('Failed to connect to KV store')
      }

      // 4. 获取 sitemap URLs
      logger.info('Fetching sitemap...')
      const sitemapUrls = await crawler.fetchUrls()
      logger.info(`Found ${sitemapUrls.length} URLs in sitemap`)

      if (sitemapUrls.length === 0) {
        logger.warn('No URLs found in sitemap')
        const emptyStats = this.emptyStats()
        await this.saveExecutionRecord(emptyStats, [])
        return emptyStats
      }

      // 5. 验证和过滤 URL
      const validUrls = crawler.filterValidUrls(sitemapUrls)
      logger.info(`${validUrls.length} valid URLs`)

      const urlList = validUrls.map((u) => u.loc)

      // 6. IndexNow 提交（如果渠道包含 indexnow）
      let results: any[] = []
      let newUrls: string[] = []

      if (this.channel === 'all' || this.channel === 'indexnow') {
        // 过滤已提交的 URL（IndexNow 渠道）
        newUrls = await cache.filterNewUrls(urlList, 'indexnow')
        logger.info(`${newUrls.length} new URLs to submit to IndexNow`)

        if (newUrls.length > 0) {
          // 7. 提交 URL 到 IndexNow（批量 POST）
          logger.info('Starting IndexNow batch submission...')
          results = await submitter.submitUrls(newUrls)

          // 8. 缓存成功提交的 URL (IndexNow)
          const allSuccess = results.every((r) => r.success)

          if (allSuccess && newUrls.length > 0) {
            // 所有批次都成功，缓存所有 URL
            logger.info('All IndexNow batches successful, caching all URLs...')
            await cache.addBatch(newUrls, 'indexnow')
          } else if (results.some((r) => r.success)) {
            // 部分成功，只缓存成功的批次对应的 URL
            logger.warn('Some IndexNow batches failed, caching only successful URLs')
            await cache.addBatch(newUrls, 'indexnow')
          }
        } else {
          logger.info('No new URLs to submit to IndexNow')
        }
      } else {
        logger.info('IndexNow submission skipped (channel: bing only)')
      }

      // 9. Bing Webmaster 提交（如果渠道包含 bing）
      let bingResults: BingSubmissionResult[] = []
      let bingQuotaInfo: { used: number; remaining: number } | undefined

      if (this.channel === 'all' || this.channel === 'bing') {
        if (this.siteId !== 'default') {
          const manager = new SiteConfigManager(this.env.CACHE)
          const siteConfig = await manager.getSite(this.siteId)

          if (siteConfig?.bingEnabled && siteConfig.bingApiKey) {
            logger.info('=== Starting Bing Webmaster Submission ===')
            const bingResult = await this.submitToBing(
              siteConfig,
              sitemapUrls,
              cache
            )
            bingResults = bingResult.results
            bingQuotaInfo = bingResult.quotaInfo
          } else {
            logger.info('Bing submission not enabled for this site')
          }
        } else {
          logger.info('Bing submission not available for default site')
        }
      } else {
        logger.info('Bing submission skipped (channel: indexnow only)')
      }

      // 检查是否有任何提交
      if (results.length === 0 && bingResults.length === 0) {
        logger.info('No submissions made')
        const emptyStats = this.emptyStats()
        await this.saveExecutionRecord(emptyStats, [])
        return emptyStats
      }

      // 10. 统计结果
      const stats = this.calculateStats(results, newUrls.length, startTime)
      logger.info('=== Execution Complete ===', stats)

      // 11. 保存执行记录到 KV
      await this.saveExecutionRecord(stats, results, bingResults, bingQuotaInfo)

      return stats
    } catch (error) {
      logger.error('Scheduler execution failed:', error)
      throw error
    }
  }

  /**
   * 提交到 Bing Webmaster
   * @param siteConfig 网站配置
   * @param sitemapUrls Sitemap URL 列表（含 lastmod）
   * @param cache URL 缓存实例
   * @returns Bing 提交结果和配额信息
   */
  private async submitToBing(
    siteConfig: any,
    sitemapUrls: SitemapUrl[],
    cache: UrlCache
  ): Promise<{
    results: BingSubmissionResult[]
    quotaInfo: { used: number; remaining: number }
  }> {
    try {
      // 1. 初始化配额管理器
      const quotaManager = new QuotaManager(this.env.CACHE, this.siteId)
      const initialUsed = await quotaManager.getUsedToday()
      const remaining = siteConfig.bingDailyQuota - initialUsed

      logger.info(`Bing quota: ${remaining}/${siteConfig.bingDailyQuota} remaining`)

      if (remaining <= 0) {
        logger.warn('Bing daily quota exhausted, skipping submission')
        return {
          results: [],
          quotaInfo: { used: initialUsed, remaining: 0 },
        }
      }

      // 2. 提取 siteUrl (origin)
      const siteUrl = new URL(siteConfig.sitemapUrl).origin

      // 3. 根据优先级策略选择 URL
      let selectedUrls: string[]
      const allUrls = sitemapUrls.map((u) => u.loc)

      if (siteConfig.bingPriority === 'newest') {
        // 按 lastmod 降序排序，无 lastmod 的排在最后
        const sorted = [...sitemapUrls].sort((a, b) => {
          const dateA = a.lastmod ? new Date(a.lastmod).getTime() : 0
          const dateB = b.lastmod ? new Date(b.lastmod).getTime() : 0
          return dateB - dateA
        })
        selectedUrls = sorted.slice(0, remaining).map((u) => u.loc)
      } else {
        // random: 随机选择
        const shuffled = [...allUrls].sort(() => Math.random() - 0.5)
        selectedUrls = shuffled.slice(0, remaining)
      }

      logger.info(`Selected ${selectedUrls.length} URLs for Bing submission (strategy: ${siteConfig.bingPriority})`)

      // 4. 过滤已提交到 Bing 的 URL
      const newUrls = await cache.filterNewUrls(selectedUrls, 'bing')
      logger.info(`${newUrls.length} new URLs to submit to Bing`)

      if (newUrls.length === 0) {
        logger.info('No new URLs to submit to Bing')
        return {
          results: [],
          quotaInfo: { used: initialUsed, remaining },
        }
      }

      // 5. 限制在配额范围内
      const urlsToSubmit = newUrls.slice(0, remaining)
      logger.info(`Submitting ${urlsToSubmit.length} URLs to Bing`)

      // 6. 初始化 Bing 提交器
      const bingSubmitter = new BingSubmitter(siteConfig.bingApiKey, siteUrl)

      // 7. 提交 URL
      const results = await bingSubmitter.submitUrls(urlsToSubmit)

      // 8. 更新配额
      const successfulCount = results.reduce(
        (sum, r) => sum + (r.success ? r.urlCount : 0),
        0
      )

      if (successfulCount > 0) {
        await quotaManager.incrementUsed(successfulCount, siteConfig.bingDailyQuota)
        // 缓存成功提交的 URL
        await cache.addBatch(urlsToSubmit, 'bing')
      }

      const finalUsed = initialUsed + successfulCount
      const finalRemaining = Math.max(0, siteConfig.bingDailyQuota - finalUsed)

      logger.info(`Bing submission complete: ${successfulCount} URLs submitted`)

      return {
        results,
        quotaInfo: { used: finalUsed, remaining: finalRemaining },
      }
    } catch (error) {
      logger.error('Bing submission failed:', error)
      return {
        results: [],
        quotaInfo: { used: 0, remaining: 0 },
      }
    }
  }

  /**
   * 计算统计信息
   */
  private calculateStats(
    results: any[],
    totalUrls: number,
    startTime: number
  ): SubmissionStats {
    const successful = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length

    const errors = results
      .filter((r) => !r.success && r.error)
      .map((r) => r.error)
      .slice(0, 10) // 只保留前 10 个错误

    return {
      total: totalUrls, // 实际提交的 URL 总数
      successful: successful * Math.ceil(totalUrls / results.length), // 成功批次对应的 URL 数
      failed: failed * Math.ceil(totalUrls / results.length), // 失败批次对应的 URL 数
      skipped: 0,
      duration: Date.now() - startTime,
      errors,
    }
  }

  /**
   * 空统计（无 URL 处理）
   */
  private emptyStats(): SubmissionStats {
    return {
      total: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
      errors: [],
    }
  }

  /**
   * 保存执行记录到 KV（支持多网站命名空间）
   */
  private async saveExecutionRecord(
    stats: SubmissionStats,
    results: any[],
    bingResults?: BingSubmissionResult[],
    bingQuotaInfo?: { used: number; remaining: number }
  ): Promise<void> {
    try {
      // 计算 Bing 统计
      let bingStats: BingStats | undefined
      if (bingResults && bingResults.length > 0) {
        const submitted = bingResults.reduce((sum, r) => sum + r.urlCount, 0)
        const successful = bingResults
          .filter((r) => r.success)
          .reduce((sum, r) => sum + r.urlCount, 0)
        const failed = bingResults
          .filter((r) => !r.success)
          .reduce((sum, r) => sum + r.urlCount, 0)
        const firstError = bingResults.find((r) => !r.success)

        bingStats = {
          enabled: true,
          submitted,
          successful,
          failed,
          skipped: 0,
          quotaUsed: bingQuotaInfo?.used || successful,
          quotaRemaining: bingQuotaInfo?.remaining || 0,
          error: firstError?.errorMessage,
        }
      }

      const record = {
        siteId: this.siteId,
        timestamp: new Date().toISOString(),
        stats,
        batches: results.map((r) => ({
          success: r.success,
          statusCode: r.statusCode,
          error: r.errorMessage || r.error || null,
        })),
        bingStats,
      }

      // 保存最近一次执行（站点级别）
      const lastExecKey = `sites:last_execution:${this.siteId}`
      await this.env.CACHE.put(lastExecKey, JSON.stringify(record))

      // 保存执行历史（站点级别，最近 100 次 + 1 年内）
      const historyKey = `sites:history:${this.siteId}`
      const historyData = await this.env.CACHE.get(historyKey)
      const history = historyData ? JSON.parse(historyData) : []

      history.unshift(record) // 添加到开头

      // 双重过滤：数量限制 + 时间限制
      // 1. 只保留最近 100 次执行
      // 2. 只保留 1 年内的数据（自动清理过期记录）
      const oneYearAgo = new Date()
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

      const recentHistory = history
        .slice(0, 100) // 数量限制：最多100条
        .filter((record: any) => {
          const recordDate = new Date(record.timestamp)
          return recordDate > oneYearAgo // 时间限制：1年内
        })

      await this.env.CACHE.put(historyKey, JSON.stringify(recentHistory))

      logger.info(
        `Execution record saved for site: ${this.siteId} (kept ${recentHistory.length}/${history.length} records)`
      )
    } catch (error) {
      logger.error('Failed to save execution record:', error)
    }
  }

  /**
   * 格式化统计报告
   */
  formatStatsReport(stats: SubmissionStats): string {
    const lines = [
      '=== Submission Report ===',
      `Total URLs: ${stats.total}`,
      `✓ Successful: ${stats.successful}`,
      `✗ Failed: ${stats.failed}`,
      `○ Skipped: ${stats.skipped}`,
      `Duration: ${(stats.duration / 1000).toFixed(2)}s`,
    ]

    if (stats.errors.length > 0) {
      lines.push('\nErrors:')
      stats.errors.forEach((error, i) => {
        lines.push(`  ${i + 1}. ${error}`)
      })
    }

    return lines.join('\n')
  }
}
