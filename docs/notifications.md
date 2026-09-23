# 微信、QQ 与注册

## 初始化

运行 `npm run db:notifications`。该命令执行 `sql/004_user_notifications_mysql.sql`，并在本地 `.env` 缺少密钥时生成 `NOTIFICATION_ENCRYPTION_KEY`。已有数据不会被清空。sql.js 使用 `sql/004_user_notifications_sqljs.sql`。

令牌以 AES-256-GCM 加密保存。备份数据库时必须单独安全备份密钥；更换密钥后需要重新录入所有推送令牌。Vercel 等部署环境需要单独配置相同密钥并执行 MySQL 迁移，不应提交 `.env`。

## 绑定通知

微信与 QQ 使用 PushPlus（第三方推送服务），不是直接登录个人社交账号。先在 PushPlus 绑定微信或 QQ，再在通知中心填写自己的 Token。QQ 渠道编码留空表示发给自己，填入已配置的编码表示发到对应群。

- 微信说明：https://www.pushplus.plus/doc/guide/api.html
- QQ 绑定、认证及额度要求：https://www.pushplus.plus/doc/channel/qq.html
- 额度：https://www.pushplus.plus/doc/guide/use.html

用户可独立开关价格提醒和推荐日报。保存后立即生效。测试按钮仅测试已保存配置，允许关闭订阅时测试；每个用户每渠道一分钟最多测试一次。

平台返回成功只代表请求已受理，页面会提供流水号，不表示收件人已收到。实际投递状态在 PushPlus 查看。连接超时不自动重试，以免重复推送。

价格提醒仅路由到资产所属用户。每日推荐发送给已启用日报的用户；现有 Telegram 行为保留。自动日报仍需 `RECOMMENDATION_ENABLED=true`，按现有时区及时间运行。QQ 是否可用取决于第三方账号绑定、认证和额度。

## 注册

登录页的注册标签可创建账户，成功后自动登录。邮箱统一去除首尾空格并转小写；密码至少 8 个字符，UTF-8 最多 72 字节。页面校验确认密码，服务端校验邮箱和密码；并发重复注册由唯一索引保护。当前未实现邮件验证，注册不等于邮箱所有权已验证。

登录与注册限流为单进程内存限流（每 IP 每 15 分钟 30 次）。多实例部署应接入共享限流存储。

## 验证

`npm run test:notifications` 在临时 sql.js 数据库中测试注册、登录、配置隔离、令牌加密、保存、发送失败、接收人及事件过滤，不向真实收件人发送消息。
