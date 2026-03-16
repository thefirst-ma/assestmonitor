# 📧 邮件通知配置指南

## 概述

邮件通知是最传统、最可靠的通知方式。本指南将帮助你配置邮件通知功能。

---

## 一、Gmail 配置（推荐）

### 1. 开启两步验证

1. 访问 [Google 账户安全设置](https://myaccount.google.com/security)
2. 找到"两步验证"并开启
3. 按照提示完成设置

### 2. 生成应用专用密码

1. 访问 [应用专用密码页面](https://myaccount.google.com/apppasswords)
2. 选择应用：选择"邮件"
3. 选择设备：选择"其他（自定义名称）"
4. 输入名称：`投资监控平台`
5. 点击"生成"
6. **复制生成的 16 位密码**（格式：xxxx xxxx xxxx xxxx）

### 3. 在平台中配置

访问 http://localhost:3001，切换到"系统配置"：

```
SMTP 服务器：smtp.gmail.com
SMTP 端口：587
发件邮箱：your-email@gmail.com
邮箱密码：粘贴刚才生成的 16 位密码（去掉空格）
收件邮箱：recipient@example.com（可以是同一个邮箱）
```

### 4. 测试

1. 点击"启用邮件通知"开关
2. 点击绿色"测试"按钮
3. 检查收件箱是否收到测试邮件

---

## 二、QQ 邮箱配置

### 1. 开启 SMTP 服务

1. 登录 [QQ 邮箱](https://mail.qq.com)
2. 点击"设置" → "账户"
3. 找到"POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务"
4. 开启"SMTP服务"
5. 按照提示发送短信验证
6. **保存生成的授权码**（16位字符）

### 2. 在平台中配置

```
SMTP 服务器：smtp.qq.com
SMTP 端口：587
发件邮箱：your-qq-number@qq.com
邮箱密码：粘贴刚才的授权码
收件邮箱：recipient@example.com
```

### 3. 测试

点击"测试"按钮验证配置。

---

## 三、163 网易邮箱配置

### 1. 开启 SMTP 服务

1. 登录 [163 邮箱](https://mail.163.com)
2. 点击"设置" → "POP3/SMTP/IMAP"
3. 开启"SMTP服务"
4. 设置客户端授权密码
5. **保存授权密码**

### 2. 在平台中配置

```
SMTP 服务器：smtp.163.com
SMTP 端口：465（使用 SSL）或 25
发件邮箱：your-email@163.com
邮箱密码：授权密码
收件邮箱：recipient@example.com
```

---

## 四、企业邮箱配置

### Microsoft 365 / Outlook

```
SMTP 服务器：smtp.office365.com
SMTP 端口：587
发件邮箱：your-email@company.com
邮箱密码：邮箱密码
```

### 腾讯企业邮箱

```
SMTP 服务器：smtp.exmail.qq.com
SMTP 端口：587
发件邮箱：your-email@company.com
邮箱密码：邮箱密码或授权码
```

---

## 五、常见问题

### Q1: 测试时提示"发送失败"

**可能原因：**
- SMTP 服务器地址错误
- 端口号错误
- 密码错误（应使用应用专用密码/授权码，而非登录密码）
- 未开启 SMTP 服务

**解决方法：**
1. 检查 SMTP 服务器和端口是否正确
2. 确认使用的是应用专用密码/授权码
3. 确认已在邮箱设置中开启 SMTP 服务

### Q2: Gmail 提示"不够安全的应用"

**解决方法：**
必须使用应用专用密码，不能使用账户登录密码。

### Q3: 收不到邮件

**检查项：**
1. 查看垃圾邮件文件夹
2. 检查邮箱是否已满
3. 确认收件邮箱地址正确
4. 点击"测试"按钮验证配置

### Q4: 端口 587 和 465 的区别

- **587**：STARTTLS（推荐）
- **465**：SSL/TLS
- **25**：明文传输（不推荐）

大多数情况下使用 587 端口。

---

## 六、安全建议

1. ✅ 使用应用专用密码，不要使用主密码
2. ✅ 定期更换应用专用密码
3. ✅ 不要在代码中硬编码密码
4. ✅ 使用 SSL/TLS 加密连接
5. ❌ 不要将 .env 文件提交到 Git

---

## 七、配置示例

### 完整配置示例（Gmail）

```env
EMAIL_ENABLED=true
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=myemail@gmail.com
EMAIL_PASS=abcd efgh ijkl mnop
EMAIL_TO=recipient@example.com
```

保存配置后，系统会在检测到价格变动超过阈值时自动发送邮件通知。

---

## 八、通知内容示例

```
📈 加密货币 比特币 价格上涨警报

原价格: $50000.00
当前价格: $52500.00
涨跌幅: +5.00%
时间: 2026/3/13 15:30:00
```

---

需要帮助？请查看 [常见问题](../README.md) 或提交 Issue。
