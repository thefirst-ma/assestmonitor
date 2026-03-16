#!/bin/bash

# Docker 容器管理脚本

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

show_menu() {
    echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   Docker 容器管理菜单                  ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
    echo ""
    echo "1) 启动服务"
    echo "2) 停止服务"
    echo "3) 重启服务"
    echo "4) 查看状态"
    echo "5) 查看日志"
    echo "6) 实时日志"
    echo "7) 进入容器"
    echo "8) 重新构建"
    echo "9) 清理容器和镜像"
    echo "0) 退出"
    echo ""
}

start_service() {
    echo -e "${GREEN}🚀 启动服务...${NC}"
    docker compose up -d
    echo -e "${GREEN}✅ 服务已启动${NC}"
}

stop_service() {
    echo -e "${YELLOW}⏹️  停止服务...${NC}"
    docker compose down
    echo -e "${GREEN}✅ 服务已停止${NC}"
}

restart_service() {
    echo -e "${YELLOW}🔄 重启服务...${NC}"
    docker compose restart
    echo -e "${GREEN}✅ 服务已重启${NC}"
}

show_status() {
    echo -e "${GREEN}📊 容器状态：${NC}"
    docker compose ps
}

show_logs() {
    echo -e "${GREEN}📝 最近日志：${NC}"
    docker compose logs --tail=100
}

follow_logs() {
    echo -e "${GREEN}📝 实时日志（Ctrl+C 退出）：${NC}"
    docker compose logs -f
}

enter_container() {
    echo -e "${GREEN}🔧 进入容器...${NC}"
    docker compose exec crypto-monitor sh
}

rebuild() {
    echo -e "${YELLOW}🔨 重新构建并启动...${NC}"
    docker compose down
    docker compose build --no-cache
    docker compose up -d
    echo -e "${GREEN}✅ 重建完成${NC}"
}

cleanup() {
    echo -e "${YELLOW}⚠️  这将删除所有容器和镜像，数据目录会保留${NC}"
    read -p "确认继续？(y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker compose down -v
        docker system prune -af
        echo -e "${GREEN}✅ 清理完成${NC}"
    else
        echo -e "${YELLOW}已取消${NC}"
    fi
}

# 主循环
while true; do
    show_menu
    read -p "请选择操作 [0-9]: " choice
    echo ""

    case $choice in
        1) start_service ;;
        2) stop_service ;;
        3) restart_service ;;
        4) show_status ;;
        5) show_logs ;;
        6) follow_logs ;;
        7) enter_container ;;
        8) rebuild ;;
        9) cleanup ;;
        0) echo "👋 再见！"; exit 0 ;;
        *) echo -e "${YELLOW}❌ 无效选择${NC}" ;;
    esac

    echo ""
    read -p "按回车继续..."
    clear
done
