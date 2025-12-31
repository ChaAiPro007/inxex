# 外链提交 API 实现任务

## 1. 类型定义
- [ ] 1.1 定义 `ExternalUrlSubmission` 请求类型
- [ ] 1.2 定义 `ExternalUrlSubmissionResult` 响应类型
- [ ] 1.3 定义 `UrlValidationResult` 验证结果类型

## 2. 核心模块开发
- [ ] 2.1 创建 `src/modules/external-url-handler.ts` 模块
- [ ] 2.2 实现 URL 格式验证器（支持 http/https，检查域名有效性）
- [ ] 2.3 实现 URL 去重逻辑（查询 URL 缓存）
- [ ] 2.4 实现批量提交处理器（复用 IndexNowSubmitter）

## 3. API 路由集成
- [ ] 3.1 添加 `POST /api/urls/submit` 路由
- [ ] 3.2 添加 `POST /api/urls/submit/:siteId` 路由
- [ ] 3.3 实现请求参数验证
- [ ] 3.4 实现响应格式化

## 4. 安全与限制
- [ ] 4.1 实现速率限制（基于 IP 或 API Key）
- [ ] 4.2 实现单次请求 URL 数量限制（最大 1000）
- [ ] 4.3 添加 URL 域名白名单校验（可选）

## 5. 历史记录与统计
- [ ] 5.1 记录外链提交历史到 KV
- [ ] 5.2 扩展 `/api/stats/daily` 包含外链提交统计
- [ ] 5.3 添加 `GET /api/urls/history` 查询端点

## 6. 测试
- [ ] 6.1 编写单元测试（URL 验证、去重逻辑）
- [ ] 6.2 编写集成测试（API 端点）
- [ ] 6.3 编写边界条件测试（空数组、超大批量、无效 URL）

## 7. 文档
- [ ] 7.1 更新 CLAUDE.md API 端点表格
- [ ] 7.2 添加 API 使用示例
