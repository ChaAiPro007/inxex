# Cloudflare Worker 部署规范增量

## ADDED Requirements

### Requirement: Worker 项目配置

系统 SHALL 包含完整的 Cloudflare Workers 项目配置文件。

#### Scenario: wrangler.toml 配置

- **WHEN** 项目初始化
- **THEN** 应创建 `wrangler.toml` 配置文件
- **AND** 配置应包含：
  - `name`：Worker 名称
  - `main`：入口文件路径（`src/index.ts`）
  - `compatibility_date`：Workers 运行时版本
  - `account_id`：Cloudflare 账户 ID
- **AND** 配置应支持多环境（开发、生产）

#### Scenario: KV 命名空间绑定

- **WHEN** 配置 KV 存储
- **THEN** `wrangler.toml` 应包含 KV 绑定配置
- **AND** 绑定名称应为 `URL_CACHE`
- **AND** 应分别配置开发环境和生产环境的 KV 命名空间 ID

#### Scenario: Cron Triggers 配置

- **WHEN** 配置定时任务
- **THEN** `wrangler.toml` 应包含 `[triggers]` 配置
- **AND** 默认 Cron 表达式应为 `"0 0 * * *"`（每天 UTC 00:00）
- **AND** 支持通过环境变量覆盖 Cron 表达式

#### Scenario: 环境变量配置

- **WHEN** 配置敏感信息（API 密钥、站点 URL）
- **THEN** 应使用 Cloudflare Workers 环境变量
- **AND** 不应将敏感信息硬编码在代码或 wrangler.toml 中
- **AND** 应在 `wrangler.toml` 中使用 `[vars]` 配置非敏感变量

### Requirement: TypeScript 项目配置

系统 SHALL 使用 TypeScript 开发，提供类型安全和更好的开发体验。

#### Scenario: tsconfig.json 配置

- **WHEN** 项目初始化
- **THEN** 应创建 `tsconfig.json` 配置文件
- **AND** 应包含 Cloudflare Workers 类型定义（`@cloudflare/workers-types`）
- **AND** 编译目标应为 `ES2020` 或更高

#### Scenario: 类型定义

- **WHEN** 编写代码
- **THEN** 所有函数和变量应有明确的类型注解
- **AND** 应为环境变量定义接口（`Env`）
- **AND** 应为 KV 绑定定义类型

### Requirement: 依赖管理

系统 SHALL 使用 npm 或 pnpm 管理项目依赖。

#### Scenario: package.json 配置

- **WHEN** 项目初始化
- **THEN** 应创建 `package.json` 文件
- **AND** 应包含必要的开发依赖：
  - `wrangler`（Cloudflare Workers CLI）
  - `@cloudflare/workers-types`（TypeScript 类型定义）
  - `typescript`
- **AND** 应定义 npm 脚本：`dev`, `build`, `deploy`, `test`

#### Scenario: 依赖锁定

- **WHEN** 安装依赖
- **THEN** 应生成锁定文件（`package-lock.json` 或 `pnpm-lock.yaml`）
- **AND** 锁定文件应提交到版本控制
- **AND** 确保部署时使用相同版本的依赖

### Requirement: 本地开发环境

系统 SHALL 支持在本地开发和测试 Worker。

#### Scenario: 本地开发服务器

- **WHEN** 运行 `npm run dev`
- **THEN** 应启动 Wrangler 本地开发服务器
- **AND** 服务器应监听在 `localhost:8787`
- **AND** 代码修改应自动重载

#### Scenario: 本地 KV 模拟

- **WHEN** 在本地开发时访问 KV 存储
- **THEN** Wrangler 应自动创建本地 KV 实例
- **AND** 本地 KV 数据应独立于生产环境
- **AND** 本地 KV 数据应在重启后清除（或持久化到本地文件）

#### Scenario: 本地 Cron 测试

- **WHEN** 在本地开发时测试定时任务
- **THEN** 应提供手动触发接口（`/trigger` 端点）
- **AND** 或使用 `wrangler dev --local --test-scheduled` 模拟 Cron 触发

### Requirement: 部署流程

系统 SHALL 支持一键部署到 Cloudflare 边缘网络。

#### Scenario: 生产部署

- **WHEN** 运行 `npm run deploy`
- **THEN** Wrangler 应构建 TypeScript 代码
- **AND** 上传构建产物到 Cloudflare
- **AND** 自动配置 Cron Triggers 和 KV 绑定
- **AND** 返回部署成功确认和 Worker URL

#### Scenario: 环境隔离

- **WHEN** 部署到不同环境（开发、生产）
- **THEN** 应使用不同的环境变量配置
- **AND** 应使用不同的 KV 命名空间
- **AND** 生产环境应有独立的 API 密钥

#### Scenario: 部署验证

- **WHEN** 部署完成后
- **THEN** 应自动访问 `/health` 端点验证服务可用性
- **AND** 应验证 Cron Trigger 已正确配置
- **AND** 如果验证失败，应回滚到上一个版本

### Requirement: 监控和日志

系统 SHALL 集成 Cloudflare Workers 的监控和日志功能。

#### Scenario: 实时日志

- **WHEN** Worker 执行时
- **THEN** 日志应输出到 Cloudflare Workers 日志流
- **AND** 可通过 Wrangler CLI 实时查看：`wrangler tail`
- **AND** 日志应包含：时间戳、日志级别、消息内容

#### Scenario: 性能指标

- **WHEN** 查看 Worker 性能
- **THEN** Cloudflare Dashboard 应显示：
  - 请求总数
  - 错误率
  - CPU 时间使用
  - KV 读写次数
- **AND** 性能数据应保留至少 7 天

#### Scenario: 告警配置

- **WHEN** Worker 错误率超过 5%
- **THEN** 应触发告警通知（通过 Cloudflare 告警或自定义 Webhook）
- **AND** 告警应包含：错误原因、受影响的 URL 数量、时间范围

### Requirement: 安全配置

系统 SHALL 遵循安全最佳实践，保护敏感信息。

#### Scenario: API 密钥管理

- **WHEN** 配置 IndexNow API 密钥
- **THEN** 应使用 Cloudflare Workers 环境变量（加密存储）
- **AND** 不应在代码或日志中硬编码或输出完整密钥
- **AND** 生产环境和开发环境应使用不同的 API 密钥

#### Scenario: HTTPS 强制

- **WHEN** Worker 接收 HTTP 请求
- **THEN** 所有请求应通过 HTTPS（Cloudflare 默认行为）
- **AND** 不应允许降级到 HTTP

#### Scenario: CORS 配置

- **WHEN** Worker 提供 HTTP API（如 `/status`, `/config`）
- **THEN** 应配置适当的 CORS 策略
- **AND** 默认应拒绝跨域请求
- **AND** 如果需要允许特定域名，应在环境变量中配置

### Requirement: 版本管理

系统 SHALL 支持版本控制和回滚。

#### Scenario: 版本号标记

- **WHEN** 部署新版本
- **THEN** 应在 `package.json` 中更新版本号（语义化版本）
- **AND** 版本号应显示在 `/health` 端点的响应中
- **AND** Git 提交应打上对应的标签（如 `v1.0.0`）

#### Scenario: 回滚机制

- **WHEN** 新版本出现严重问题
- **THEN** 应能够快速回滚到上一个稳定版本
- **AND** 回滚应通过 `wrangler rollback` 命令执行
- **AND** 回滚后应验证服务恢复正常
