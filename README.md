# IndexNow Worker - 多网站自动提交系统

基于 Cloudflare Workers 的 IndexNow 和 Bing Webmaster API 自动提交系统，支持多网站管理、定时提交、配额控制。

## 功能特性

- **多网站支持**: 单一 Worker 管理多个网站的 URL 提交
- **双渠道提交**: 同时支持 IndexNow 和 Bing Webmaster API
- **智能配额管理**: Bing API 每日配额自动跟踪和控制
- **定时自动执行**: 通过 Cron 触发器定期提交新 URL
- **URL 去重缓存**: 避免重复提交，使用 KV 存储已提交 URL
- **Sitemap 解析**: 自动解析 sitemap.xml 获取 URL 列表
- **RESTful API**: 完整的网站配置管理 API

## 快速开始

### 1. 环境准备

```bash
# 安装 Node.js (推荐 18+)
# 安装 Wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login
```

### 2. 克隆项目

```bash
git clone https://github.com/your-username/indexnow-worker.git
cd indexnow-worker
npm install
```

### 3. 配置 Cloudflare

#### 3.1 创建 KV 命名空间

```bash
# 创建 KV 命名空间
wrangler kv:namespace create "CACHE"

# 输出示例:
# { binding = "CACHE", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
```

#### 3.2 配置 wrangler.toml

复制示例配置并修改：

```bash
cp wrangler.toml.example wrangler.toml
```

编辑 `wrangler.toml`：

```toml
name = "indexnow-worker"
main = "src/index.ts"
compatibility_date = "2024-01-10"

# Worker 配置
workers_dev = true
account_id = "你的Cloudflare账户ID"  # 从 Cloudflare 控制台获取

# KV 命名空间
[[kv_namespaces]]
binding = "CACHE"
id = "你的KV命名空间ID"  # 上一步创建时获得的 ID

# Cron 触发器
[triggers]
crons = ["0 */6 * * *"]  # 每 6 小时执行一次
```

**获取 account_id**:
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 点击任意域名进入
3. 右侧边栏可以看到 "Account ID"

### 4. 部署

```bash
# 部署到 Cloudflare Workers
npm run deploy

# 或使用 wrangler 直接部署
wrangler deploy
```

部署成功后会输出 Worker URL，例如：
```
https://indexnow-worker.your-subdomain.workers.dev
```

---

## IndexNow 配置

### 生成 IndexNow API Key

IndexNow API Key 是一个 **32 位十六进制字符串**，你可以：

#### 方法1: 在线生成
访问 [IndexNow 官网](https://www.indexnow.org/) 生成

#### 方法2: 命令行生成

```bash
# macOS/Linux
openssl rand -hex 16

# 示例输出: e1ab9d6410ff0f71c525faf0861dd87c
```

#### 方法3: Node.js 生成

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### 配置 Key 验证文件

IndexNow 要求在网站根目录放置验证文件：

1. 假设你的 API Key 是 `e1ab9d6410ff0f71c525faf0861dd87c`
2. 创建文件 `e1ab9d6410ff0f71c525faf0861dd87c.txt`
3. 文件内容就是 Key 本身：`e1ab9d6410ff0f71c525faf0861dd87c`
4. 上传到网站根目录，确保可访问：
   ```
   https://yoursite.com/e1ab9d6410ff0f71c525faf0861dd87c.txt
   ```

---

## Bing Webmaster API 配置

### 获取 Bing API Key

1. 访问 [Bing Webmaster Tools](https://www.bing.com/webmasters)
2. 使用 Microsoft 账号登录
3. 添加并验证你的网站（如果尚未添加）
4. 点击 **左上角** 的 **设置图标** ⚙️
5. 选择 **API 访问** → **API 密钥**
6. 点击 **生成** 或复制现有密钥

> **注意**: Bing API Key 是账户级别的，一个 Key 可以用于该账户下所有已验证的网站。

### Bing URL 提交 API 文档

官方文档: [https://www.bing.com/webmasters/url-submission-api#APIs](https://www.bing.com/webmasters/url-submission-api#APIs)

API 端点:
```
POST https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch?apikey=YOUR_API_KEY
```

### Bing API 配额说明

| 网站类型 | 每日配额 | 说明 |
|---------|---------|------|
| 新网站 | 10 URL/天 | 刚验证的网站 |
| 普通网站 | 100 URL/天 | 已验证一段时间 |
| 高质量网站 | 更高 | 取决于网站信誉 |

**配额重置时间**: 每天 UTC 00:00（北京时间 08:00）

**查看你的配额**:
1. 登录 Bing Webmaster Tools
2. 选择你的网站
3. 进入 **配置** → **URL 提交 API**
4. 查看 "每日配额" 信息

---

## 网站管理 API

### 添加网站（最小配置）

只需提供 sitemap 地址和 IndexNow API Key：

```bash
curl -X POST "https://your-worker.workers.dev/api/sites" \
  -H "Content-Type: application/json" \
  -d '{
    "sitemapUrl": "https://example.com/sitemap.xml",
    "apiKey": "e1ab9d6410ff0f71c525faf0861dd87c"
  }'
```

系统会自动：
- 从 URL 提取域名作为网站 ID
- 生成友好的网站名称
- 设置默认配置

### 添加网站（完整配置，含 Bing）

```bash
curl -X POST "https://your-worker.workers.dev/api/sites" \
  -H "Content-Type: application/json" \
  -d '{
    "sitemapUrl": "https://example.com/sitemap.xml",
    "apiKey": "e1ab9d6410ff0f71c525faf0861dd87c",
    "name": "我的网站",
    "bingEnabled": true,
    "bingApiKey": "你的Bing-API-Key",
    "bingDailyQuota": 100,
    "bingPriority": "newest",
    "interval": 6,
    "enabled": true
  }'
```

### 配置参数说明

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `sitemapUrl` | ✅ | - | Sitemap XML 地址 |
| `apiKey` | ✅ | - | IndexNow API Key (32位十六进制) |
| `name` | - | 从域名提取 | 网站显示名称 |
| `id` | - | 域名 | 网站唯一标识 |
| `enabled` | - | true | 是否启用 |
| `interval` | - | 6 | 执行间隔（小时） |
| `bingEnabled` | - | false | 是否启用 Bing 提交 |
| `bingApiKey` | - | - | Bing Webmaster API Key |
| `bingDailyQuota` | - | 100 | Bing 每日配额限制 |
| `bingPriority` | - | newest | 优先策略: `newest`(最新优先) / `random`(随机) |
| `cacheTtlDays` | - | 30 | URL 缓存天数 |
| `maxRetries` | - | 3 | 失败重试次数 |

### 查看所有网站

```bash
curl "https://your-worker.workers.dev/api/sites"
```

### 查看单个网站

```bash
curl "https://your-worker.workers.dev/api/sites/example.com"
```

### 更新网站配置

```bash
# 启用 Bing 提交
curl -X PUT "https://your-worker.workers.dev/api/sites/example.com" \
  -H "Content-Type: application/json" \
  -d '{
    "bingEnabled": true,
    "bingApiKey": "你的Bing-API-Key",
    "bingDailyQuota": 10
  }'

# 修改执行间隔
curl -X PUT "https://your-worker.workers.dev/api/sites/example.com" \
  -H "Content-Type: application/json" \
  -d '{"interval": 12}'

# 禁用网站
curl -X PUT "https://your-worker.workers.dev/api/sites/example.com" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

### 删除网站

```bash
curl -X DELETE "https://your-worker.workers.dev/api/sites/example.com"
```

---

## 手动触发提交

### 触发指定网站（所有渠道）

```bash
curl "https://your-worker.workers.dev/trigger?site=example.com"
```

### 只触发 IndexNow

```bash
curl "https://your-worker.workers.dev/trigger?site=example.com&channel=indexnow"
```

### 只触发 Bing

```bash
curl "https://your-worker.workers.dev/trigger?site=example.com&channel=bing"
```

### 触发默认网站（单网站模式）

```bash
curl "https://your-worker.workers.dev/trigger"
```

---

## 状态查询

### 查看网站状态和最近执行

```bash
curl "https://your-worker.workers.dev/status?site=example.com"
```

响应示例：
```json
{
  "status": "running",
  "siteId": "example.com",
  "lastExecution": {
    "timestamp": "2025-11-27T01:42:22.386Z",
    "stats": {
      "total": 50,
      "successful": 50,
      "failed": 0
    },
    "bingStats": {
      "enabled": true,
      "submitted": 10,
      "successful": 10,
      "quotaUsed": 10,
      "quotaRemaining": 90
    }
  },
  "bingQuota": {
    "date": "2025-11-27",
    "used": 10,
    "limit": 100,
    "remaining": 90
  }
}
```

### 查看执行历史

```bash
curl "https://your-worker.workers.dev/history?site=example.com"
```

### 查看每日统计

```bash
# 最近 7 天
curl "https://your-worker.workers.dev/api/stats/daily?days=7"

# 指定网站
curl "https://your-worker.workers.dev/api/stats/daily?days=7&site=example.com"
```

### 总体统计

```bash
curl "https://your-worker.workers.dev/api/stats/summary"
```

### 健康检查

```bash
curl "https://your-worker.workers.dev/health"
```

---

## 部署方式详解

### 方式1: npm 脚本部署（推荐）

```bash
# 安装依赖
npm install

# 部署
npm run deploy
```

### 方式2: Wrangler CLI 直接部署

```bash
# 首次部署
wrangler deploy

# 查看实时日志
wrangler tail

# 查看已部署的 Worker 列表
wrangler deployments list
```

### 方式3: GitHub Actions 自动部署

创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

需要在 GitHub 仓库 Settings → Secrets 中添加 `CLOUDFLARE_API_TOKEN`。

---

## Wrangler 常用命令

```bash
# 登录 Cloudflare
wrangler login

# 查看当前登录状态
wrangler whoami

# 创建 KV 命名空间
wrangler kv:namespace create "CACHE"

# 列出所有 KV 命名空间
wrangler kv:namespace list

# 查看 KV 中的数据
wrangler kv:key list --namespace-id=<your-namespace-id>
wrangler kv:key get --namespace-id=<your-namespace-id> "sites:list"

# 部署 Worker
wrangler deploy

# 查看实时日志
wrangler tail

# 删除 Worker
wrangler delete
```

---

## 项目结构

```
indexnow-worker/
├── src/
│   ├── index.ts                  # Worker 入口，路由处理
│   ├── types/
│   │   └── index.ts              # TypeScript 类型定义
│   ├── modules/
│   │   ├── config.ts             # 配置加载
│   │   ├── scheduler.ts          # 调度器（核心逻辑）
│   │   ├── sitemap-crawler.ts    # Sitemap 解析
│   │   ├── indexnow-submitter.ts # IndexNow 提交
│   │   ├── bing-submitter.ts     # Bing API 提交
│   │   ├── quota-manager.ts      # Bing 配额管理
│   │   ├── site-config-manager.ts # 网站配置管理
│   │   └── url-cache.ts          # URL 缓存去重
│   └── utils/
│       ├── logger.ts             # 日志工具
│       └── concurrency.ts        # 并发控制
├── wrangler.toml                 # Wrangler 配置（包含敏感信息，不提交）
├── wrangler.toml.example         # 配置示例（脱敏）
├── package.json
├── tsconfig.json
└── README.md
```

---

## 常见问题

### Q: IndexNow 提交后多久生效？

IndexNow 只是通知搜索引擎 URL 有更新，实际抓取时间取决于搜索引擎的调度，通常几小时到几天不等。

### Q: Bing 配额用完了怎么办？

配额会在每天 UTC 00:00（北京时间 08:00）重置。系统会自动跟踪配额使用情况，超出后当天不会继续提交。

### Q: 如何查看提交是否成功？

使用 `/status?site=yoursite.com` 查看最近一次执行状态，或 `/history?site=yoursite.com` 查看历史记录。

### Q: 支持哪些搜索引擎？

- **IndexNow 协议**: Bing、Yandex、Seznam.cz、Naver
- **Bing Webmaster API**: 仅 Bing
- **Google**: 目前不支持 IndexNow，建议使用 Google Search Console API

### Q: 如何更改 Cron 执行频率？

修改 `wrangler.toml` 中的 `crons` 配置，然后重新部署：

```toml
[triggers]
crons = ["0 */4 * * *"]  # 每 4 小时
# 或
crons = ["0 0 * * *"]    # 每天 0 点
# 或
crons = ["0 */2 * * *"]  # 每 2 小时
```

### Q: 如何处理大型 sitemap？

如果 sitemap 包含上万个 URL：
1. 使用 sitemap index 分割成多个小 sitemap
2. 系统支持自动解析 sitemap index
3. 每次只提交新增/更新的 URL（通过缓存去重）

---

## 性能特性

- **并发控制**: 最多 3 个并发请求
- **限流保护**: 请求间隔 100ms
- **智能重试**: 失败自动重试 3 次，指数退避
- **URL 去重**: KV 缓存，避免重复提交（默认 30 天）
- **进度保存**: 支持断点续传

---

## License

MIT License
