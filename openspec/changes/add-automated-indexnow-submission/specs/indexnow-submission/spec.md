# IndexNow 提交规范增量

## ADDED Requirements

### Requirement: IndexNow API GET 请求构建

系统 SHALL 能够使用 GET 请求方式提交 URL 到 IndexNow API。

#### Scenario: 构建 GET 请求 URL

- **WHEN** 系统准备提交单个 URL 到 IndexNow
- **THEN** 系统应构建 GET 请求到 `https://api.indexnow.org/indexnow`
- **AND** URL 参数应包含：`url`（经过 URL 编码的目标 URL）、`key`（API 密钥）、`keyLocation`（密钥文件位置）
- **AND** 完整请求格式为：`https://api.indexnow.org/indexnow?url={encoded_url}&key={api_key}&keyLocation={encoded_key_location}`

#### Scenario: URL 编码

- **WHEN** 构建请求 URL
- **THEN** 目标 URL 应使用 encodeURIComponent 进行编码
- **AND** 确保特殊字符（如 `/`, `?`, `&`, `=`）被正确编码
- **AND** 例如：`https://example.com/page?id=1` 应编码为 `https%3A%2F%2Fexample.com%2Fpage%3Fid%3D1`

#### Scenario: keyLocation 参数构建

- **WHEN** 构建 GET 请求 URL
- **THEN** 系统应自动生成 keyLocation 参数
- **AND** keyLocation 格式应为：`https://{SITE_HOST}/{API_KEY}.txt`
- **AND** 例如：站点 `example.com`，密钥 `abc123`，则 keyLocation 为 `https://example.com/abc123.txt`
- **AND** keyLocation 也需要使用 encodeURIComponent 进行 URL 编码

#### Scenario: 密钥文件验证

- **WHEN** IndexNow API 收到提交请求
- **THEN** 搜索引擎会访问 keyLocation 指定的 URL
- **AND** 验证文件内容是否与 key 参数一致
- **AND** 如果验证失败，返回 HTTP 403 错误
- **AND** 系统应在部署前确保密钥文件已正确上传到网站根目录

#### Scenario: 验证 API 密钥

- **WHEN** 系统初始化 IndexNow 客户端
- **THEN** 系统应验证 API 密钥格式（非空字符串，长度至少 8 位）
- **AND** API 密钥应存储在环境变量中
- **AND** 不应在日志中输出完整的 API 密钥（仅显示前 4 位）

#### Scenario: 支持多个搜索引擎

- **WHEN** 配置中包含多个搜索引擎端点
- **THEN** 系统应向每个端点发送相同的 URL
- **AND** 每个端点的提交应独立处理
- **AND** 任何一个端点失败不应影响其他端点

### Requirement: 并发提交策略

系统 SHALL 实现高效的并发提交策略，平衡速度和 API 限流要求。

#### Scenario: 并发控制

- **WHEN** 系统提交多个 URL
- **THEN** 系统应使用并发池，最多同时发送 3 个请求
- **AND** 考虑 Cloudflare Workers 子请求限制（免费计划 6 个）
- **AND** 为多搜索引擎提交预留余地（例如：3 并发 × 2 搜索引擎 = 6 个子请求）
- **AND** 使用 Promise.allSettled 确保一个请求失败不影响其他请求
- **AND** 记录每个 URL 的提交状态（成功或失败）

#### Scenario: 请求间隔控制

- **WHEN** 系统连续发送请求
- **THEN** 每个请求之间应间隔至少 100 毫秒
- **AND** 即每秒最多提交 10 个 URL
- **AND** 避免触发 API 限流

#### Scenario: 大量 URL 处理

- **WHEN** URL 总数超过 1000 个
- **THEN** 系统应分批处理，每批 100 个
- **AND** 每批之间记录进度日志
- **AND** 如果总执行时间超过 5 分钟，保存进度并在下次继续

#### Scenario: 执行时间限制

- **WHEN** 单次执行超过 Cloudflare Workers 时间限制
- **THEN** 系统应优雅中止，保存已处理的 URL 到 KV
- **AND** 下次执行时从未处理的 URL 继续
- **AND** 记录警告日志，建议优化 sitemap 或增加执行频率

### Requirement: API 响应处理

系统 SHALL 正确处理 IndexNow API 的所有响应类型。

#### Scenario: 成功响应

- **WHEN** API 返回 HTTP 200 OK
- **THEN** 系统应记录成功日志
- **AND** 将成功提交的 URL 存入缓存（KV）
- **AND** 更新统计信息（已提交 URL 数量）

#### Scenario: 限流响应（HTTP 429）

- **WHEN** API 返回 HTTP 429 Too Many Requests
- **THEN** 系统应等待 60 秒后重试
- **AND** 最多重试 3 次
- **AND** 如果仍然失败，记录错误并跳过本批次

#### Scenario: 服务器错误（HTTP 5xx）

- **WHEN** API 返回 HTTP 500/502/503/504
- **THEN** 系统应使用指数退避重试（1s, 2s, 4s）
- **AND** 最多重试 3 次
- **AND** 如果全部失败，记录错误并继续处理下一批次

#### Scenario: 客户端错误（HTTP 4xx）

- **WHEN** API 返回 HTTP 400/401/403
- **THEN** 系统应记录详细的错误信息
- **AND** 不应重试（这些是客户端配置错误）
- **AND** 建议用户检查配置（API 密钥、URL 格式等）

### Requirement: 重试机制

系统 SHALL 实现智能的重试机制，提高提交成功率。

#### Scenario: 指数退避重试

- **WHEN** API 请求失败且可重试（网络错误、5xx 错误）
- **THEN** 系统应按指数退避策略重试
- **AND** 重试间隔应为：1 秒、2 秒、4 秒
- **AND** 最多重试 3 次

#### Scenario: 跟踪重试次数

- **WHEN** 系统执行重试
- **THEN** 系统应记录当前重试次数
- **AND** 在日志中注明"重试 X/3"
- **AND** 达到最大重试次数后停止重试

#### Scenario: 记录失败的 URL

- **WHEN** 某个批次的 URL 提交失败（所有重试都失败）
- **THEN** 系统应记录失败的 URL 列表
- **AND** 失败的 URL 不应存入缓存
- **AND** 下次执行时应优先提交这些失败的 URL

### Requirement: 日志和监控

系统 SHALL 记录详细的提交日志，便于调试和监控。

#### Scenario: 记录每批次提交

- **WHEN** 系统提交一个 URL 批次
- **THEN** 系统应记录：批次编号、URL 数量、目标搜索引擎
- **AND** 记录响应状态码和响应时间

#### Scenario: 统计汇总

- **WHEN** 所有批次提交完成
- **THEN** 系统应输出汇总统计
- **AND** 统计应包含：总 URL 数、成功数、失败数、平均响应时间
- **AND** 统计应按搜索引擎分别记录

#### Scenario: 错误告警

- **WHEN** 失败率超过 10%
- **THEN** 系统应记录 ERROR 级别日志
- **AND** 如果配置了 Webhook，应发送告警通知
- **AND** 告警应包含：失败原因、失败 URL 数量、建议操作
