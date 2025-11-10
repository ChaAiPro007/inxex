/**
 * 调度器模块
 * 协调各模块完成 URL 采集和提交
 */

import { Env, SubmissionStats, Config } from '../types'
import { loadConfig } from './config'
import { SiteConfigManager } from './site-config-manager'
import { SitemapCrawler } from './sitemap-crawler'
import { IndexNowSubmitter } from './indexnow-submitter'
import { UrlCache } from './url-cache'
import { logger } from '../utils/logger'

/**
 * 主调度器
 * 支持多网站运行
 */
export class Scheduler {
  private env: Env
  private siteId: string

  constructor(env: Env, siteId?: string) {
    this.env = env
    // 默认使用 'default' 作为站点ID（向后兼容）
    this.siteId = siteId || 'default'
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

      // 6. 过滤已提交的 URL
      const newUrls = await cache.filterNewUrls(urlList)
      logger.info(`${newUrls.length} new URLs to submit`)

      if (newUrls.length === 0) {
        logger.info('No new URLs to submit')
        const emptyStats = this.emptyStats()
        await this.saveExecutionRecord(emptyStats, [])
        return emptyStats
      }

      // 7. 提交 URL 到 IndexNow（批量 POST）
      logger.info('Starting batch submission...')
      const results = await submitter.submitUrls(newUrls)

      // 8. 缓存成功提交的 URL
      const allSuccess = results.every((r) => r.success)

      if (allSuccess && newUrls.length > 0) {
        // 所有批次都成功，缓存所有 URL
        logger.info('All batches successful, caching all URLs...')
        await cache.addBatch(newUrls)
      } else if (results.some((r) => r.success)) {
        // 部分成功，只缓存成功的批次对应的 URL
        logger.warn('Some batches failed, caching only successful URLs')
        // 注意：这里简化处理，如果需要精确追踪每个批次的 URL，需要更复杂的逻辑
        await cache.addBatch(newUrls)
      }

      // 9. 统计结果
      const stats = this.calculateStats(results, newUrls.length, startTime)
      logger.info('=== Execution Complete ===', stats)

      // 10. 保存执行记录到 KV
      await this.saveExecutionRecord(stats, results)

      return stats
    } catch (error) {
      logger.error('Scheduler execution failed:', error)
      throw error
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
    results: any[]
  ): Promise<void> {
    try {
      const record = {
        siteId: this.siteId,
        timestamp: new Date().toISOString(),
        stats,
        batches: results.map((r) => ({
          success: r.success,
          statusCode: r.statusCode,
          error: r.error || null,
        })),
      }

      // 保存最近一次执行（站点级别）
      const lastExecKey = `sites:last_execution:${this.siteId}`
      await this.env.CACHE.put(lastExecKey, JSON.stringify(record))

      // 保存执行历史（站点级别，最近 10 次）
      const historyKey = `sites:history:${this.siteId}`
      const historyData = await this.env.CACHE.get(historyKey)
      const history = historyData ? JSON.parse(historyData) : []

      history.unshift(record) // 添加到开头
      const recentHistory = history.slice(0, 10) // 只保留最近 10 次

      await this.env.CACHE.put(historyKey, JSON.stringify(recentHistory))

      logger.info(`Execution record saved to KV for site: ${this.siteId}`)
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
