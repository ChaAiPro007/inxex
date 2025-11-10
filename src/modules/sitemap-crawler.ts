/**
 * Sitemap 爬虫模块
 * 负责获取和解析 sitemap.xml
 */

import { SitemapUrl } from '../types'
import { logger } from '../utils/logger'

/**
 * Sitemap 爬虫类
 */
export class SitemapCrawler {
  private sitemapUrl: string

  constructor(sitemapUrl: string) {
    this.sitemapUrl = sitemapUrl
  }

  /**
   * 获取所有 URL
   */
  async fetchUrls(): Promise<SitemapUrl[]> {
    logger.info(`Fetching sitemap from: ${this.sitemapUrl}`)

    try {
      const response = await fetch(this.sitemapUrl, {
        headers: {
          'User-Agent': 'IndexNow-Worker/1.0',
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('xml')) {
        logger.warn(`Unexpected content type: ${contentType}`)
      }

      const xml = await response.text()

      // 检查是否为 sitemap 索引
      if (xml.includes('<sitemapindex')) {
        logger.info('Detected sitemap index')
        return await this.parseSitemapIndex(xml)
      }

      return this.parseXml(xml)
    } catch (error) {
      logger.error('Failed to fetch sitemap:', error)
      throw error
    }
  }

  /**
   * 解析 XML
   */
  private parseXml(xml: string): SitemapUrl[] {
    const urls: SitemapUrl[] = []

    // 解析标准 sitemap
    const urlPattern = /<url>([\s\S]*?)<\/url>/g
    const locPattern = /<loc>(.*?)<\/loc>/
    const lastmodPattern = /<lastmod>(.*?)<\/lastmod>/
    const changefreqPattern = /<changefreq>(.*?)<\/changefreq>/
    const priorityPattern = /<priority>(.*?)<\/priority>/

    let match
    while ((match = urlPattern.exec(xml)) !== null) {
      const urlBlock = match[1]

      const locMatch = urlBlock.match(locPattern)
      if (!locMatch) continue

      const url: SitemapUrl = {
        loc: this.decodeXmlEntities(locMatch[1].trim()),
      }

      const lastmodMatch = urlBlock.match(lastmodPattern)
      if (lastmodMatch) {
        url.lastmod = lastmodMatch[1].trim()
      }

      const changefreqMatch = urlBlock.match(changefreqPattern)
      if (changefreqMatch) {
        url.changefreq = changefreqMatch[1].trim()
      }

      const priorityMatch = urlBlock.match(priorityPattern)
      if (priorityMatch) {
        url.priority = priorityMatch[1].trim()
      }

      urls.push(url)
    }

    logger.info(`Parsed ${urls.length} URLs from sitemap`)
    return urls
  }

  /**
   * 解析 sitemap 索引（递归获取所有 sitemap）
   */
  private async parseSitemapIndex(xml: string): Promise<SitemapUrl[]> {
    const sitemapPattern = /<sitemap>([\s\S]*?)<\/sitemap>/g
    const locPattern = /<loc>(.*?)<\/loc>/

    const sitemapUrls: string[] = []
    let match

    while ((match = sitemapPattern.exec(xml)) !== null) {
      const sitemapBlock = match[1]
      const locMatch = sitemapBlock.match(locPattern)

      if (locMatch) {
        sitemapUrls.push(this.decodeXmlEntities(locMatch[1].trim()))
      }
    }

    logger.info(`Found ${sitemapUrls.length} sitemaps in index`)

    // 并行获取所有 sitemap
    const allUrls: SitemapUrl[] = []

    for (const sitemapUrl of sitemapUrls) {
      try {
        const crawler = new SitemapCrawler(sitemapUrl)
        const urls = await crawler.fetchUrls()
        allUrls.push(...urls)
      } catch (error) {
        logger.error(`Failed to fetch sitemap ${sitemapUrl}:`, error)
      }
    }

    logger.info(`Total URLs from all sitemaps: ${allUrls.length}`)
    return allUrls
  }

  /**
   * 解码 XML 实体
   */
  private decodeXmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
  }

  /**
   * 验证 URL
   */
  validateUrl(url: string): boolean {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  }

  /**
   * 过滤 URL（只保留有效的 URL）
   */
  filterValidUrls(urls: SitemapUrl[]): SitemapUrl[] {
    return urls.filter((url) => this.validateUrl(url.loc))
  }
}
