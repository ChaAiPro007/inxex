#!/bin/bash

# IndexNow Worker 部署脚本
# 自动化部署流程

set -e

echo "🚀 IndexNow Worker 部署脚本"
echo "================================"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误：未找到 Node.js"
    echo "请安装 Node.js >= 18.x: https://nodejs.org/"
    exit 1
fi

echo "✓ Node.js 版本: $(node --version)"

# 检查 Wrangler
if ! command -v wrangler &> /dev/null; then
    echo "⚠️  未找到 Wrangler CLI"
    echo "正在安装 Wrangler..."
    npm install -g wrangler
fi

echo "✓ Wrangler 版本: $(wrangler --version)"
echo ""

# 安装依赖
echo "📦 安装项目依赖..."
npm install
echo "✓ 依赖安装完成"
echo ""

# 检查登录状态
echo "🔐 检查 Cloudflare 登录状态..."
if ! wrangler whoami &> /dev/null; then
    echo "未登录，正在打开浏览器进行授权..."
    wrangler login
else
    echo "✓ 已登录 Cloudflare"
fi
echo ""

# 类型检查
echo "🔍 TypeScript 类型检查..."
npm run type-check
echo "✓ 类型检查通过"
echo ""

# 部署提示
echo "⚠️  部署前检查清单："
echo ""
echo "1. 确认 wrangler.toml 中的 account_id 已填写"
echo "2. 确认 KV 命名空间已创建并配置"
echo "3. 确认 API 密钥已上传到网站根目录"
echo "4. 确认 INDEXNOW_API_KEY 密钥已配置"
echo ""

read -p "以上检查是否全部完成？(y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "请完成检查后重新运行此脚本"
    echo ""
    echo "快速设置命令："
    echo "  # 创建 KV 命名空间"
    echo "  wrangler kv:namespace create \"CACHE\""
    echo ""
    echo "  # 配置 API 密钥"
    echo "  wrangler secret put INDEXNOW_API_KEY"
    echo ""
    exit 1
fi

# 部署
echo ""
echo "🚀 开始部署到 Cloudflare Workers..."
wrangler deploy

echo ""
echo "✅ 部署完成！"
echo ""
echo "📊 验证部署："
echo "  wrangler tail            # 查看实时日志"
echo "  curl <worker-url>/health # 健康检查"
echo "  curl <worker-url>/config # 查看配置"
echo "  curl <worker-url>/trigger # 手动触发"
echo ""
echo "📚 更多信息请查看 DEPLOYMENT.md"
