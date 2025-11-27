/**
 * URL 缓存模块
 * 使用 Cloudflare KV 存储，避免重复提交
 */

import { logger } from '../utils/logger'

/**
 * URL 缓存管理器
 * 支持多网站命名空间隔离
 */
export class UrlCache {
  private kv: KVNamespace
  private ttlSeconds: number
  private siteId: string

  constructor(kv: KVNamespace, ttlDays: number, siteId: string) {
    this.kv = kv
    this.ttlSeconds = ttlDays * 24 * 60 * 60
    this.siteId = siteId
  }

  /**
   * 生成缓存 Key（命名空间隔离）
   * @param url URL 字符串
   * @param channel 提交渠道（'indexnow' 或 'bing'），默认 'indexnow'
   */
  private getCacheKey(url: string, channel: 'indexnow' | 'bing' = 'indexnow'): string {
    const hash = this.hashUrl(url)
    if (channel === 'bing') {
      return `url_cache:bing:${this.siteId}:${hash}`
    }
    return `sites:cache:${this.siteId}:url:${hash}`
  }

  /**
   * URL 哈希（简单哈希函数）
   */
  private hashUrl(url: string): string {
    let hash = 0
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36)
  }

  /**
   * 检查 URL 是否已缓存
   * @param url URL 字符串
   * @param channel 提交渠道（'indexnow' 或 'bing'），默认 'indexnow'
   */
  async isCached(url: string, channel: 'indexnow' | 'bing' = 'indexnow'): Promise<boolean> {
    const key = this.getCacheKey(url, channel)
    const value = await this.kv.get(key)
    return value !== null
  }

  /**
   * 添加 URL 到缓存
   * @param url URL 字符串
   * @param channel 提交渠道（'indexnow' 或 'bing'），默认 'indexnow'
   */
  async add(url: string, channel: 'indexnow' | 'bing' = 'indexnow'): Promise<void> {
    const key = this.getCacheKey(url, channel)
    const data = {
      url,
      channel,
      timestamp: Date.now(),
    }

    await this.kv.put(key, JSON.stringify(data), {
      expirationTtl: this.ttlSeconds,
    })
  }

  /**
   * 批量检查 URL
   * @param urls URL 列表
   * @param channel 提交渠道（'indexnow' 或 'bing'），默认 'indexnow'
   */
  async filterNewUrls(urls: string[], channel: 'indexnow' | 'bing' = 'indexnow'): Promise<string[]> {
    const newUrls: string[] = []

    logger.info(`Checking ${urls.length} URLs against ${channel} cache...`)

    // 批量检查（并行）
    const checkPromises = urls.map(async (url) => {
      const cached = await this.isCached(url, channel)
      if (!cached) {
        newUrls.push(url)
      }
    })

    await Promise.all(checkPromises)

    logger.info(`Found ${newUrls.length} new URLs (${urls.length - newUrls.length} cached)`)

    return newUrls
  }

  /**
   * 批量添加 URL
   * @param urls URL 列表
   * @param channel 提交渠道（'indexnow' 或 'bing'），默认 'indexnow'
   */
  async addBatch(urls: string[], channel: 'indexnow' | 'bing' = 'indexnow'): Promise<void> {
    logger.info(`Adding ${urls.length} URLs to ${channel} cache...`)

    const addPromises = urls.map((url) => this.add(url, channel))
    await Promise.all(addPromises)

    logger.info(`Successfully cached ${urls.length} URLs`)
  }

  /**
   * 获取缓存统计
   */
  async getStats(): Promise<{ cachedCount: number }> {
    // 注意：KV 不支持直接统计，这里返回估算值
    // 实际使用中可以维护一个单独的计数器
    return {
      cachedCount: 0, // 需要额外实现
    }
  }

  /**
   * 清理过期缓存（KV 自动处理 TTL，无需手动清理）
   */
  async cleanup(): Promise<void> {
    logger.info('KV automatically handles TTL expiration')
  }

  /**
   * 测试 KV 连接
   */
  async testConnection(): Promise<boolean> {
    try {
      const testKey = 'test:connection'
      await this.kv.put(testKey, 'ok', { expirationTtl: 60 })
      const value = await this.kv.get(testKey)
      await this.kv.delete(testKey)
      return value === 'ok'
    } catch (error) {
      logger.error('KV connection test failed:', error)
      return false
    }
  }
}
