# 变更提案：自动化 IndexNow 提交系统

## Why

IndexNow 是一个允许网站主动通知搜索引擎内容更新的协议，可以加快搜索引擎的索引速度。当前缺乏自动化工具来定期采集网站地图（sitemap）并提交到 IndexNow，导致搜索引擎索引不及时。本提案旨在创建一个完全自动化的解决方案，通过 Cloudflare Workers 部署，实现每日自动采集网站地图并提交到 IndexNow API。

## What Changes

本变更将引入一个全新的自动化 IndexNow 提交系统，包含以下核心功能：

- **网站地图采集器**：自动解析和提取 XML 格式的网站地图中的所有 URL
- **IndexNow API 集成**：实现 IndexNow 协议的提交逻辑，支持批量提交 URL
- **定时调度器**：使用 Cloudflare Workers 的 Cron Triggers 实现每日定时执行
- **Cloudflare Workers 部署**：完整的 Workers 项目配置，支持环境变量和 KV 存储
- **错误处理和日志**：完整的错误处理机制和日志记录系统
- **配置管理**：灵活的配置系统，支持多站点和多搜索引擎

## Impact

### 影响的规范
- **NEW**: `specs/sitemap-crawler` - 网站地图采集功能
- **NEW**: `specs/indexnow-submission` - IndexNow 提交功能
- **NEW**: `specs/scheduler` - 定时调度功能
- **NEW**: `specs/cloudflare-worker` - Cloudflare Workers 部署配置

### 影响的代码
这是一个全新项目，将创建以下核心文件：
- `src/index.ts` - Workers 入口点和请求处理
- `src/crawler/sitemap-parser.ts` - 网站地图解析器
- `src/indexnow/client.ts` - IndexNow API 客户端
- `src/scheduler/cron-handler.ts` - 定时任务处理器
- `src/storage/url-cache.ts` - URL 缓存管理（使用 KV）
- `src/config/settings.ts` - 配置管理
- `wrangler.toml` - Cloudflare Workers 配置文件
- `package.json` - 项目依赖和脚本

### 技术栈
- **运行时**：Cloudflare Workers (Edge Runtime)
- **语言**：TypeScript
- **存储**：Cloudflare KV (用于 URL 缓存和去重)
- **调度**：Cloudflare Cron Triggers
- **外部 API**：IndexNow API (api.indexnow.org)

### 预期收益
- ✅ 自动化搜索引擎索引通知，无需手动干预
- ✅ 边缘计算部署，全球低延迟响应
- ✅ 零服务器成本（Cloudflare Workers 免费额度）
- ✅ 支持多站点和多搜索引擎配置
- ✅ 完整的错误处理和重试机制

### 风险和限制
- ⚠️ IndexNow API 限流：需要实现合理的批量提交策略
- ⚠️ Cloudflare Workers CPU 时间限制：需要优化处理大型网站地图
- ⚠️ KV 存储限制：需要定期清理过期的 URL 缓存
