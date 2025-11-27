/**
 * Bing Webmaster API 提交模块
 * 负责向 Bing Webmaster Tools 提交 URL
 */

import { BingSubmissionResult } from '../types'
import { logger } from '../utils/logger'

/**
 * Bing API 请求体接口
 */
interface BingApiRequest {
  siteUrl: string
  urlList: string[]
}

/**
 * Bing API 响应接口
 */
interface BingApiResponse {
  d?: string | null
  ErrorCode?: number
  Message?: string
}

/**
 * Bing Webmaster URL 提交器
 */
export class BingSubmitter {
  private apiKey: string
  private siteUrl: string
  private endpoint = 'https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch'
  private maxUrlsPerBatch = 100 // Bing 单批次最大限制
  private maxRetries = 3

  /**
   * @param apiKey Bing Webmaster API Key
   * @param siteUrl 网站 URL（从 sitemapUrl 提取的 origin）
   */
  constructor(apiKey: string, siteUrl: string) {
    this.apiKey = apiKey
    this.siteUrl = siteUrl
  }

  /**
   * 提交 URL 列表到 Bing
   * 自动处理分批（每批最多 100 条）
   * @param urls URL 列表
   * @returns 提交结果数组（每批一个结果）
   */
  async submitUrls(urls: string[]): Promise<BingSubmissionResult[]> {
    if (urls.length === 0) {
      return []
    }

    logger.info(`Submitting ${urls.length} URLs to Bing Webmaster...`)

    // 分批处理
    const batches = this.splitIntoBatches(urls, this.maxUrlsPerBatch)
    logger.info(`Split into ${batches.length} batches`)

    const results: BingSubmissionResult[] = []

    // 顺序提交每个批次（避免触发速率限制）
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      logger.info(`Submitting batch ${i + 1}/${batches.length} (${batch.length} URLs)`)

      const result = await this.submitBatch(batch)
      results.push(result)

      // 批次间延迟（避免速率限制）
      if (i < batches.length - 1) {
        await this.delay(1000) // 1 秒延迟
      }
    }

    const successCount = results.filter((r) => r.success).length
    logger.info(`Bing submission complete: ${successCount}/${batches.length} batches succeeded`)

    return results
  }

  /**
   * 提交单个批次
   * @param urls URL 列表（最多 100 条）
   * @returns 批次提交结果
   */
  private async submitBatch(urls: string[]): Promise<BingSubmissionResult> {
    const timestamp = Date.now()

    if (urls.length > this.maxUrlsPerBatch) {
      logger.warn(
        `Batch size ${urls.length} exceeds max ${this.maxUrlsPerBatch}, truncating`
      )
      urls = urls.slice(0, this.maxUrlsPerBatch)
    }

    // 构建请求体
    const requestBody: BingApiRequest = {
      siteUrl: this.siteUrl,
      urlList: urls,
    }

    // 带重试的提交
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.makeRequest(requestBody)

        if (result.success) {
          logger.info(`Batch submitted successfully (${urls.length} URLs)`)
          return {
            success: true,
            statusCode: result.statusCode,
            urlCount: urls.length,
            timestamp,
          }
        } else {
          // 非重试错误（400, 401, 403）
          if (result.statusCode && result.statusCode < 500) {
            logger.error(`Batch submission failed: ${result.errorMessage}`)
            return {
              success: false,
              statusCode: result.statusCode,
              errorCode: result.errorCode,
              errorMessage: result.errorMessage,
              urlCount: urls.length,
              timestamp,
            }
          }

          // 可重试错误（429, 5xx）
          if (attempt < this.maxRetries) {
            const backoff = Math.pow(2, attempt) * 1000 // 指数退避
            logger.warn(
              `Batch submission failed (attempt ${attempt}/${this.maxRetries}), retrying in ${backoff}ms...`
            )
            await this.delay(backoff)
            continue
          } else {
            logger.error(`Batch submission failed after ${this.maxRetries} attempts`)
            return {
              success: false,
              statusCode: result.statusCode,
              errorCode: result.errorCode,
              errorMessage: result.errorMessage,
              urlCount: urls.length,
              timestamp,
            }
          }
        }
      } catch (error) {
        if (attempt < this.maxRetries) {
          const backoff = Math.pow(2, attempt) * 1000
          logger.warn(
            `Request error (attempt ${attempt}/${this.maxRetries}), retrying in ${backoff}ms...`
          )
          await this.delay(backoff)
          continue
        } else {
          logger.error(`Request failed after ${this.maxRetries} attempts:`, error)
          return {
            success: false,
            errorCode: 'NETWORK_ERROR',
            errorMessage: error instanceof Error ? error.message : String(error),
            urlCount: urls.length,
            timestamp,
          }
        }
      }
    }

    // 不应该到达这里
    return {
      success: false,
      errorCode: 'UNKNOWN_ERROR',
      errorMessage: 'Unknown error',
      urlCount: urls.length,
      timestamp,
    }
  }

  /**
   * 发送 HTTP 请求到 Bing API
   * @param requestBody 请求体
   * @returns 请求结果
   */
  private async makeRequest(requestBody: BingApiRequest): Promise<{
    success: boolean
    statusCode?: number
    errorCode?: string
    errorMessage?: string
  }> {
    const url = `${this.endpoint}?apikey=${this.apiKey}`

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(requestBody),
      })

      const statusCode = response.status

      // 成功（200）
      if (response.ok) {
        try {
          await response.json() // Bing API 成功响应通常返回 null 或 空对象
          return { success: true, statusCode }
        } catch {
          // 响应不是 JSON，但状态码是 200，视为成功
          return { success: true, statusCode }
        }
      }

      // 错误响应
      let errorCode = `HTTP_${statusCode}`
      let errMsg = `HTTP ${statusCode}`
      try {
        const data = (await response.json()) as BingApiResponse
        if (data.ErrorCode) {
          errorCode = `BING_${data.ErrorCode}`
        }
        if (data.Message) {
          errMsg = data.Message
        }
      } catch {
        // 无法解析响应体
        errMsg = await response.text()
      }

      // 分类错误
      if (statusCode === 400) {
        return {
          success: false,
          statusCode,
          errorCode: 'BAD_REQUEST',
          errorMessage: `Bad Request: ${errMsg}`,
        }
      } else if (statusCode === 401) {
        return {
          success: false,
          statusCode,
          errorCode: 'UNAUTHORIZED',
          errorMessage: 'Unauthorized: Invalid API key',
        }
      } else if (statusCode === 403) {
        return {
          success: false,
          statusCode,
          errorCode: 'FORBIDDEN',
          errorMessage: `Forbidden: ${errMsg}`,
        }
      } else if (statusCode === 429) {
        return {
          success: false,
          statusCode,
          errorCode: 'RATE_LIMITED',
          errorMessage: 'Rate limit exceeded',
        }
      } else if (statusCode >= 500) {
        return {
          success: false,
          statusCode,
          errorCode: 'SERVER_ERROR',
          errorMessage: `Server error: ${errMsg}`,
        }
      } else {
        return {
          success: false,
          statusCode,
          errorCode,
          errorMessage: `Unexpected error: ${errMsg}`,
        }
      }
    } catch (error) {
      logger.error('Bing API request failed:', error)
      throw error
    }
  }

  /**
   * 将 URL 列表分割成批次
   * @param urls URL 列表
   * @param batchSize 批次大小
   * @returns 批次数组
   */
  private splitIntoBatches(urls: string[], batchSize: number): string[][] {
    const batches: string[][] = []
    for (let i = 0; i < urls.length; i += batchSize) {
      batches.push(urls.slice(i, i + batchSize))
    }
    return batches
  }

  /**
   * 延迟工具函数
   * @param ms 延迟毫秒数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * 验证 API Key 格式
   * @param apiKey API Key
   * @returns 是否有效
   */
  static isValidApiKey(apiKey: string): boolean {
    return /^[a-f0-9]{32,}$/.test(apiKey)
  }
}
