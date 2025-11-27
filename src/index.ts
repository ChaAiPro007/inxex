/**
 * Cloudflare Workers 入口文件
 * IndexNow 自动提交系统 - 多网站支持
 */

import { Env, SiteConfig, CreateSiteInput } from './types'
import { Scheduler, SubmissionChannel } from './modules/scheduler'
import { loadConfig, getConfigSummary } from './modules/config'
import { SiteConfigManager } from './modules/site-config-manager'
import { QuotaManager } from './modules/quota-manager'
import { logger } from './utils/logger'

/**
 * Fetch 事件处理器（HTTP 请求）
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    try {
      // API 路由处理
      if (path.startsWith('/api/sites')) {
        return await handleSitesAPI(request, env)
      }

      if (path.startsWith('/api/stats')) {
        return await handleStatsAPI(request, env)
      }

      // 基础路由处理
      switch (path) {
        case '/trigger':
          return await handleTrigger(request, env)

        case '/status':
          return await handleStatus(request, env)

        case '/health':
          return handleHealth()

        case '/config':
          return handleConfig(env)

        case '/history':
          return await handleHistory(request, env)

        default:
          return new Response('Not Found', { status: 404 })
      }
    } catch (error) {
      logger.error('Request handler error:', error)
      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
  },

  /**
   * 定时触发器（Cron）- 多网站并行调度
   */
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    logger.info('Cron trigger fired:', new Date(event.scheduledTime).toISOString())

    try {
      const manager = new SiteConfigManager(env.CACHE)

      // 获取需要执行的网站
      const sitesToRun = await manager.getSitesToRun()
      logger.info(`Found ${sitesToRun.length} sites to run`)

      if (sitesToRun.length === 0) {
        logger.info('No sites need to run at this time')
        return
      }

      // 并发控制：最多同时执行3个网站
      const maxConcurrency = 3
      const results: Array<{
        siteId: string
        success: boolean
        error?: string
      }> = []

      for (let i = 0; i < sitesToRun.length; i += maxConcurrency) {
        const batch = sitesToRun.slice(i, i + maxConcurrency)

        // 并行执行当前批次
        const batchResults = await Promise.allSettled(
          batch.map(async (site) => {
            try {
              logger.info(`Starting execution for site: ${site.id}`)
              const scheduler = new Scheduler(env, site.id)
              const stats = await scheduler.run()

              // 更新最后执行时间
              await manager.updateSite(site.id, {
                lastRunTime: Date.now(),
              })

              logger.info(`Completed execution for site: ${site.id}`, stats)
              return { siteId: site.id, success: true }
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error)
              logger.error(`Failed execution for site: ${site.id}`, errorMsg)
              return { siteId: site.id, success: false, error: errorMsg }
            }
          })
        )

        // 收集结果（错误隔离）
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push(result.value)
          } else {
            results.push({
              siteId: batch[index].id,
              success: false,
              error: result.reason?.message || 'Unknown error',
            })
          }
        })
      }

      // 汇总结果
      const summary = {
        total: results.length,
        successful: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        results,
      }

      logger.info('Cron execution completed:', summary)
    } catch (error) {
      logger.error('Cron scheduler failed:', error)
      throw error
    }
  },
}

/**
 * 手动触发执行（支持多网站和渠道选择）
 * @param channel - 提交渠道: 'all' | 'indexnow' | 'bing'
 */
async function handleTrigger(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const siteId = url.searchParams.get('site') || 'default'
  const channelParam = url.searchParams.get('channel') || 'all'

  // 验证 channel 参数
  const validChannels: SubmissionChannel[] = ['all', 'indexnow', 'bing']
  const channel: SubmissionChannel = validChannels.includes(channelParam as SubmissionChannel)
    ? (channelParam as SubmissionChannel)
    : 'all'

  logger.info(`Manual trigger requested for site: ${siteId}, channel: ${channel}`)

  try {
    const scheduler = new Scheduler(env, siteId, channel)
    const stats = await scheduler.run()

    return new Response(
      JSON.stringify({
        success: true,
        siteId,
        channel,
        message: 'Execution completed',
        stats,
        report: scheduler.formatStatsReport(stats),
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        siteId,
        channel,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

/**
 * 状态查询（支持多网站）
 */
async function handleStatus(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const siteId = url.searchParams.get('site') || 'default'

  // 从 KV 读取站点执行状态
  const lastExecKey = `sites:last_execution:${siteId}`
  const lastExecution = await env.CACHE.get(lastExecKey)

  // 获取 Bing 配额信息（如果启用）
  let bingQuota = null
  if (siteId !== 'default') {
    const manager = new SiteConfigManager(env.CACHE)
    const siteConfig = await manager.getSite(siteId)

    if (siteConfig?.bingEnabled) {
      const quotaManager = new QuotaManager(env.CACHE, siteId)
      bingQuota = await quotaManager.getQuotaStatus(siteConfig.bingDailyQuota)
    }
  }

  return new Response(
    JSON.stringify({
      status: 'running',
      siteId,
      lastExecution: lastExecution ? JSON.parse(lastExecution) : null,
      bingQuota,
      timestamp: new Date().toISOString(),
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

/**
 * 健康检查
 */
function handleHealth(): Response {
  return new Response(
    JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

/**
 * 执行历史查询（支持多网站）
 */
async function handleHistory(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const siteId = url.searchParams.get('site') || 'default'

    const historyKey = `sites:history:${siteId}`
    const historyData = await env.CACHE.get(historyKey)
    const history = historyData ? JSON.parse(historyData) : []

    return new Response(
      JSON.stringify(
        {
          siteId,
          total: history.length,
          records: history,
        },
        null,
        2
      ),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

/**
 * 配置查询（脱敏）
 */
function handleConfig(env: Env): Response {
  try {
    const config = loadConfig(env)
    const summary = getConfigSummary(config)

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

/**
 * 网站配置 API 处理器
 */
async function handleSitesAPI(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method

  // 初始化 SiteConfigManager
  const manager = new SiteConfigManager(env.CACHE)

  try {
    // GET /api/sites - 列出所有网站
    if (path === '/api/sites' && method === 'GET') {
      const sites = await manager.listSites()
      return new Response(
        JSON.stringify({ success: true, sites }, null, 2),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // POST /api/sites - 添加新网站（支持最小参数）
    if (path === '/api/sites' && method === 'POST') {
      const input: CreateSiteInput = await request.json()
      await manager.addSite(input)

      // 提取或生成站点ID用于响应消息
      const siteId = input.id || new URL(input.sitemapUrl).hostname

      return new Response(
        JSON.stringify({
          success: true,
          message: `Site ${siteId} added successfully`,
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 处理 /api/sites/:id 路由
    const idMatch = path.match(/^\/api\/sites\/([^/]+)$/)
    if (idMatch) {
      const siteId = idMatch[1]

      // GET /api/sites/:id - 获取单个网站
      if (method === 'GET') {
        const site = await manager.getSite(siteId)
        if (!site) {
          return new Response(
            JSON.stringify({ success: false, error: 'Site not found' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          )
        }
        return new Response(
          JSON.stringify({ success: true, site }, null, 2),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }

      // PUT /api/sites/:id - 更新网站
      if (method === 'PUT') {
        const updates: Partial<SiteConfig> = await request.json()
        await manager.updateSite(siteId, updates)
        return new Response(
          JSON.stringify({
            success: true,
            message: `Site ${siteId} updated successfully`,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }

      // DELETE /api/sites/:id - 删除网站
      if (method === 'DELETE') {
        await manager.deleteSite(siteId)
        return new Response(
          JSON.stringify({
            success: true,
            message: `Site ${siteId} deleted successfully`,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }
    }

    // 不支持的方法或路径
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    logger.error('Sites API error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

/**
 * 统计 API 处理器
 */
async function handleStatsAPI(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method

  try {
    // GET /api/stats/daily - 每日统计
    if (path === '/api/stats/daily' && method === 'GET') {
      const days = parseInt(url.searchParams.get('days') || '7', 10)
      const siteId = url.searchParams.get('site')

      const manager = new SiteConfigManager(env.CACHE)
      const sites = siteId
        ? [await manager.getSite(siteId)].filter(Boolean)
        : await manager.listSites()

      // 收集所有站点的历史记录
      const allRecords: Array<{
        siteId: string
        siteName: string
        timestamp: string
        stats: any
      }> = []

      for (const site of sites) {
        const historyKey = `sites:history:${site!.id}`
        const historyData = await env.CACHE.get(historyKey)
        const history = historyData ? JSON.parse(historyData) : []

        history.forEach((record: any) => {
          allRecords.push({
            siteId: site!.id,
            siteName: site!.name,
            timestamp: record.timestamp,
            stats: record.stats,
          })
        })
      }

      // 按日期分组统计（分 indexnow 和 bing）
      const dailyStats = new Map<
        string,
        {
          date: string
          indexnow: {
            total: number
            successful: number
            failed: number
            skipped: number
          }
          bing: {
            total: number
            successful: number
            failed: number
          }
          sites: Set<string>
          executions: number
        }
      >()

      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - days)

      allRecords.forEach((record) => {
        const recordDate = new Date(record.timestamp)
        if (recordDate < cutoffDate) return

        const dateKey = recordDate.toISOString().split('T')[0] // YYYY-MM-DD

        if (!dailyStats.has(dateKey)) {
          dailyStats.set(dateKey, {
            date: dateKey,
            indexnow: {
              total: 0,
              successful: 0,
              failed: 0,
              skipped: 0,
            },
            bing: {
              total: 0,
              successful: 0,
              failed: 0,
            },
            sites: new Set(),
            executions: 0,
          })
        }

        const dayStat = dailyStats.get(dateKey)!

        // IndexNow 统计
        dayStat.indexnow.total += record.stats.total || 0
        dayStat.indexnow.successful += record.stats.successful || 0
        dayStat.indexnow.failed += record.stats.failed || 0
        dayStat.indexnow.skipped += record.stats.skipped || 0

        // Bing 统计（从 record 中获取，如果存在）
        if ((record as any).bingStats) {
          const bingStats = (record as any).bingStats
          dayStat.bing.total += bingStats.total || 0
          dayStat.bing.successful += bingStats.successful || 0
          dayStat.bing.failed += bingStats.failed || 0
        }

        dayStat.sites.add(record.siteId)
        dayStat.executions += 1
      })

      // 转换为数组并排序（最新的在前）
      const dailyArray = Array.from(dailyStats.values())
        .map((stat) => ({
          ...stat,
          sites: stat.sites.size,
        }))
        .sort((a, b) => b.date.localeCompare(a.date))

      // 计算总计
      const summary = {
        indexnow: {
          totalUrlsSubmitted: dailyArray.reduce((sum, d) => sum + d.indexnow.total, 0),
          totalSuccessful: dailyArray.reduce((sum, d) => sum + d.indexnow.successful, 0),
          totalFailed: dailyArray.reduce((sum, d) => sum + d.indexnow.failed, 0),
        },
        bing: {
          totalUrlsSubmitted: dailyArray.reduce((sum, d) => sum + d.bing.total, 0),
          totalSuccessful: dailyArray.reduce((sum, d) => sum + d.bing.successful, 0),
          totalFailed: dailyArray.reduce((sum, d) => sum + d.bing.failed, 0),
        },
        totalExecutions: dailyArray.reduce((sum, d) => sum + d.executions, 0),
        uniqueSites: new Set(allRecords.map((r) => r.siteId)).size,
        dateRange: {
          from: cutoffDate.toISOString().split('T')[0],
          to: new Date().toISOString().split('T')[0],
        },
      }

      return new Response(
        JSON.stringify(
          {
            success: true,
            summary,
            daily: dailyArray,
          },
          null,
          2
        ),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // GET /api/stats/summary - 总体统计
    if (path === '/api/stats/summary' && method === 'GET') {
      const manager = new SiteConfigManager(env.CACHE)
      const sites = await manager.listSites()

      let totalUrlsSubmitted = 0
      let totalExecutions = 0

      for (const site of sites) {
        const historyKey = `sites:history:${site.id}`
        const historyData = await env.CACHE.get(historyKey)
        const history = historyData ? JSON.parse(historyData) : []

        totalExecutions += history.length
        history.forEach((record: any) => {
          totalUrlsSubmitted += record.stats.total || 0
        })
      }

      return new Response(
        JSON.stringify(
          {
            success: true,
            stats: {
              totalSites: sites.length,
              enabledSites: sites.filter((s) => s.enabled).length,
              totalUrlsSubmitted,
              totalExecutions,
              lastUpdate: new Date().toISOString(),
            },
          },
          null,
          2
        ),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 不支持的路径
    return new Response(
      JSON.stringify({ success: false, error: 'Not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    logger.error('Stats API error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
