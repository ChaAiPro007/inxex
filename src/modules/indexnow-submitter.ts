/**
 * IndexNow 提交模块
 * 使用 POST 批量提交方式（最多 10,000 个 URL/次）
 */

import { Config, SubmissionResult } from '../types'
import { logger } from '../utils/logger'
import { retryWithBackoff } from '../utils/concurrency'

/**
 * IndexNow 提交器
 */
export class IndexNowSubmitter {
  private config: Config
  private keyLocation: string
  private maxBatchSize = 10000 // IndexNow API 限制

  constructor(config: Config) {
    this.config = config
    // 构建 keyLocation: https://{SITE_HOST}/{API_KEY}.txt
    this.keyLocation = `https://${config.siteHost}/${config.apiKey}.txt`
    logger.info(`KeyLocation: ${this.keyLocation}`)
  }

  /**
   * 批量提交 URL（POST 方式）
   */
  async submitBatch(
    urls: string[],
    searchEngine = 'api.indexnow.org'
  ): Promise<SubmissionResult> {
    const startTime = Date.now()

    try {
      logger.info(`Batch submitting ${urls.length} URLs to ${searchEngine}`)

      // 构建 POST 请求体
      const body = {
        host: this.config.siteHost,
        key: this.config.apiKey,
        keyLocation: this.keyLocation,
        urlList: urls,
      }

      // 使用重试机制
      const response = await retryWithBackoff(
        () => this.sendPostRequest(searchEngine, body),
        this.config.maxRetries
      )

      const duration = Date.now() - startTime

      if (response.ok) {
        logger.info(
          `✓ Batch Success [${response.status}] ${urls.length} URLs (${duration}ms)`
        )
        return {
          url: `Batch of ${urls.length} URLs`,
          success: true,
          statusCode: response.status,
          timestamp: Date.now(),
        }
      } else {
        const error = `HTTP ${response.status}: ${response.statusText}`
        logger.warn(`✗ Batch Failed [${response.status}] ${urls.length} URLs`)
        return {
          url: `Batch of ${urls.length} URLs`,
          success: false,
          statusCode: response.status,
          error,
          timestamp: Date.now(),
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error(`✗ Batch submission error:`, errorMessage)

      return {
        url: `Batch of ${urls.length} URLs`,
        success: false,
        error: errorMessage,
        timestamp: Date.now(),
      }
    }
  }

  /**
   * 发送 POST 请求
   */
  private async sendPostRequest(
    searchEngine: string,
    body: any
  ): Promise<Response> {
    const response = await fetch(`https://${searchEngine}/indexnow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': 'IndexNow-Worker/1.0',
      },
      body: JSON.stringify(body),
    })

    // 处理限流
    if (response.status === 429) {
      logger.warn('Rate limited, waiting 60s...')
      await new Promise((resolve) => setTimeout(resolve, 60000))
      throw new Error('Rate limited, retry needed')
    }

    // 处理服务器错误（5xx）
    if (response.status >= 500) {
      throw new Error(`Server error: ${response.status}`)
    }

    return response
  }

  /**
   * 批量提交所有 URL（自动分批，每批最多 10,000 个）
   */
  async submitUrls(urls: string[]): Promise<SubmissionResult[]> {
    const results: SubmissionResult[] = []
    const searchEngines = this.config.searchEngines

    logger.info(
      `Starting batch submission: ${urls.length} URLs to ${searchEngines.length} search engines`
    )

    // 按 10,000 个一批分割
    const batches: string[][] = []
    for (let i = 0; i < urls.length; i += this.maxBatchSize) {
      batches.push(urls.slice(i, i + this.maxBatchSize))
    }

    logger.info(`Split into ${batches.length} batch(es)`)

    // 对每个搜索引擎提交
    for (const searchEngine of searchEngines) {
      logger.info(`Submitting to ${searchEngine}...`)

      // 逐批提交（每批最多 10,000 个 URL）
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]
        logger.info(`Batch ${i + 1}/${batches.length}: ${batch.length} URLs`)

        const result = await this.submitBatch(batch, searchEngine)
        results.push(result)

        // 批次间隔（避免触发限流）
        if (i < batches.length - 1) {
          const intervalMs = this.config.requestIntervalMs
          logger.info(`Waiting ${intervalMs}ms before next batch...`)
          await new Promise((resolve) => setTimeout(resolve, intervalMs))
        }
      }
    }

    return results
  }

  /**
   * 验证 API 密钥格式
   */
  validateApiKey(): boolean {
    const key = this.config.apiKey
    return key.length >= 8 && /^[a-f0-9]+$/.test(key)
  }

  /**
   * 获取统计信息
   */
  getStats(results: SubmissionResult[]) {
    const successful = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length

    return {
      total: results.length,
      successful,
      failed,
      successRate: ((successful / results.length) * 100).toFixed(2) + '%',
    }
  }
}
