#!/bin/bash

# 加密货币监控平台部署脚本

set -e

echo "🚀 开始部署加密货币监控平台..."

# 1. 安装依赖
echo "📦 安装依赖..."
npm ci

# 2. 构建项目
echo "🔨 构建项目..."
npm run build

# 3. 创建数据目录
echo "📁 创建数据目录..."
mkdir -p data

# 4. 检查环境变量
if [ ! -f .env ]; then
    echo "⚠️  .env 文件不存在，从示例创建..."
    cp .env.example .env
    echo "❗ 请编辑 .env 文件配置你的参数"
    exit 1
fi

# 5. 使用 PM2 管理进程
if ! command -v pm2 &> /dev/null; then
    echo "📥 安装 PM2..."
    npm install -g pm2
fi

# 6. 停止旧进程
echo "⏹️  停止旧进程..."
pm2 delete crypto-monitor 2>/dev/null || true

# 7. 启动服务
echo "▶️  启动服务..."
pm2 start dist/server.js --name crypto-monitor

# 8. 保存 PM2 配置
pm2 save

# 9. 设置开机自启
pm2 startup

echo "✅ 部署完成！"
echo ""
echo "📊 查看状态: pm2 status"
echo "📝 查看日志: pm2 logs crypto-monitor"
echo "🔄 重启服务: pm2 restart crypto-monitor"
echo "⏹️  停止服务: pm2 stop crypto-monitor"
