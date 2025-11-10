# 定时调度规范增量

## ADDED Requirements

### Requirement: Cron Trigger 配置

系统 SHALL 支持通过 Cloudflare Workers Cron Triggers 实现定时执行。

#### Scenario: 每日定时执行

- **WHEN** Cron 表达式配置为 `"0 0 * * *"`（每天 UTC 00:00）
- **THEN** 系统应在每天 UTC 00:00 自动触发执行
- **AND** 执行应在 Cloudflare Workers 运行时环境中进行

#### Scenario: 自定义调度时间

- **WHEN** 用户配置自定义 Cron 表达式（例如 `"0 */6 * * *"` 每 6 小时一次）
- **THEN** 系统应按照自定义时间表执行
- **AND** 支持标准 Cron 语法（分钟、小时、日、月、星期）

#### Scenario: 验证 Cron 表达式

- **WHEN** 系统加载 Cron 配置
- **THEN** 系统应验证 Cron 表达式的有效性
- **AND** 如果表达式无效，应记录错误并使用默认值（`"0 0 * * *"`）

### Requirement: 任务执行流程

系统 SHALL 实现完整的任务执行流程，包括初始化、执行、清理。

#### Scenario: 正常执行流程

- **WHEN** Cron Trigger 触发执行
- **THEN** 系统应按以下顺序执行：
  1. 加载配置（从环境变量）
  2. 初始化 Sitemap 爬虫
  3. 获取并解析 sitemap
  4. 去重（查询 KV 缓存）
  5. 批量提交到 IndexNow
  6. 更新缓存（写入 KV）
  7. 记录执行日志
- **AND** 整个流程应在 10 分钟内完成

#### Scenario: 执行超时

- **WHEN** 单次执行超过 10 分钟
- **THEN** 系统应中止当前执行
- **AND** 记录超时错误
- **AND** 等待下次 Cron 触发重新执行

#### Scenario: 并发执行防护

- **WHEN** 上一次执行尚未完成时，Cron 再次触发
- **THEN** 系统应检测到正在执行的任务
- **AND** 跳过本次触发，记录警告日志
- **AND** 使用 KV 锁机制防止并发执行

### Requirement: 手动触发支持

系统 SHALL 支持通过 HTTP 请求手动触发任务执行。

#### Scenario: 手动触发端点

- **WHEN** 用户向 `/trigger` 端点发送 GET 请求
- **THEN** 系统应立即执行一次任务
- **AND** 返回执行结果（JSON 格式）
- **AND** 手动触发应与 Cron 触发共享相同的执行逻辑

#### Scenario: 身份验证

- **WHEN** 用户访问 `/trigger` 端点
- **THEN** 系统应验证请求头中的 API 密钥（可选，通过环境变量配置）
- **AND** 如果配置了身份验证，未授权请求应返回 HTTP 401
- **AND** 如果未配置身份验证，任何人都可以触发

#### Scenario: 限流保护

- **WHEN** 短时间内收到多次手动触发请求
- **THEN** 系统应限制触发频率（例如：每 5 分钟最多 1 次）
- **AND** 超出限制的请求应返回 HTTP 429 Too Many Requests
- **AND** 使用 KV 存储记录最后触发时间

### Requirement: 执行日志记录

系统 SHALL 记录详细的执行日志，包括成功和失败信息。

#### Scenario: 记录执行开始

- **WHEN** 任务开始执行
- **THEN** 系统应记录：执行时间戳、触发方式（Cron 或手动）
- **AND** 记录配置摘要（sitemap URL、搜索引擎列表）

#### Scenario: 记录执行结果

- **WHEN** 任务执行完成
- **THEN** 系统应记录：
  - 总 URL 数量
  - 新 URL 数量（未在缓存中）
  - 缓存命中数量
  - 成功提交数量
  - 失败提交数量
  - 执行耗时
- **AND** 日志应为结构化格式（JSON）便于解析

#### Scenario: 记录错误

- **WHEN** 任务执行过程中发生错误
- **THEN** 系统应记录：错误类型、错误消息、堆栈跟踪
- **AND** 错误日志应包含上下文信息（例如：当前处理的 URL）
- **AND** 关键错误应发送告警（如果配置了 Webhook）

### Requirement: 状态查询

系统 SHALL 提供状态查询接口，便于监控和调试。

#### Scenario: 查询最近执行状态

- **WHEN** 用户访问 `/status` 端点
- **THEN** 系统应返回最近一次执行的状态（JSON 格式）
- **AND** 包含：执行时间、执行结果、处理 URL 数量、错误信息（如果有）

#### Scenario: 查询配置信息

- **WHEN** 用户访问 `/config` 端点
- **THEN** 系统应返回当前配置（JSON 格式）
- **AND** 敏感信息（如 API 密钥）应脱敏（仅显示前 4 位）
- **AND** 包含：sitemap URL、Cron 表达式、搜索引擎列表

#### Scenario: 健康检查

- **WHEN** 用户访问 `/health` 端点
- **THEN** 系统应返回 HTTP 200 OK
- **AND** 响应体包含：服务状态（running）、版本号、最后执行时间
