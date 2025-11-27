/**
 * Bing Webmaster API 配额管理器
 * 管理每日 URL 提交配额
 */

import { BingQuotaRecord } from '../types'
import { logger } from '../utils/logger'

/**
 * 配额管理器类
 * 使用 KV 存储按日期分键的配额使用记录
 */
export class QuotaManager {
  private kv: KVNamespace
  private siteId: string
  private quotaTtlSeconds = 48 * 60 * 60 // 48 小时 TTL

  constructor(kv: KVNamespace, siteId: string) {
    this.kv = kv
    this.siteId = siteId
  }

  /**
   * 生成配额键（按日期分键）
   * 格式: bing:quota:{siteId}:{YYYY-MM-DD}
   */
  private getQuotaKey(date: Date): string {
    const dateStr = this.formatDate(date)
    return `bing:quota:${this.siteId}:${dateStr}`
  }

  /**
   * 格式化日期为 YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  /**
   * 获取当日已使用配额
   * @returns 已使用的配额数量
   */
  async getUsedToday(): Promise<number> {
    const today = new Date()
    const key = this.getQuotaKey(today)

    try {
      const data = await this.kv.get(key)
      if (!data) {
        return 0
      }

      const record = JSON.parse(data) as BingQuotaRecord
      return record.used
    } catch (error) {
      logger.error(`Failed to get used quota for ${this.siteId}:`, error)
      return 0
    }
  }

  /**
   * 获取当日剩余配额
   * @param dailyLimit 每日配额限制
   * @returns 剩余配额数量
   */
  async getRemainingToday(dailyLimit: number): Promise<number> {
    const used = await this.getUsedToday()
    const remaining = dailyLimit - used
    return Math.max(0, remaining)
  }

  /**
   * 增加已使用配额
   * 注意: KV 不支持原子操作，可能存在并发超额问题（可接受的软限制）
   * @param count 要增加的数量
   * @param dailyLimit 每日配额限制
   */
  async incrementUsed(count: number, dailyLimit: number): Promise<void> {
    const today = new Date()
    const key = this.getQuotaKey(today)

    try {
      // 读取当前配额
      const currentUsed = await this.getUsedToday()
      const newUsed = currentUsed + count
      const remaining = Math.max(0, dailyLimit - newUsed)

      // 构建新记录（简化格式）
      const record: BingQuotaRecord = {
        used: newUsed,
        lastUpdate: new Date().toISOString(),
      }

      // 保存到 KV，设置 48 小时 TTL
      await this.kv.put(key, JSON.stringify(record), {
        expirationTtl: this.quotaTtlSeconds,
      })

      logger.info(
        `Quota updated for ${this.siteId}: ${currentUsed} -> ${newUsed} (${remaining} remaining)`
      )
    } catch (error) {
      logger.error(`Failed to increment quota for ${this.siteId}:`, error)
      throw error
    }
  }

  /**
   * 获取配额状态（用于 API 响应）
   * @returns 当日配额状态
   */
  async getQuotaStatus(dailyLimit: number): Promise<{
    date: string
    used: number
    limit: number
    remaining: number
    lastUpdate?: string
  }> {
    const today = new Date()
    const dateStr = this.formatDate(today)
    const key = this.getQuotaKey(today)

    let used = 0
    let lastUpdate: string | undefined

    try {
      const data = await this.kv.get(key)
      if (data) {
        const record = JSON.parse(data) as BingQuotaRecord
        used = record.used
        lastUpdate = record.lastUpdate
      }
    } catch {
      // 忽略错误，使用默认值
    }

    return {
      date: dateStr,
      used,
      limit: dailyLimit,
      remaining: Math.max(0, dailyLimit - used),
      lastUpdate,
    }
  }

  /**
   * 重置当日配额（仅用于测试或紧急情况）
   */
  async resetToday(): Promise<void> {
    const today = new Date()
    const key = this.getQuotaKey(today)

    try {
      await this.kv.delete(key)
      logger.warn(`Quota reset for ${this.siteId}`)
    } catch (error) {
      logger.error(`Failed to reset quota for ${this.siteId}:`, error)
      throw error
    }
  }

  /**
   * 检查是否有足够的配额
   * @param count 需要的配额数量
   * @param dailyLimit 每日配额限制
   * @returns 是否有足够配额
   */
  async hasQuota(count: number, dailyLimit: number): Promise<boolean> {
    const remaining = await this.getRemainingToday(dailyLimit)
    return remaining >= count
  }
}
