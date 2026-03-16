# 📱 Telegram 通知配置指南

## 概述

Telegram 是一款安全、快速的即时通讯应用，支持全球使用。本指南将帮助你配置 Telegram 通知功能。

---

## 一、准备工作

### 1. 安装 Telegram

- **手机端**：在应用商店搜索"Telegram"下载
- **电脑端**：访问 [telegram.org](https://telegram.org) 下载桌面版
- **网页版**：访问 [web.telegram.org](https://web.telegram.org)

### 2. 注册账号

1. 打开 Telegram
2. 输入手机号码
3. 输入收到的验证码
4. 设置用户名（可选）

---

## 二、创建 Telegram Bot

### 1. 找到 BotFather

1. 在 Telegram 搜索框输入：`@BotFather`
2. 点击官方的 BotFather（有蓝色认证标记 ✓）
3. 点击 **START** 或发送 `/start`

### 2. 创建新机器人

1. 发送命令：`/newbot`
2. BotFather 会要求你提供信息

### 3. 设置机器人名称

**显示名称**（可以是任何名字）：
```
Investment Monitor Bot
```
或
```
投资监控机器人
```

### 4. 设置机器人用户名

**用户名**（必须以 `bot` 结尾，且全局唯一）：
```
investment_monitor_bot
```
或
```
my_crypto_alert_bot
```

如果提示已被占用，换一个名字。

### 5. 获取 Bot Token

创建成功后，BotFather 会发送一条消息：

```
Done! Congratulations on your new bot.

Use this token to access the HTTP API:
1234567890:ABCdefGHIjklMNOpqrsTUVwxyz123456789

For a description of the Bot API, see this page:
https://core.telegram.org/bots/api
```

**复制这串 Token**（格式：`数字:字母数字混合`）

⚠️ **重要**：这个 Token 相当于密码，不要泄露给他人！

---

## 三、获取 Chat ID（三种方法）

### 方法 1：二维码扫码（最简单）⭐

1. 访问 http://localhost:3001
2. 切换到"系统配置"标签
3. 找到"📱 Telegram 通知"区域
4. 粘贴刚才的 **Bot Token**
5. 点击 **"生成二维码扫码获取"** 按钮
6. 用手机 Telegram 扫描二维码
7. 点击"START"或发送任意消息
8. 等待 2-4 秒，**Chat ID 会自动填入**！

### 方法 2：使用 userinfobot

1. 在 Telegram 搜索：`@userinfobot`
2. 点击 START
3. 它会立即返回你的信息：
   ```
   Id: 123456789
   First: 你的名字
   Username: @你的用户名
   ```
4. 复制 **Id** 后面的数字

### 方法 3：手动获取

1. 先给你的 Bot 发送 `/start` 命令
   - 在 Telegram 搜索你的 Bot 用户名
   - 点击 START 或发送 `/start`

2. 在浏览器访问（替换 YOUR_BOT_TOKEN）：
   ```
   https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
   ```

3. 在返回的 JSON 中找到：
   ```json
   {
     "message": {
       "from": {
         "id": 123456789  ← 这就是你的 Chat ID
       }
     }
   }
   ```

---

## 四、在平台中配置

访问 http://localhost:3001，切换到"系统配置"：

```
Bot Token：粘贴你的 Bot Token
Chat ID：使用上述任一方法获取并填入
```

---

## 五、测试配置

1. 点击"启用 Telegram 通知"开关（变为绿色）
2. 点击绿色"测试"按钮
3. 检查 Telegram 是否收到测试消息

### 测试消息示例

```
📈 加密货币 测试资产 价格上涨警报

原价格: $100.00
当前价格: $105.00
涨跌幅: +5.00%
时间: 2026/3/13 15:30:00
```

---

## 六、常见问题

### Q1: 扫码后没有自动填入 Chat ID

**可能原因：**
- 扫码后没有点击 START
- 网络延迟

**解决方法：**
1. 确保扫码后点击了"START"按钮
2. 等待 5-10 秒
3. 如果还是没有，使用方法 2 或方法 3 手动获取

### Q2: 测试时提示"发送失败"

**可能原因：**
- Bot Token 错误
- Chat ID 错误
- Bot 被删除

**解决方法：**
1. 检查 Bot Token 是否完整（包含冒号）
2. 确认 Chat ID 是纯数字
3. 确认已给 Bot 发送过 /start
4. 重新创建 Bot

### Q3: 收不到通知消息

**检查项：**
1. ✅ 确认"启用 Telegram 通知"开关已打开（绿色）
2. ✅ 点击"测试"按钮验证配置
3. ✅ 检查 Telegram 通知设置是否静音
4. ✅ 确认 Bot 没有被屏蔽
5. ✅ 查看服务器日志是否有错误

### Q4: Bot Token 格式是什么？

**正确格式：**
```
1234567890:ABCdefGHIjklMNOpqrsTUVwxyz-1234567
```

- 前半部分是数字
- 中间有冒号 `:`
- 后半部分是字母数字混合

### Q5: Chat ID 格式是什么？

**正确格式：**
- 个人：纯数字，如 `123456789`
- 群组：负数，如 `-987654321`

### Q6: 如何发送到群组？

1. 将你的 Bot 添加到群组
2. 在群组中发送任意消息
3. 使用方法 3 获取群组的 Chat ID（负数）
4. 填入平台配置

### Q7: 如何修改 Bot 信息？

1. 在 Telegram 找到 @BotFather
2. 发送 `/mybots`
3. 选择你的 Bot
4. 可以修改名称、描述、头像等

---

## 七、安全建议

1. ✅ 不要将 Bot Token 分享给他人
2. ✅ 不要在公开代码中硬编码 Token
3. ✅ 定期检查 Bot 的活动日志
4. ✅ 如果 Token 泄露，立即重新生成
5. ❌ 不要将 .env 文件提交到 Git

### 重新生成 Token

如果 Token 泄露：

1. 找到 @BotFather
2. 发送 `/mybots`
3. 选择你的 Bot
4. 点击"API Token"
5. 点击"Revoke current token"
6. 获取新的 Token 并更新配置

---

## 八、高级功能

### 自定义 Bot 头像

1. 找到 @BotFather
2. 发送 `/mybots`
3. 选择你的 Bot
4. 点击"Edit Bot" → "Edit Botpic"
5. 上传图片（正方形，推荐 512x512）

### 设置 Bot 描述

1. 找到 @BotFather
2. 发送 `/mybots`
3. 选择你的 Bot
4. 点击"Edit Bot" → "Edit Description"
5. 输入描述：
   ```
   投资标的价格监控机器人
   实时监控加密货币、股票、黄金等资产价格变动
   ```

### 设置命令列表

1. 找到 @BotFather
2. 发送 `/mybots`
3. 选择你的 Bot
4. 点击"Edit Bot" → "Edit Commands"
5. 输入命令列表：
   ```
   start - 开始使用
   help - 帮助信息
   status - 查看监控状态
   ```

---

## 九、配置示例

### 完整配置示例

```env
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz123456789
TELEGRAM_CHAT_ID=123456789
```

保存配置后，系统会在检测到价格变动超过阈值时自动发送 Telegram 消息。

---

## 十、故障排查

### 检查清单

- [ ] Bot Token 格式正确（包含冒号）
- [ ] Chat ID 是纯数字
- [ ] 已给 Bot 发送过 /start
- [ ] "启用 Telegram 通知"开关已打开
- [ ] 点击"测试"按钮能收到消息
- [ ] 配置已保存
- [ ] 服务已重启

### 查看日志

如果仍有问题，查看服务器日志：

```bash
# 查看实时日志
npm run dev

# 查看是否有错误信息
```

---

## 十一、对比其他通知方式

| 特性 | Telegram | 邮件 | Webhook |
|------|----------|------|---------|
| 配置难度 | ⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| 实时性 | 秒级 | 分钟级 | 秒级 |
| 全球可用 | ✅ | ✅ | ❌ |
| 免费 | ✅ | ✅ | ✅ |
| 需要手机 | ✅ | ❌ | ❌ |
| 支持群组 | ✅ | ✅ | ✅ |

---

需要帮助？请查看 [常见问题](../README.md) 或提交 Issue。
