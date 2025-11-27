# Proposal: Add Bing Webmaster API Submission

## Why

当前系统仅支持 IndexNow 协议提交 URL。Bing Webmaster API 提供了另一个官方渠道，可直接向 Bing 搜索引擎提交 URL，具有以下优势：

1. **双渠道保障** - IndexNow 失败时，Bing API 可作为备用
2. **官方支持** - Bing Webmaster Tools 官方 API，提交状态可在后台查看
3. **精准控制** - 每日 100 条配额，可优先提交重要页面

## What Changes

### 1. 配置扩展

在 `SiteConfig` 中新增 Bing 相关字段：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `bingEnabled` | boolean | 否 | `false` | 是否启用 Bing 提交 |
| `bingApiKey` | string | 启用时必填 | - | Bing Webmaster API Key |
| `bingDailyQuota` | number | 否 | `100` | 每日配额上限 |
| `bingPriority` | enum | 否 | `'newest'` | URL 选择策略 |

### 2. 新增模块

- **BingSubmitter** (`src/modules/bing-submitter.ts`) - Bing API 提交器
- **QuotaManager** (`src/modules/quota-manager.ts`) - 每日配额管理

### 3. 扩展模块

- **UrlCache** - 支持按渠道（`indexnow` / `bing`）区分已提交 URL
- **Scheduler** - 集成 Bing 提交流程
- **API 响应** - `/status` 和 `/api/stats` 返回 Bing 相关信息

### 4. KV 存储新增键

```
bing:quota:{siteId}:{YYYY-MM-DD}    # 当日已用配额 (TTL: 48h)
url_cache:bing:{siteId}:{urlHash}   # Bing 已提交 URL (TTL: 30d)
```

**注意**: Bing 执行历史不单独存储，复用现有 `sites:history:{siteId}` 记录并扩展 `bingStats` 字段。

## Impact

### Affected Specs
- 新增: `bing-submitter` capability

### Affected Code
- `src/types/index.ts` - 类型定义扩展
- `src/modules/url-cache.ts` - 渠道区分
- `src/modules/scheduler.ts` - 流程集成
- `src/modules/site-config-manager.ts` - 配置验证
- `src/index.ts` - API 响应扩展

### Backward Compatibility
- **完全兼容** - 所有现有功能保持不变
- `bingEnabled` 默认 `false`，不影响现有站点
- IndexNow 提交逻辑零修改

### Risk Assessment
- **低风险** - 纯新增功能，不修改现有核心逻辑
- **隔离性好** - Bing 提交失败不影响 IndexNow 提交
