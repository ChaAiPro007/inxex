/**
 * 配置管理模块
 */

import { Env, Config } from '../types'
import { logger } from '../utils/logger'

/**
 * 从环境变量加载配置
 */
export function loadConfig(env: Env): Config {
  // 验证必需的环境变量
  if (!env.SITEMAP_URL) {
    throw new Error('SITEMAP_URL is required')
  }

  if (!env.SITE_HOST) {
    throw new Error('SITE_HOST is required')
  }

  if (!env.INDEXNOW_API_KEY) {
    throw new Error('INDEXNOW_API_KEY is required')
  }

  // 默认搜索引擎
  const defaultSearchEngines = ['api.indexnow.org']

  const config: Config = {
    sitemapUrl: env.SITEMAP_URL,
    siteHost: env.SITE_HOST,
    apiKey: env.INDEXNOW_API_KEY,
    maxConcurrentRequests: parseInt(env.MAX_CONCURRENT_REQUESTS || '3'),
    requestIntervalMs: parseInt(env.REQUEST_INTERVAL_MS || '100'),
    cacheTtlDays: parseInt(env.CACHE_TTL_DAYS || '30'),
    maxRetries: parseInt(env.MAX_RETRIES || '3'),
    searchEngines: defaultSearchEngines,
  }

  // 验证配置
  validateConfig(config)

  return config
}

/**
 * 验证配置
 */
function validateConfig(config: Config): void {
  // 验证 URL
  try {
    new URL(config.sitemapUrl)
  } catch {
    throw new Error(`Invalid SITEMAP_URL: ${config.sitemapUrl}`)
  }

  // 验证 API 密钥格式
  if (config.apiKey.length < 8) {
    throw new Error('API key must be at least 8 characters')
  }

  if (!/^[a-f0-9]+$/.test(config.apiKey)) {
    throw new Error('API key must be hexadecimal')
  }

  // 验证数值范围
  if (config.maxConcurrentRequests < 1 || config.maxConcurrentRequests > 10) {
    throw new Error('MAX_CONCURRENT_REQUESTS must be between 1 and 10')
  }

  if (config.requestIntervalMs < 0) {
    throw new Error('REQUEST_INTERVAL_MS must be non-negative')
  }

  if (config.cacheTtlDays < 1) {
    throw new Error('CACHE_TTL_DAYS must be at least 1')
  }

  if (config.maxRetries < 0 || config.maxRetries > 10) {
    throw new Error('MAX_RETRIES must be between 0 and 10')
  }

  logger.info('Configuration loaded successfully')
}

/**
 * 获取配置摘要（脱敏）
 */
export function getConfigSummary(config: Config): Record<string, any> {
  return {
    sitemapUrl: config.sitemapUrl,
    siteHost: config.siteHost,
    apiKey: logger.maskApiKey(config.apiKey),
    maxConcurrentRequests: config.maxConcurrentRequests,
    requestIntervalMs: config.requestIntervalMs,
    cacheTtlDays: config.cacheTtlDays,
    maxRetries: config.maxRetries,
    searchEngines: config.searchEngines,
  }
}
