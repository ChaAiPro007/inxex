# IndexNow 自动提交系统

自动采集网站地图（sitemap.xml）并每日提交到 IndexNow API，加速搜索引擎索引。通过 Cloudflare Workers 部署，零服务器成本。

## 🚀 快速开始

使用简化的 API 接口，快速添加你的网站。

### 1. 生成 IndexNow API 密钥

```bash
# 生成 32 位十六进制密钥
openssl rand -hex 16
# 示例输出: a1b2c3d4e5f6789012345678901234ab
```

### 2. 上传密钥文件到网站根目录

创建文件：`https://your-website.com/{your-api-key}.txt`

文件内容（纯文本）：
```
{your-api-key}
```

**重要**：确保文件可以通过 HTTPS 公开访问。

### 2. 安装依赖

```bash
npm install
```

### 3. 部署到 Cloudflare Workers

使用自动化部署脚本：

```bash
./deploy.sh
```

或手动部署：

```bash
# 登录 Cloudflare
wrangler login

# 创建 KV 命名空间
wrangler kv:namespace create "CACHE"
# 将返回的 id 填入 wrangler.toml

# 配置 API 密钥（可选，仅单网站模式需要）
wrangler secret put INDEXNOW_API_KEY
# 输入你生成的 API Key

# 部署
npm run deploy
```

详细部署步骤请查看 [DEPLOYMENT.md](./DEPLOYMENT.md)

## 📋 OpenSpec 变更提案

本项目使用 OpenSpec 规范进行开发管理。

### 查看提案

```bash
# 列出所有变更
openspec list

# 查看详细提案
openspec show add-automated-indexnow-submission

# 查看特定规范
openspec show sitemap-crawler --type spec
openspec show indexnow-submission --type spec
openspec show scheduler --type spec
openspec show cloudflare-worker --type spec
```

### 提案内容

当前提案包含 4 个核心能力模块：

1. **sitemap-crawler** - 网站地图采集和解析
2. **indexnow-submission** - IndexNow API GET 请求提交
3. **scheduler** - 定时调度和手动触发
4. **cloudflare-worker** - Cloudflare Workers 部署配置

详细文档位于：
- `openspec/changes/add-automated-indexnow-submission/proposal.md` - 提案概述
- `openspec/changes/add-automated-indexnow-submission/design.md` - 技术设计
- `openspec/changes/add-automated-indexnow-submission/tasks.md` - 实施任务清单

## 🔧 开发指南

### 实施步骤

按照 `tasks.md` 中的任务清单顺序实施：

1. **项目初始化**（任务 1.1-1.3）
   - 创建 TypeScript 项目
   - 配置 Cloudflare Workers
   - 设置开发环境

2. **核心功能实现**（任务 2.1-2.5）
   - Sitemap 爬虫模块
   - IndexNow 提交模块（GET 请求方式）
   - URL 缓存和去重
   - 定时调度器
   - 配置管理

3. **Workers 入口**（任务 3）
   - 实现 `fetch` 和 `scheduled` 处理器
   - 添加 `/trigger`, `/status`, `/health` 端点

4. **测试和文档**（任务 5-6）
   - 单元测试
   - 集成测试
   - 用户和开发文档

5. **部署发布**（任务 7）
   - 部署到 Cloudflare Workers
   - 验证定时任务
   - 性能优化

## 🎯 IndexNow API 使用

本系统使用 IndexNow GET 请求方式：

```
GET https://api.indexnow.org/indexnow?url={encoded_url}&key={api_key}&keyLocation={encoded_key_location}
```

**必需参数**：
- `url`: 要提交的 URL（URL 编码）
- `key`: API 密钥
- `keyLocation`: 密钥文件位置 URL（URL 编码），格式为 `https://{SITE_HOST}/{API_KEY}.txt`

### 示例

```bash
# 提交单个 URL
curl "https://api.indexnow.org/indexnow?url=https%3A%2F%2Fexample.com%2Fpage1&key=YOUR_API_KEY&keyLocation=https%3A%2F%2Fexample.com%2FYOUR_API_KEY.txt"
```

### 响应状态码

- `200` - 提交成功
- `202` - 已接受（异步处理）
- `400` - 请求错误（URL 或 key 无效）
- `429` - 限流（请稍后重试）
- `503` - 服务不可用

## 📊 性能特性

- ✅ **并发控制**：最多 3 个并发请求（考虑 Cloudflare Workers 子请求限制）
- ✅ **限流保护**：每秒最多 10 个 URL（100ms 间隔）
- ✅ **智能重试**：失败自动重试 3 次，指数退避
- ✅ **URL 去重**：KV 存储缓存，避免重复提交（30 天 TTL）
- ✅ **进度保存**：超时自动保存进度，下次继续

## 🔐 安全配置

### API 密钥管理

1. **生成密钥**：使用 `openssl rand -hex 16`
2. **存储密钥**：使用 Cloudflare Workers 环境变量（加密）
3. **验证密钥**：将密钥文件上传到网站根目录
4. **保护密钥**：日志中仅显示前 4 位

### 部署时配置密钥

```bash
# 使用 Wrangler 设置加密的环境变量（仅单网站模式需要）
wrangler secret put INDEXNOW_API_KEY
# 然后输入你生成的密钥值
```

## 📈 监控和日志

### 查看执行状态

```bash
# 健康检查
curl https://your-worker.workers.dev/health

# 查看最近执行状态
curl https://your-worker.workers.dev/status

# 查看配置（敏感信息脱敏）
curl https://your-worker.workers.dev/config
```

### 实时日志

```bash
# 使用 Wrangler 查看实时日志
wrangler tail
```

### Cloudflare Dashboard

访问 Cloudflare Dashboard 查看：
- 请求总数和错误率
- CPU 时间使用
- KV 读写次数
- 性能指标

## 🛠️ 故障排查

### 常见问题

1. **API 密钥无效**
   - 确认密钥文件已上传到网站根目录
   - 验证文件 URL 可访问：`https://your-website.com/{api_key}.txt`

2. **限流错误（HTTP 429）**
   - 降低 `REQUEST_INTERVAL_MS`（增加间隔）
   - 减少 `MAX_CONCURRENT_REQUESTS`

3. **超时错误**
   - 优化 sitemap（减少 URL 数量）
   - 使用 sitemap 索引文件分割大型 sitemap
   - 增加 Cron 执行频率

4. **KV 读写限制**
   - 检查 Cloudflare KV 配额使用情况
   - 增加 `CACHE_TTL_DAYS` 减少写入频率

## 📚 相关资源

- [IndexNow 官方文档](https://www.indexnow.org/)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [OpenSpec 规范](https://github.com/openspec-dev/openspec)

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
