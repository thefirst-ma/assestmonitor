#!/bin/bash

# Debian 服务器 Docker 部署脚本
# 用途：在 Debian 服务器上部署加密货币监控平台

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   加密货币监控平台 - Docker 部署      ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""

# 检查是否为 root 用户
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}⚠️  建议使用 sudo 运行此脚本${NC}"
fi

# 1. 检查并安装 Docker
check_docker() {
    if ! command -v docker &> /dev/null; then
        echo -e "${YELLOW}📦 Docker 未安装，开始安装...${NC}"

        # 更新包索引
        sudo apt-get update

        # 安装依赖
        sudo apt-get install -y \
            ca-certificates \
            curl \
            gnupg \
            lsb-release

        # 添加 Docker 官方 GPG 密钥
        sudo mkdir -p /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

        # 设置 Docker 仓库
        echo \
          "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
          $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

        # 安装 Docker Engine
        sudo apt-get update
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

        # 启动 Docker
        sudo systemctl start docker
        sudo systemctl enable docker

        # 将当前用户添加到 docker 组
        sudo usermod -aG docker $USER

        echo -e "${GREEN}✅ Docker 安装完成${NC}"
    else
        echo -e "${GREEN}✅ Docker 已安装${NC}"
    fi
}

# 2. 检查 Docker Compose
check_docker_compose() {
    if ! docker compose version &> /dev/null; then
        echo -e "${RED}❌ Docker Compose 未安装${NC}"
        exit 1
    else
        echo -e "${GREEN}✅ Docker Compose 已安装${NC}"
    fi
}

# 3. 检查环境变量文件
check_env() {
    if [ ! -f .env ]; then
        echo -e "${YELLOW}⚠️  .env 文件不存在，从示例创建...${NC}"
        if [ -f .env.example ]; then
            cp .env.example .env
            echo -e "${YELLOW}❗ 请编辑 .env 文件配置你的参数：${NC}"
            echo -e "${YELLOW}   nano .env${NC}"
            echo ""
            read -p "配置完成后按回车继续..."
        else
            echo -e "${RED}❌ .env.example 文件不存在${NC}"
            exit 1
        fi
    else
        echo -e "${GREEN}✅ .env 文件已存在${NC}"
    fi
}

# 4. 创建必要的目录
create_directories() {
    echo -e "${GREEN}📁 创建数据目录...${NC}"
    mkdir -p data
    mkdir -p logs
    chmod 755 data logs
}

# 5. 构建并启动容器
deploy() {
    echo -e "${GREEN}🔨 构建 Docker 镜像...${NC}"
    docker compose build

    echo -e "${GREEN}🚀 启动容器...${NC}"
    docker compose up -d

    echo -e "${GREEN}⏳ 等待服务启动...${NC}"
    sleep 5

    # 检查容器状态
    if docker compose ps | grep -q "Up"; then
        echo -e "${GREEN}✅ 部署成功！${NC}"
        echo ""
        echo -e "${GREEN}📊 服务信息：${NC}"
        echo -e "   Web 界面: http://your-server-ip:3001"
        echo -e "   数据目录: $(pwd)/data"
        echo ""
        echo -e "${GREEN}📝 常用命令：${NC}"
        echo -e "   查看日志: docker compose logs -f"
        echo -e "   重启服务: docker compose restart"
        echo -e "   停止服务: docker compose down"
        echo -e "   查看状态: docker compose ps"
    else
        echo -e "${RED}❌ 部署失败，请查看日志：${NC}"
        docker compose logs
        exit 1
    fi
}

# 主流程
main() {
    check_docker
    check_docker_compose
    check_env
    create_directories
    deploy
}

# 运行主流程
main
