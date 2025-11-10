# Sitemap 爬虫规范增量

## ADDED Requirements

### Requirement: Sitemap XML 获取

系统 SHALL 能够通过 HTTP/HTTPS 协议获取网站地图 XML 文件。

#### Scenario: 成功获取标准 sitemap.xml

- **WHEN** 系统向有效的 sitemap URL 发起 HTTP GET 请求
- **THEN** 系统应成功接收响应（HTTP 200）
- **AND** 响应内容应为有效的 XML 格式

#### Scenario: 处理重定向

- **WHEN** sitemap URL 返回 HTTP 301/302 重定向
- **THEN** 系统应自动跟随重定向（最多 3 次）
- **AND** 最终获取到有效的 XML 内容

#### Scenario: 处理超时

- **WHEN** HTTP 请求超过 30 秒未响应
- **THEN** 系统应中止请求并记录超时错误
- **AND** 系统应根据重试策略决定是否重试

#### Scenario: 处理网络错误

- **WHEN** 网络连接失败或 DNS 解析失败
- **THEN** 系统应记录详细的错误信息
- **AND** 系统应重试最多 3 次，间隔 2 秒

### Requirement: Sitemap XML 解析

系统 SHALL 能够解析标准 XML 格式的网站地图文件并提取 URL 列表。

#### Scenario: 解析标准 sitemap.xml

- **WHEN** 系统接收到包含 `<urlset>` 根元素的 XML
- **THEN** 系统应提取所有 `<url><loc>` 标签中的 URL
- **AND** 返回的 URL 列表应去除重复项

#### Scenario: 解析 sitemap 索引文件

- **WHEN** 系统接收到包含 `<sitemapindex>` 根元素的 XML
- **THEN** 系统应提取所有 `<sitemap><loc>` 标签中的子 sitemap URL
- **AND** 系统应递归获取每个子 sitemap 并解析其中的 URL

#### Scenario: 处理无效 XML

- **WHEN** XML 格式错误或不符合 sitemap 规范
- **THEN** 系统应记录解析错误
- **AND** 系统应尝试降级处理（提取所有可识别的 URL）
- **AND** 如果无法提取任何 URL，则跳过本次执行

#### Scenario: 处理空 sitemap

- **WHEN** sitemap.xml 中没有任何 URL
- **THEN** 系统应记录警告日志
- **AND** 返回空的 URL 列表
- **AND** 不触发任何提交操作

### Requirement: 性能优化

系统 SHALL 在 Cloudflare Workers 的 CPU 时间限制内高效处理大型网站地图。

#### Scenario: 处理大型 sitemap（10,000+ URLs）

- **WHEN** sitemap.xml 包含超过 10,000 个 URL
- **THEN** 系统应使用流式解析避免内存溢出
- **AND** 单次执行的 CPU 时间应小于 50ms
- **AND** 如果超过限制，应将任务拆分为多个批次

#### Scenario: 限制 sitemap 大小

- **WHEN** sitemap.xml 文件大小超过 50MB
- **THEN** 系统应中止下载并记录错误
- **AND** 建议用户优化 sitemap 或使用 sitemap 索引文件

#### Scenario: 并发处理子 sitemap

- **WHEN** sitemap 索引文件包含多个子 sitemap
- **THEN** 系统应顺序处理每个子 sitemap（避免并发资源消耗）
- **AND** 每个子 sitemap 的处理应独立记录日志

### Requirement: 错误处理和日志

系统 SHALL 提供完整的错误处理和详细的日志记录。

#### Scenario: 记录成功执行

- **WHEN** sitemap 成功获取并解析
- **THEN** 系统应记录 INFO 级别日志
- **AND** 日志应包含：URL 数量、处理时间、提取的 URL 总数

#### Scenario: 记录警告

- **WHEN** 遇到可恢复的错误（如部分 URL 无效）
- **THEN** 系统应记录 WARN 级别日志
- **AND** 继续处理剩余的有效 URL

#### Scenario: 记录错误

- **WHEN** 遇到不可恢复的错误（如网络失败、XML 格式错误）
- **THEN** 系统应记录 ERROR 级别日志
- **AND** 日志应包含：错误类型、错误消息、堆栈跟踪（如果适用）
