# IndexNow 提交验证指南

## 如何验证提交是否成功

### 方法 1: 查看实时日志

```bash
# 查看Worker实时日志
wrangler tail --format pretty
```

**关键日志指标**:
- `✓ Batch Success [200]` - 批量提交成功
- `Starting batch submission: X URLs to Y search engines` - 开始批量提交
- `All batches successful, caching all URLs...` - 全部成功并缓存
- `Successfully cached X URLs` - URL已保存到KV

### 方法 2: 查看执行状态 (推荐)

```bash
# 查看最近一次执行
curl https://your-worker.workers.dev/status | jq
```

**响应示例**:
```json
{
  "status": "running",
  "lastExecution": {
    "timestamp": "2025-11-10T07:59:23.530Z",
    "stats": {
      "total": 1,
      "successful": 1,
      "failed": 0,
      "skipped": 0,
      "duration": 948,
      "errors": []
    },
    "batches": [
      {
        "success": true,
        "statusCode": 200,
        "error": null
      }
    ]
  }
}
```

**状态说明**:
- `total`: 提交的URL总数
- `successful`: 成功提交的批次数
- `failed`: 失败的批次数
- `statusCode: 200`: IndexNow API 返回成功

### 方法 3: 查看执行历史

```bash
# 查看最近10次执行记录
curl https://your-worker.workers.dev/history | jq
```

**响应示例**:
```json
{
  "total": 2,
  "records": [
    {
      "timestamp": "2025-11-10T07:59:23.530Z",
      "stats": { /* 统计信息 */ },
      "batches": [ /* 批次详情 */ ]
    }
  ]
}
```

### 方法 4: 手动触发测试

```bash
# 手动触发一次提交
curl https://your-worker.workers.dev/trigger

# 响应示例
{
  "success": true,
  "message": "Execution completed",
  "stats": {
    "total": 3,
    "successful": 3,
    "failed": 0,
    "skipped": 0,
    "duration": 2758,
    "errors": []
  },
  "report": "=== Submission Report ===\n..."
}
```

## IndexNow API 响应码说明

| 状态码 | 含义 | 说明 |
|--------|------|------|
| 200 | OK | 提交成功，URL已接收 |
| 202 | Accepted | 已接受，异步处理中 |
| 400 | Bad Request | 请求格式错误 |
| 403 | Forbidden | API密钥验证失败 |
| 422 | Unprocessable Entity | URL格式无效 |
| 429 | Too Many Requests | 触发限流，60秒后重试 |
| 503 | Service Unavailable | 服务不可用 |

## 常见问题排查

### 1. 提交失败 (statusCode: 403)

**原因**: API密钥验证失败

**解决**:
```bash
# 检查密钥文件是否可访问
curl https://your-website.com/your-api-key.txt

# 应返回: your-api-key
```

### 2. 限流错误 (statusCode: 429)

**原因**: 请求过于频繁

**解决**: Worker会自动等待60秒后重试,无需手动处理

### 3. 0个新URL

**原因**: 所有URL都已缓存

**验证**:
```bash
# 查看KV缓存的URL数量
wrangler kv:key list --binding CACHE | grep "url:"
```

### 4. 批次部分失败

**原因**: 某些批次提交失败(网络超时、服务不可用等)

**处理**:
- 失败的URL不会被缓存
- 下次执行时会重新尝试提交
- 检查日志了解失败原因

## 监控建议

### 定期检查

```bash
# 每天查看一次执行历史
curl https://your-worker.workers.dev/history | \
  jq '.records[0] | {timestamp, total: .stats.total, success: .stats.successful}'

# 输出示例:
# {
#   "timestamp": "2025-11-10T07:59:23.530Z",
#   "total": 3,
#   "success": 3
# }
```

### Cloudflare Dashboard

访问: https://dash.cloudflare.com/

导航到: `Workers & Pages` → `indexnow-worker` → `Metrics`

**查看指标**:
- 请求总数
- 错误率
- CPU使用时间
- KV读写次数

## 验证提交效果

IndexNow 提交成功后,搜索引擎通常需要 **几小时到几天** 时间来抓取和索引。

**注意**:
- IndexNow 只是通知搜索引擎,不保证一定会索引
- 提交成功 ≠ 立即被搜索引擎收录
- 需要内容质量足够好才会被索引

## 自动化监控

可以配置告警邮件:

```bash
# 创建告警规则 (示例)
# 当失败率 > 10% 时发送邮件
# 访问 Cloudflare Dashboard 配置 Workers Alerts
```

## 支持的搜索引擎

当前配置的搜索引擎:
- api.indexnow.org (会自动同步到 Bing, Yandex 等)

可在 `wrangler.toml` 中添加更多:
```toml
# 未来可能支持:
# - www.bing.com/indexnow
# - yandex.com/indexnow
# - api.naver.com/indexnow (韩国)
```

---

**更新时间**: 2025-11-10
**Worker URL**: https://your-worker.workers.dev
**监控网站**: https://your-website.com
