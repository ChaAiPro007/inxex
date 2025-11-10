# 部署指南

IndexNow Worker 部署到 Cloudflare Workers 的完整步骤。

## 前置要求

1. **Cloudflare 账号**
   - 注册地址：https://dash.cloudflare.com/sign-up
   - 获取 Account ID（在 Dashboard 右侧）

2. **Node.js 环境**
   - Node.js >= 18.x
   - npm >= 9.x

3. **Wrangler CLI**
   ```bash
   npm install -g wrangler
   ```

4. **API 密钥文件**
   - 将 `your-api-key.txt` 上传到网站根目录
   - 文件内容：`your-api-key`（32位十六进制字符）
   - 确保可通过 `https://your-website.com/your-api-key.txt` 访问

## 步骤 1：安装依赖

```bash
cd /Users/yanyun/WebstormProjects/IndexNow
npm install
```

## 步骤 2：登录 Cloudflare

```bash
wrangler login
```

这将打开浏览器，授权 Wrangler 访问您的 Cloudflare 账号。

## 步骤 3：配置 wrangler.toml

编辑 `wrangler.toml`，填写您的 Account ID：

```toml
account_id = "your-account-id-here"
```

## 步骤 4：创建 KV 命名空间

### 生产环境

```bash
wrangler kv:namespace create "CACHE"
```

输出示例：
```
🌀 Creating namespace with title "indexnow-worker-CACHE"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "CACHE", id = "abc123..." }
```

将输出的 `id` 填入 `wrangler.toml` 的第一个 `kv_namespaces` 条目。

### 开发环境（可选）

```bash
wrangler kv:namespace create "CACHE" --preview
```

将输出的 `preview_id` 填入 `wrangler.toml` 的第二个 `kv_namespaces` 条目。

## 步骤 5：配置密钥

使用 Wrangler 添加 API 密钥（加密存储）：

```bash
wrangler secret put INDEXNOW_API_KEY
```

提示输入时，输入：
```
your-32-character-api-key-here
```

## 步骤 6：本地测试

```bash
npm run dev
```

访问 `http://localhost:8787` 测试：

- `/` - 欢迎页面
- `/health` - 健康检查
- `/config` - 配置信息
- `/trigger` - 手动触发（会实际提交到 IndexNow）

## 步骤 7：部署到 Cloudflare

```bash
npm run deploy
```

部署成功后，会显示 Worker URL：
```
Published indexnow-worker (1.23 sec)
  https://indexnow-worker.your-subdomain.workers.dev
```

## 步骤 8：验证部署

### 1. 健康检查

```bash
curl https://indexnow-worker.your-subdomain.workers.dev/health
```

预期输出：
```json
{
  "status": "healthy",
  "timestamp": "2025-01-10T12:00:00.000Z"
}
```

### 2. 查看配置

```bash
curl https://indexnow-worker.your-subdomain.workers.dev/config
```

预期输出：
```json
{
  "sitemapUrl": "https://your-website.com/sitemap.xml",
  "siteHost": "your-website.com",
  "apiKey": "your****",
  "maxConcurrentRequests": 3,
  "requestIntervalMs": 100,
  "cacheTtlDays": 30,
  "maxRetries": 3,
  "searchEngines": ["api.indexnow.org"]
}
```

### 3. 手动触发测试

```bash
curl https://indexnow-worker.your-subdomain.workers.dev/trigger
```

这将执行一次完整的采集和提交流程。

## 步骤 9：监控日志

### 实时日志

```bash
wrangler tail
```

### Cloudflare Dashboard

访问 https://dash.cloudflare.com
- 进入 Workers & Pages
- 选择 `indexnow-worker`
- 查看 Logs、Metrics 和 Analytics

## 定时任务

Worker 会按照配置的 Cron 表达式自动执行（默认每天 UTC 00:00）。

查看定时任务执行日志：
```bash
wrangler tail --format pretty
```

## 故障排查

### 问题 1：API 密钥验证失败

**症状**：HTTP 403 错误

**解决方案**：
1. 确认密钥文件已上传到网站根目录
2. 访问 `https://your-website.com/your-api-key.txt` 验证文件可访问
3. 检查文件内容是否为纯文本密钥（无多余空格或换行）

### 问题 2：KV 存储错误

**症状**：`Failed to connect to KV store`

**解决方案**：
1. 确认 KV 命名空间已创建
2. 检查 `wrangler.toml` 中的 `id` 是否正确
3. 重新部署：`wrangler deploy`

### 问题 3：sitemap 无法访问

**症状**：`Failed to fetch sitemap`

**解决方案**：
1. 确认 `SITEMAP_URL` 正确
2. 检查 sitemap 是否可公开访问
3. 验证 sitemap 格式是否为标准 XML

### 问题 4：超过 CPU 时间限制

**症状**：Worker 超时

**解决方案**：
1. 减少 `MAX_CONCURRENT_REQUESTS`（当前为 3）
2. 增加 `REQUEST_INTERVAL_MS`（当前为 100ms）
3. 分批处理大型 sitemap
4. 考虑升级到付费计划（50ms CPU 时间）

## 环境变量说明

所有环境变量在 `wrangler.toml` 的 `[vars]` 部分配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SITEMAP_URL` | - | 网站地图 URL（必填） |
| `SITE_HOST` | - | 站点域名（必填） |
| `MAX_CONCURRENT_REQUESTS` | 3 | 最大并发请求数 |
| `REQUEST_INTERVAL_MS` | 100 | 请求间隔（毫秒） |
| `CACHE_TTL_DAYS` | 30 | 缓存过期时间（天） |
| `MAX_RETRIES` | 3 | 失败重试次数 |
| `CRON_SCHEDULE` | 0 0 * * * | Cron 表达式 |

密钥使用 `wrangler secret put` 命令单独配置（加密存储）：
- `INDEXNOW_API_KEY`

## 成本估算

### 免费计划额度

**Cloudflare Workers**：
- 100,000 次请求/天
- 10ms CPU 时间/请求
- 6 个子请求/请求

**KV 存储**：
- 100,000 次读取/天
- 1,000 次写入/天
- 1 GB 存储空间

### 预估使用量示例

假设：
- Sitemap 包含 500 个 URL
- 每天新增 20 个 URL
- 每天执行 1 次定时任务

**每日消耗**：
- Workers 请求：1 次（定时任务）
- CPU 时间：约 5ms（sitemap 采集 + URL 处理）
- KV 读取：500 次（检查缓存）
- KV 写入：20 次（新 URL）
- IndexNow 请求：20 次（新 URL 提交）

**结论**：完全在免费额度内，无需付费。

## 升级到付费计划

如果需要更高性能或更大额度：

**Workers Paid** ($5/月)：
- 10,000,000 次请求/月
- 50ms CPU 时间/请求
- 更多子请求限制

**KV Paid**：
- $0.50 / 百万次读取
- $5.00 / 百万次写入
- $0.50 / GB 存储

## 支持

遇到问题？

1. 查看日志：`wrangler tail`
2. 检查配置：访问 `/config` 端点
3. 参考文档：https://developers.cloudflare.com/workers/
4. 提交 Issue：GitHub 项目仓库

---

部署完成后，系统将自动每天执行，无需手动干预。祝您使用愉快！
