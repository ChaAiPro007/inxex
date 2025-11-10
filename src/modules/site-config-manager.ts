/**
 * 网站配置管理器
 * 负责多网站配置的 CRUD 操作和验证
 */

import { SiteConfig, CreateSiteInput, ValidationResult } from '../types'
import { logger } from '../utils/logger'

/**
 * 网站配置管理器类
 */
export class SiteConfigManager {
  private kv: KVNamespace
  private listKey = 'sites:list'

  constructor(kv: KVNamespace) {
    this.kv = kv
  }

  /**
   * 从最小输入构建完整的站点配置（智能默认值）
   */
  static buildSiteConfig(input: CreateSiteInput): SiteConfig {
    // 1. 从 sitemapUrl 提取域名
    const url = new URL(input.sitemapUrl)
    const domain = url.hostname

    // 2. 生成站点ID（使用完整域名）
    const id = input.id || domain

    // 3. 生成友好的站点名称
    const cleanDomain = domain.replace(/^www\./, '')
    const mainPart = cleanDomain.split('.')[0]
    const defaultName = mainPart.charAt(0).toUpperCase() + mainPart.slice(1)
    const name = input.name || defaultName

    // 4. 构造 keyLocation
    const keyLocation =
      input.keyLocation || `https://${domain}/${input.apiKey}.txt`

    // 5. 应用智能默认值
    const now = new Date().toISOString()

    return {
      id,
      name,
      sitemapUrl: input.sitemapUrl,
      apiKey: input.apiKey,
      keyLocation,
      searchEngines: input.searchEngines || ['api.indexnow.org'],
      enabled: input.enabled !== undefined ? input.enabled : true,
      interval: input.interval || 6,
      lastRunTime: input.lastRunTime || 0,
      maxConcurrentRequests: input.maxConcurrentRequests || 3,
      requestIntervalMs: input.requestIntervalMs || 100,
      maxRetries: input.maxRetries || 3,
      cacheTtlDays: input.cacheTtlDays || 30,
      createdAt: now,
      updatedAt: now,
    }
  }

  /**
   * 获取配置键
   */
  private getConfigKey(siteId: string): string {
    return `sites:config:${siteId}`
  }

  /**
   * 获取网站配置
   */
  async getSite(siteId: string): Promise<SiteConfig | null> {
    try {
      const data = await this.kv.get(this.getConfigKey(siteId))
      if (!data) {
        return null
      }

      const config = JSON.parse(data) as SiteConfig
      logger.info(`Loaded config for site: ${siteId}`)
      return config
    } catch (error) {
      logger.error(`Failed to get site ${siteId}:`, error)
      return null
    }
  }

  /**
   * 列出所有网站ID
   */
  async listSiteIds(): Promise<string[]> {
    try {
      const data = await this.kv.get(this.listKey)
      if (!data) {
        return []
      }

      return JSON.parse(data) as string[]
    } catch (error) {
      logger.error('Failed to list site IDs:', error)
      return []
    }
  }

  /**
   * 列出所有网站配置
   */
  async listSites(): Promise<SiteConfig[]> {
    const siteIds = await this.listSiteIds()

    // 并发读取所有配置
    const configs = await Promise.all(
      siteIds.map((id) => this.getSite(id))
    )

    // 过滤掉null值
    return configs.filter((config): config is SiteConfig => config !== null)
  }

  /**
   * 获取所有启用的网站
   */
  async getEnabledSites(): Promise<SiteConfig[]> {
    const sites = await this.listSites()
    return sites.filter((site) => site.enabled)
  }

  /**
   * 获取需要执行的网站（检查interval）
   */
  async getSitesToRun(): Promise<SiteConfig[]> {
    const enabledSites = await this.getEnabledSites()
    const now = Date.now()

    return enabledSites.filter((site) => {
      const elapsed = now - (site.lastRunTime || 0)
      const shouldRun = elapsed >= site.interval * 3600000 // interval in hours
      return shouldRun
    })
  }

  /**
   * 添加新网站（支持最小参数输入）
   */
  async addSite(input: CreateSiteInput): Promise<void> {
    try {
      // 使用智能构建器生成完整配置
      const config = SiteConfigManager.buildSiteConfig(input)

      // 检查是否已存在
      const existing = await this.getSite(config.id)
      if (existing) {
        throw new Error(`Site ${config.id} already exists`)
      }

      // 验证配置
      const validation = await this.validateSite(config)
      if (!validation.valid) {
        throw new Error(`Invalid config: ${validation.errors.join(', ')}`)
      }

      // 保存配置（时间戳已在 buildSiteConfig 中生成）
      await this.kv.put(this.getConfigKey(config.id), JSON.stringify(config))

      // 更新站点列表
      const siteIds = await this.listSiteIds()
      siteIds.push(config.id)
      await this.kv.put(this.listKey, JSON.stringify(siteIds))

      logger.info(`Added site: ${config.id}`)
    } catch (error) {
      logger.error(`Failed to add site ${input.sitemapUrl}:`, error)
      throw error
    }
  }

  /**
   * 更新网站配置
   */
  async updateSite(
    siteId: string,
    updates: Partial<SiteConfig>
  ): Promise<void> {
    try {
      // 获取现有配置
      const existing = await this.getSite(siteId)
      if (!existing) {
        throw new Error(`Site ${siteId} not found`)
      }

      // 合并更新
      const updated: SiteConfig = {
        ...existing,
        ...updates,
        id: siteId, // 不允许修改ID
        updatedAt: new Date().toISOString(),
      }

      // 验证更新后的配置
      const validation = await this.validateSite(updated)
      if (!validation.valid) {
        throw new Error(`Invalid config: ${validation.errors.join(', ')}`)
      }

      // 保存更新
      await this.kv.put(this.getConfigKey(siteId), JSON.stringify(updated))

      logger.info(`Updated site: ${siteId}`)
    } catch (error) {
      logger.error(`Failed to update site ${siteId}:`, error)
      throw error
    }
  }

  /**
   * 删除网站
   */
  async deleteSite(siteId: string): Promise<void> {
    try {
      // 检查是否存在
      const existing = await this.getSite(siteId)
      if (!existing) {
        throw new Error(`Site ${siteId} not found`)
      }

      // 删除配置
      await this.kv.delete(this.getConfigKey(siteId))

      // 更新站点列表
      const siteIds = await this.listSiteIds()
      const filtered = siteIds.filter((id) => id !== siteId)
      await this.kv.put(this.listKey, JSON.stringify(filtered))

      // 清理相关数据
      await this.kv.delete(`sites:history:${siteId}`)
      await this.kv.delete(`sites:last_execution:${siteId}`)

      logger.info(`Deleted site: ${siteId}`)
    } catch (error) {
      logger.error(`Failed to delete site ${siteId}:`, error)
      throw error
    }
  }

  /**
   * 验证网站配置
   */
  async validateSite(config: SiteConfig): Promise<ValidationResult> {
    const errors: string[] = []

    // 1. 基础字段验证
    if (!config.id || !config.id.trim()) {
      errors.push('Site ID is required')
    }

    if (!config.name || !config.name.trim()) {
      errors.push('Site name is required')
    }

    if (!config.sitemapUrl || !this.isValidUrl(config.sitemapUrl)) {
      errors.push('Invalid sitemap URL')
    }

    if (!config.apiKey || !/^[a-f0-9]{32}$/.test(config.apiKey)) {
      errors.push('Invalid API key format (expected 32 hex chars)')
    }

    if (!config.keyLocation || !this.isValidUrl(config.keyLocation)) {
      errors.push('Invalid key location URL')
    }

    // 2. 数值验证
    if (config.interval <= 0) {
      errors.push('Interval must be positive')
    }

    if (config.maxConcurrentRequests <= 0 || config.maxConcurrentRequests > 10) {
      errors.push('Max concurrent requests must be between 1-10')
    }

    if (config.requestIntervalMs < 0) {
      errors.push('Request interval must be non-negative')
    }

    if (config.maxRetries < 0 || config.maxRetries > 10) {
      errors.push('Max retries must be between 0-10')
    }

    if (config.cacheTtlDays <= 0) {
      errors.push('Cache TTL must be positive')
    }

    // 3. 搜索引擎验证
    if (!config.searchEngines || config.searchEngines.length === 0) {
      errors.push('At least one search engine is required')
    }

    // 4. 网络验证（可选，暂时禁用以避免添加配置时的额外延迟）
    // 可以在后台异步验证或通过单独的验证API
    // try {
    //   const sitemapResponse = await fetch(config.sitemapUrl, {
    //     method: 'HEAD',
    //     signal: AbortSignal.timeout(5000),
    //   })
    //   if (!sitemapResponse.ok) {
    //     errors.push(`Sitemap not accessible: HTTP ${sitemapResponse.status}`)
    //   }
    // } catch (error) {
    //   logger.warn(`Sitemap validation failed: ${error}`)
    // }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * 验证URL格式
   */
  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  }

  /**
   * 导出所有配置
   */
  async exportConfigs(): Promise<SiteConfig[]> {
    return await this.listSites()
  }

  /**
   * 批量导入配置
   */
  async importConfigs(configs: SiteConfig[]): Promise<{
    success: string[]
    failed: Array<{ id: string; error: string }>
  }> {
    const success: string[] = []
    const failed: Array<{ id: string; error: string }> = []

    for (const config of configs) {
      try {
        await this.addSite(config)
        success.push(config.id)
      } catch (error) {
        failed.push({
          id: config.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return { success, failed }
  }
}
