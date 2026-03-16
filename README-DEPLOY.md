# Docker 部署指南

## 快速部署到 Debian 服务器

### 1. 上传代码到服务器

```bash
# 方式 1: 使用 Git（推荐）
ssh user@your-server
cd /opt
git clone https://github.com/your-repo/crypto-monitor.git
cd crypto-monitor

# 方式 2: 使用 SCP
scp -r crypto-monitor user@your-server:/opt/
```

### 2. 运行部署脚本

```bash
# 给脚本执行权限
chmod +x deploy-docker.sh docker-manage.sh

# 运行部署（会自动安装 Docker）
sudo ./deploy-docker.sh
```

### 3. 配置环境变量

编辑 `.env` 文件：

```bash
nano .env
```

重要配置项：
- `PORT`: Web 服务端口（默认 3001）
- `MONITOR_INTERVAL`: 监控间隔（毫秒）
- `PRICE_CHANGE_THRESHOLD`: 价格变化阈值（百分比）
- 通知配置（邮件/Telegram/Webhook）

### 4. 启动服务

```bash
# 启动
docker compose up -d

# 查看日志
docker compose logs -f

# 查看状态
docker compose ps
```

## 管理命令

### 使用管理脚本（推荐）

```bash
./docker-manage.sh
```

提供交互式菜单：
- 启动/停止/重启服务
- 查看日志和状态
- 进入容器调试
- 重新构建镜像

### 手动命令

```bash
# 启动服务
docker compose up -d

# 停止服务
docker compose down

# 重启服务
docker compose restart

# 查看日志
docker compose logs -f

# 查看容器状态
docker compose ps

# 进入容器
docker compose exec crypto-monitor sh

# 重新构建
docker compose build --no-cache
docker compose up -d
```

## 访问服务

- **Web 界面**: `http://your-server-ip:3001`
- **健康检查**: `http://your-server-ip:3001/health`
- **API 文档**: `http://your-server-ip:3001/api`

## 数据持久化

数据存储在 `./data` 目录：
- `crypto.db`: SQLite 数据库
- 价格历史记录

备份数据：
```bash
# 备份数据库
cp data/crypto.db data/crypto.db.backup

# 或使用 tar
tar -czf backup-$(date +%Y%m%d).tar.gz data/
```

## 更新部署

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker compose down
docker compose build
docker compose up -d
```

## 防火墙配置

如果使用 UFW：

```bash
# 允许 3001 端口
sudo ufw allow 3001/tcp

# 查看状态
sudo ufw status
```

## 设置反向代理（可选）

使用 Nginx 反向代理：

```nginx
server {
    listen 80;
    server_name monitor.yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 故障排查

### 容器无法启动

```bash
# 查看详细日志
docker compose logs

# 检查端口占用
sudo netstat -tulpn | grep 3001

# 检查 Docker 状态
sudo systemctl status docker
```

### 网络问题

如果无法访问币安 API，配置代理：

```bash
# 在 .env 中添加
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
```

### 数据库问题

```bash
# 进入容器检查
docker compose exec crypto-monitor sh
ls -la /app/data
```

## 监控和日志

### 查看实时日志

```bash
docker compose logs -f crypto-monitor
```

### 日志轮转

Docker 自动管理日志，配置限制：

```yaml
# 在 docker-compose.yml 中添加
services:
  crypto-monitor:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## 性能优化

### 资源限制

```yaml
# 在 docker-compose.yml 中添加
services:
  crypto-monitor:
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
```

## 安全建议

1. 不要在 `.env` 中使用默认密码
2. 定期更新 Docker 镜像
3. 使用防火墙限制访问
4. 启用 HTTPS（使用 Let's Encrypt）
5. 定期备份数据

## 卸载

```bash
# 停止并删除容器
docker compose down -v

# 删除镜像
docker rmi crypto-monitor

# 删除数据（谨慎！）
rm -rf data/
```
