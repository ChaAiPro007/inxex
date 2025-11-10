/**
 * Cloudflare Workers 入口文件
 * IndexNow 自动提交系统 - 多网站支持
 */

import { Env, SiteConfig, CreateSiteInput } from './types'
import { Scheduler } from './modules/scheduler'
import { loadConfig, getConfigSummary } from './modules/config'
import { SiteConfigManager } from './modules/site-config-manager'
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

      // 基础路由处理
      switch (path) {
        case '/':
          return handleRoot()

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
 * 根路径 - 显示欢迎信息
 */
function handleRoot(): Response {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IndexNow Worker</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      max-width: 800px;
      margin: 50px auto;
      padding: 20px;
      line-height: 1.6;
    }
    h1 { color: #2563eb; }
    code {
      background: #f3f4f6;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
    }
    .endpoint {
      background: #f9fafb;
      border-left: 4px solid #2563eb;
      padding: 12px;
      margin: 10px 0;
    }
  </style>
</head>
<body>
  <h1>🚀 IndexNow Worker</h1>
  <p>自动采集网站地图并提交到 IndexNow API</p>

  <h2>可用端点</h2>

  <div class="endpoint">
    <strong>GET /trigger</strong><br>
    手动触发 URL 采集和提交
  </div>

  <div class="endpoint">
    <strong>GET /status</strong><br>
    查看最近执行状态
  </div>

  <div class="endpoint">
    <strong>GET /health</strong><br>
    健康检查
  </div>

  <div class="endpoint">
    <strong>GET /config</strong><br>
    查看配置信息（已脱敏）
  </div>

  <div class="endpoint">
    <strong>GET /history</strong><br>
    查看最近 10 次执行历史
  </div>

  <h2>定时任务</h2>
  <p>系统会根据 Cron 配置自动执行（每 6 小时一次）</p>

  <footer style="margin-top: 40px; color: #6b7280; font-size: 0.9em;">
    Powered by Cloudflare Workers |
    <a href="https://github.com/anthropics/claude-code" target="_blank">Claude Code</a>
  </footer>
</body>
</html>
  `

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/**
 * 手动触发执行（支持多网站）
 */
async function handleTrigger(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const siteId = url.searchParams.get('site') || 'default'

  logger.info(`Manual trigger requested for site: ${siteId}`)

  try {
    const scheduler = new Scheduler(env, siteId)
    const stats = await scheduler.run()

    return new Response(
      JSON.stringify({
        success: true,
        siteId,
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

  return new Response(
    JSON.stringify({
      status: 'running',
      siteId,
      lastExecution: lastExecution ? JSON.parse(lastExecution) : null,
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
