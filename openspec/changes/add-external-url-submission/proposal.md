# 外链提交 API 变更提案

## Why

当前系统仅支持从 sitemap.xml 自动爬取 URL 并提交到 IndexNow。在实际使用场景中，用户需要：
1. 手动提交不在 sitemap 中的 URL（如动态生成的页面、临时活动页面）
2. 实时提交新发布的内容，无需等待 sitemap 更新
3. 批量提交外部链接或合作伙伴页面
4. 集成到 CMS 或 CI/CD 流程中，实现发布即索引

## What Changes

- **新增** `/api/urls/submit` POST 端点，支持批量提交 URL 列表
- **新增** `/api/urls/submit/:siteId` POST 端点，针对特定站点提交
- **新增** URL 格式验证和去重逻辑
- **新增** 提交历史记录存储（复用现有 KV 结构）
- **新增** 速率限制保护（防止滥用）

## Impact

- Affected specs: 新增 `external-url-submission` 能力
- Affected code:
  - `src/index.ts` - 添加新路由处理
  - `src/modules/` - 新增 external-url-handler 模块
  - `src/types/index.ts` - 添加新类型定义
- 不影响现有 sitemap 爬取流程，两种提交方式独立运行
