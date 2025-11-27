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

---

## AI 自动部署指南

本项目支持 AI 助手（如 Claude Code）全自动部署。按以下步骤执行命令即可完成部署。

### 前置条件

确保已安装 Wrangler CLI 并登录：

```bash
# 检查 wrangler 是否安装
wrangler --version

# 如未安装，执行：
npm install -g wrangler

# 登录 Cloudflare（会打开浏览器授权）
wrangler login

# 验证登录状态
wrangler whoami
```

### 一键自动部署流程

#### 步骤 1: 安装项目依赖

```bash
npm install
```

#### 步骤 2: 获取 Cloudflare Account ID

```bash
# 执行此命令获取 account_id
wrangler whoami
```

输出示例：
```
⛅️ wrangler 3.x.x
👋 You are logged in with an OAuth Token, associated with the email xxx@example.com!
┌─────────────────────────────────┬──────────────────────────────────┐
│ Account Name                    │ Account ID                       │
├─────────────────────────────────┼──────────────────────────────────┤
│ Your Account Name               │ abcd1234567890abcd1234567890abcd │
└─────────────────────────────────┴──────────────────────────────────┘
```

**提取 Account ID**: `abcd1234567890abcd1234567890abcd`

#### 步骤 3: 创建 KV 命名空间

```bash
# 创建 KV 命名空间
wrangler kv:namespace create "CACHE"
```

输出示例：
```
🌀 Creating namespace with title "indexnow-worker-CACHE"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "CACHE", id = "xxxx1234567890xxxx1234567890xxxx" }
```

**提取 KV Namespace ID**: `xxxx1234567890xxxx1234567890xxxx`

#### 步骤 4: 创建 wrangler.toml 配置文件

```bash
# 复制示例配置
cp wrangler.toml.example wrangler.toml
```

然后更新 `wrangler.toml` 文件，替换以下占位符：

```toml
name = "indexnow-worker"
main = "src/index.ts"
compatibility_date = "2024-01-10"

workers_dev = true
account_id = "<步骤2获取的ACCOUNT_ID>"

[[kv_namespaces]]
binding = "CACHE"
id = "<步骤3获取的KV_NAMESPACE_ID>"

[triggers]
crons = ["0 */6 * * *"]
```

**AI 自动更新命令**（使用 sed）：

```bash
# 替换 account_id
sed -i '' 's/account_id = ".*"/account_id = "你的ACCOUNT_ID"/' wrangler.toml

# 替换 KV namespace id
sed -i '' 's/id = ".*"/id = "你的KV_ID"/' wrangler.toml
```

#### 步骤 5: 部署 Worker

```bash
wrangler deploy
```

输出示例：
```
⛅️ wrangler 3.x.x
Total Upload: xx.xx KiB / gzip: xx.xx KiB
Uploaded indexnow-worker (x.xx sec)
Published indexnow-worker (x.xx sec)
  https://indexnow-worker.your-subdomain.workers.dev
  schedule: 0 */6 * * *
Current Deployment ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**Worker URL**: `https://indexnow-worker.your-subdomain.workers.dev`

#### 步骤 6: 验证部署

```bash
# 健康检查
curl "https://indexnow-worker.your-subdomain.workers.dev/health"
```

---

## 完整自动化脚本示例

AI 助手可以直接执行以下脚本完成部署：

```bash
#!/bin/bash
set -e

# 1. 安装依赖
npm install

# 2. 获取 account_id
ACCOUNT_ID=$(wrangler whoami 2>/dev/null | grep -oE '[a-f0-9]{32}' | head -1)
echo "Account ID: $ACCOUNT_ID"

# 3. 创建 KV 命名空间并获取 ID
KV_OUTPUT=$(wrangler kv:namespace create "CACHE" 2>&1)
KV_ID=$(echo "$KV_OUTPUT" | grep -oE 'id = "[a-f0-9]{32}"' | grep -oE '[a-f0-9]{32}')
echo "KV Namespace ID: $KV_ID"

# 4. 生成 wrangler.toml
cat > wrangler.toml << EOF
name = "indexnow-worker"
main = "src/index.ts"
compatibility_date = "2024-01-10"

workers_dev = true
account_id = "$ACCOUNT_ID"

[[kv_namespaces]]
binding = "CACHE"
id = "$KV_ID"

[triggers]
crons = ["0 */6 * * *"]
EOF

echo "wrangler.toml 已生成"

# 5. 部署
wrangler deploy

echo "部署完成！"
```

---

## 部署后配置网站

### 生成 IndexNow API Key

```bash
# 命令行生成 32 位十六进制 Key
openssl rand -hex 16
# 示例输出: e1ab9d6410ff0f71c525faf0861dd87c
```

### 配置 IndexNow Key 验证文件

在网站根目录创建验证文件：

1. 文件名: `{API_KEY}.txt`（如 `e1ab9d6410ff0f71c525faf0861dd87c.txt`）
2. 文件内容: API Key 本身（如 `e1ab9d6410ff0f71c525faf0861dd87c`）
3. 确保可访问: `https://yoursite.com/e1ab9d6410ff0f71c525faf0861dd87c.txt`

### 获取 Bing Webmaster API Key

1. 访问 [Bing Webmaster Tools](https://www.bing.com/webmasters)
2. 点击 **左上角设置图标** ⚙️
3. 选择 **API 访问** → **API 密钥**
4. 复制 API Key

> **注意**: Bing API Key 是账户级别的，一个 Key 适用于该账户下所有已验证网站。

官方文档: [Bing URL Submission API](https://www.bing.com/webmasters/url-submission-api#APIs)

### 添加网站到系统

```bash
# 基础配置（仅 IndexNow）
curl -X POST "https://your-worker.workers.dev/api/sites" \
  -H "Content-Type: application/json" \
  -d '{
    "sitemapUrl": "https://example.com/sitemap.xml",
    "apiKey": "你的32位IndexNow-Key"
  }'

# 完整配置（含 Bing）
curl -X POST "https://your-worker.workers.dev/api/sites" \
  -H "Content-Type: application/json" \
  -d '{
    "sitemapUrl": "https://example.com/sitemap.xml",
    "apiKey": "你的32位IndexNow-Key",
    "bingEnabled": true,
    "bingApiKey": "你的Bing-API-Key",
    "bingDailyQuota": 100
  }'
```

---

## Wrangler 常用命令速查

```bash
# 登录/验证
wrangler login                    # 登录 Cloudflare
wrangler whoami                   # 查看账户信息和 Account ID

# KV 操作
wrangler kv:namespace create "CACHE"              # 创建 KV
wrangler kv:namespace list                        # 列出所有 KV
wrangler kv:key list --namespace-id=<KV_ID>       # 列出 KV 中的 keys
wrangler kv:key get --namespace-id=<KV_ID> "key"  # 获取指定 key 的值

# 部署操作
wrangler deploy                   # 部署 Worker
wrangler tail                     # 查看实时日志
wrangler deployments list         # 查看部署历史
wrangler delete                   # 删除 Worker
```

---

## API 接口参考

### 网站管理

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/sites` | 获取所有网站 |
| GET | `/api/sites/{id}` | 获取单个网站 |
| POST | `/api/sites` | 添加网站 |
| PUT | `/api/sites/{id}` | 更新网站配置 |
| DELETE | `/api/sites/{id}` | 删除网站 |

### 触发提交

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/trigger?site={id}` | 触发指定网站提交 |
| GET | `/trigger?site={id}&channel=indexnow` | 仅 IndexNow |
| GET | `/trigger?site={id}&channel=bing` | 仅 Bing |

### 状态查询

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/status?site={id}` | 网站状态 |
| GET | `/history?site={id}` | 执行历史 |
| GET | `/api/stats/daily?days=7` | 每日统计 |
| GET | `/api/stats/summary` | 总体统计 |

### 配置参数说明

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `sitemapUrl` | ✅ | - | Sitemap XML 地址 |
| `apiKey` | ✅ | - | IndexNow API Key (32位十六进制) |
| `name` | - | 从域名提取 | 网站显示名称 |
| `enabled` | - | true | 是否启用 |
| `interval` | - | 6 | 执行间隔（小时） |
| `bingEnabled` | - | false | 是否启用 Bing 提交 |
| `bingApiKey` | - | - | Bing Webmaster API Key |
| `bingDailyQuota` | - | 100 | Bing 每日配额限制 |
| `bingPriority` | - | newest | 优先策略: `newest`/`random` |

---

## Bing API 配额说明

| 网站类型 | 每日配额 | 说明 |
|---------|---------|------|
| 新网站 | 10 URL/天 | 刚验证的网站 |
| 普通网站 | 100 URL/天 | 已验证一段时间 |
| 高质量网站 | 更高 | 取决于网站信誉 |

**配额重置时间**: 每天 UTC 00:00（北京时间 08:00）

---

## 项目结构

```
indexnow-worker/
├── src/
│   ├── index.ts                  # Worker 入口
│   ├── types/index.ts            # TypeScript 类型
│   ├── modules/
│   │   ├── scheduler.ts          # 调度器
│   │   ├── sitemap-crawler.ts    # Sitemap 解析
│   │   ├── indexnow-submitter.ts # IndexNow 提交
│   │   ├── bing-submitter.ts     # Bing API 提交
│   │   ├── quota-manager.ts      # 配额管理
│   │   ├── site-config-manager.ts # 网站配置
│   │   └── url-cache.ts          # URL 缓存
│   └── utils/
│       ├── logger.ts             # 日志工具
│       └── concurrency.ts        # 并发控制
├── wrangler.toml.example         # 配置模板
├── package.json
└── README.md
```

---

## 常见问题

**Q: IndexNow 提交后多久生效？**
IndexNow 只是通知搜索引擎，实际抓取时间取决于搜索引擎调度，通常几小时到几天。

**Q: Bing 配额用完了怎么办？**
配额每天 UTC 00:00（北京时间 08:00）重置，系统会自动跟踪配额。

**Q: 支持哪些搜索引擎？**
- IndexNow: Bing、Yandex、Seznam.cz、Naver
- Bing API: 仅 Bing

---

## License

MIT License
