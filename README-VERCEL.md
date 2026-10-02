# Vercel 部署说明

本仓库已关联 Vercel 项目 `investment-monitor`。`vercel.json` 把静态页面和 Express API 部署到 Vercel，并在东京 `hnd1` 运行函数，以靠近东京 MySQL。每日推荐通过 Vercel Cron 调用 `/api/cron/recommendations`。

## 生产环境变量

在 Vercel 项目的 Production 环境中配置以下变量：

- 数据库：`DATABASE_DRIVER=mysql`、`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_SSL_CA_BASE64`。
- 账户与通知：`JWT_SECRET`、`NOTIFICATION_ENCRYPTION_KEY`、`CRON_SECRET`。
- 推荐任务：`RECOMMENDATION_ENABLED=true`，以及按需配置的推荐股票池和评分参数。
- 管理员：`ADMIN_EMAILS`，填写已注册用户的登录邮箱；多个邮箱以逗号分隔。未配置时普通用户仍可查看自己的资产和共享研究结果，但不能修改全局因子、研究档案、复盘或系统设置。

不要直接重新运行 `deploy/configure-vercel.cjs`：它会生成新的 JWT、Cron 等密钥，可能使现有登录和通知配置失效。

## 发布与验证

```bash
npm ci
npm run build
npm run test:research
npm run test:notifications
npm run test:security
npm run test:privacy
npm run test:monitor
npx vercel deploy --prod --yes --scope thefirstmas-projects
```

发布后检查首页、`/api/health` 返回 `{"status":"ok"}`、`/api/auth/me` 的未登录响应、Vercel Deployment 状态和 Runtime Logs。`/api/health` 会实际查询数据库。不要用真实用户资料执行会写生产数据库的 smoke 脚本。

## 价格监控进程

Vercel Function 在请求之间不会保持 `setInterval` 运行。价格采样与告警由 `src/worker.ts` 的常驻进程执行；Vercel Web/API 与 worker 必须连接同一个 MySQL 数据库。Hobby 方案的 Vercel Cron 只能每天运行一次，不适合分钟级价格告警。

在一台常驻服务器上部署同一版本代码，配置仅供 worker 使用的环境文件（例如 `.env.worker`），至少包含 `DATABASE_DRIVER=mysql`、`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD`。如果数据库要求 TLS，还要配置与 Vercel 相同的 `MYSQL_SSL_CA_BASE64`。若使用用户 PushPlus 通知，还需配置与 Vercel 相同的 `NOTIFICATION_ENCRYPTION_KEY`；邮件、Webhook 和 Telegram 通知按需复制相应环境变量。不要在 worker 上启用推荐日报进程。

```bash
npm ci
npm run build
set -a; . ./.env.worker; set +a
npm run start:worker
```

可用 systemd 等进程管理器守护 `npm run start:worker`，并在停止时发送 SIGTERM。只运行一个价格 worker 实例，避免多实例重复采样和通知。`MONITOR_INTERVAL` 是默认采价间隔（毫秒），必须在 1000 至 2147483647 之间；每个资产另设的间隔仍按其设置执行。worker 启动时采价，此后每 60 秒从共享 MySQL 刷新资产计划；`MONITOR_PLAN_REFRESH_MS` 可调整刷新周期（毫秒，至少 5000），不会重置未改变间隔的采价定时器。Vercel API 上新增、修改或删除的资产会在下一次计划刷新后生效。退出时会取消定时器，等待当前采价和通知完成，最长等待 30 秒。

Vercel 上的 `/api/config` 仅供管理员读取，配置修改请在 Vercel 项目环境变量中完成并重新部署。
