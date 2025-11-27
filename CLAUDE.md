# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

## Project Overview

IndexNow Worker 是一个基于 Cloudflare Workers 的自动化系统，用于采集网站 sitemap.xml 并提交 URL 到 IndexNow API，加速搜索引擎索引。支持多网站配置和定时调度。

## Commands

```bash
# Development
npm run dev              # Start local dev server (wrangler dev)
npm run type-check       # TypeScript type checking
npm run test             # Run tests with vitest

# Deployment
npm run deploy           # Deploy to Cloudflare Workers
./deploy.sh              # Automated deployment script with checks

# Monitoring
wrangler tail            # View real-time logs
```

## Architecture

### Entry Point
- `src/index.ts` - Cloudflare Workers entry, exports `fetch` (HTTP) and `scheduled` (Cron) handlers

### Core Modules (`src/modules/`)
- **scheduler.ts** - Main orchestrator coordinating sitemap crawling and IndexNow submission
- **site-config-manager.ts** - Multi-site CRUD operations with KV storage
- **sitemap-crawler.ts** - XML sitemap parser supporting nested sitemap indexes
- **indexnow-submitter.ts** - Batch POST submission (up to 10,000 URLs per request)
- **url-cache.ts** - KV-based URL deduplication with configurable TTL
- **config.ts** - Environment variable loading and validation (legacy single-site mode)

### Utilities (`src/utils/`)
- **logger.ts** - Structured logging with API key masking
- **concurrency.ts** - Retry with exponential backoff

### Type Definitions (`src/types/index.ts`)
- `Env` - Cloudflare Workers environment bindings
- `SiteConfig` / `CreateSiteInput` - Multi-site configuration
- `Config` - Legacy single-site configuration
- `SitemapUrl` / `SubmissionResult` / `SubmissionStats` - Data transfer objects

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/config` | GET | View config (masked API keys) |
| `/status?site=<id>` | GET | Site execution status |
| `/history?site=<id>` | GET | Execution history |
| `/trigger?site=<id>` | GET | Manual trigger |
| `/api/sites` | GET/POST | List/add sites |
| `/api/sites/:id` | GET/PUT/DELETE | Site CRUD |
| `/api/stats/daily` | GET | Daily statistics |
| `/api/stats/summary` | GET | Overall summary |

## Multi-Site vs Single-Site Mode

- **Multi-site**: Sites stored in KV via `/api/sites`, identified by domain-based IDs
- **Single-site (legacy)**: Uses `wrangler.toml` env vars (`SITEMAP_URL`, `SITE_HOST`, `INDEXNOW_API_KEY`)
- Scheduler uses `siteId='default'` for legacy mode, otherwise loads from KV

## KV Storage Keys

```
sites:list                    # Array of site IDs
sites:config:{siteId}         # SiteConfig JSON
sites:history:{siteId}        # Last 100 execution records (1 year TTL)
sites:last_execution:{siteId} # Most recent execution
url_cache:{siteId}:{urlHash}  # URL deduplication (30 day TTL default)
```

## Key Configuration Values

- `maxConcurrentRequests`: 1-10 (default 3)
- `requestIntervalMs`: Delay between batches (default 100ms)
- `cacheTtlDays`: URL cache TTL (default 30)
- `maxRetries`: Retry attempts (default 3)
- `interval`: Hours between scheduled runs (default 6)

## IndexNow Submission Flow

1. Scheduler loads site config (from KV or env vars)
2. SitemapCrawler fetches and parses sitemap XML
3. UrlCache filters out previously submitted URLs
4. IndexNowSubmitter batches URLs (max 10,000 per POST)
5. Results cached and execution history recorded

## Testing

```bash
npm run test              # Run all tests
npx vitest run <file>     # Run specific test file
npx vitest --watch        # Watch mode
```

## Deployment Checklist

1. Ensure `wrangler.toml` has correct `account_id` and KV namespace `id`
2. Set secret: `wrangler secret put INDEXNOW_API_KEY`
3. Upload key file to site: `https://your-site.com/{api-key}.txt`
4. Deploy: `npm run deploy`
