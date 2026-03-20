#!/bin/bash

# 投资标的监控平台 - 部署/更新脚本

set -e

cd /app/assestmonitor

echo "🚀 开始部署..."

# 拉取最新代码
echo "📥 拉取最新代码..."
git pull

# 安装依赖（有 node_modules 就跳过，加快更新速度）
if [ ! -d node_modules ]; then
    echo "📦 首次安装依赖..."
    npm ci
elif [ package.json -nt node_modules ]; then
    echo "📦 依赖有更新，重新安装..."
    npm ci
else
    echo "📦 依赖无变化，跳过安装"
fi

# 构建
echo "🔨 构建项目..."
npm run build

# 创建数据目录
mkdir -p data

# 检查 .env
if [ ! -f .env ]; then
    cp .env.example .env
    echo "⚠️  已创建 .env，请编辑配置后重新运行: nano .env"
    exit 1
fi

# 安装 PM2
if ! command -v pm2 &> /dev/null; then
    echo "📥 安装 PM2..."
    npm install -g pm2
fi

# 启动或重启
if pm2 describe crypto-monitor > /dev/null 2>&1; then
    echo "🔄 重启服务..."
    pm2 restart crypto-monitor
else
    echo "▶️  首次启动..."
    pm2 start dist/server.js --name crypto-monitor
    pm2 save
    pm2 startup 2>/dev/null || true
fi

echo ""
echo "✅ 部署完成！"
pm2 status
echo ""
echo "📝 查看日志: pm2 logs crypto-monitor"
