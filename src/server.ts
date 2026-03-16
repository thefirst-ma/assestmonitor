import express from 'express';
import { InvestmentMonitor } from './monitor';
import { database } from './database';
import { config } from './config';
import { priceService } from './services/price';
import { NotificationService } from './services/notifier';
import { AssetType } from './types';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3001;

function maskSecret(value: string, visibleEnd = 4): string {
  if (!value || value.length <= visibleEnd) return '****';
  return '****' + value.slice(-visibleEnd);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const monitor = new InvestmentMonitor();

// API 路由

// 搜索资产
app.get('/api/search/:type', async (req, res) => {
  try {
    const type = req.params.type as AssetType;
    const query = req.query.q as string || '';
    const results = await priceService.searchSymbols(type, query);
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取所有监控资产
app.get('/api/assets', (req, res) => {
  const assets = database.getEnabledAssets();
  res.json(assets);
});

// 添加监控资产
app.post('/api/assets', async (req, res) => {
  try {
    const { type, symbol, name } = req.body;
    await monitor.addAsset(type as AssetType, symbol.toUpperCase(), name);
    res.json({ success: true, message: `已添加监控: ${name || symbol}` });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 删除监控资产
app.delete('/api/assets/:id', (req, res) => {
  try {
    monitor.removeAsset(req.params.id);
    res.json({ success: true, message: `已移除监控: ${req.params.id}` });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 获取价格历史
app.get('/api/prices/:assetId', (req, res) => {
  const hours = parseInt(req.query.hours as string) || 24;
  const fromTimestamp = Math.floor(Date.now() / 1000) - (hours * 60 * 60);
  const prices = database.getHistoricalPrices(req.params.assetId, fromTimestamp);
  res.json(prices);
});

// 获取当前配置
app.get('/api/config', (req, res) => {
  // 重新读取 .env 文件以获取最新配置
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const envVars: any = {};

    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        envVars[match[1].trim()] = match[2].trim();
      }
    });

    res.json({
      interval: parseInt(envVars.MONITOR_INTERVAL || '900000'),
      threshold: parseFloat(envVars.PRICE_CHANGE_THRESHOLD || '5'),
      emailEnabled: envVars.EMAIL_ENABLED === 'true',
      emailHost: envVars.EMAIL_HOST || '',
      emailPort: envVars.EMAIL_PORT || '',
      emailUser: envVars.EMAIL_USER || '',
      emailTo: envVars.EMAIL_TO || '',
      webhookEnabled: envVars.WEBHOOK_ENABLED === 'true',
      webhookType: envVars.WEBHOOK_TYPE || 'dingtalk',
      webhookUrl: envVars.WEBHOOK_URL ? maskSecret(envVars.WEBHOOK_URL, 8) : '',
      telegramEnabled: envVars.TELEGRAM_ENABLED === 'true',
      telegramBotToken: envVars.TELEGRAM_BOT_TOKEN ? maskSecret(envVars.TELEGRAM_BOT_TOKEN) : '',
      telegramChatId: envVars.TELEGRAM_CHAT_ID ? maskSecret(envVars.TELEGRAM_CHAT_ID) : '',
      telegramProxyHost: envVars.TELEGRAM_PROXY_HOST || '',
      telegramProxyPort: envVars.TELEGRAM_PROXY_PORT || '',
      hasToken: !!envVars.TELEGRAM_BOT_TOKEN,
      hasChatId: !!envVars.TELEGRAM_CHAT_ID,
      hasWebhookUrl: !!envVars.WEBHOOK_URL
    });
  } else {
    res.json({
      interval: config.interval,
      threshold: config.threshold,
      emailEnabled: config.notifications.email?.enabled || false,
      webhookEnabled: config.notifications.webhook?.enabled || false,
      telegramEnabled: config.notifications.telegram?.enabled || false
    });
  }
});

// 更新配置
app.post('/api/config', (req, res) => {
  try {
    const { threshold, interval, emailConfig, webhookConfig, telegramConfig } = req.body;

    // 更新 .env 文件
    const envPath = path.join(__dirname, '../.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

    const updateEnv = (key: string, value: string) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    };

    if (threshold !== undefined) updateEnv('PRICE_CHANGE_THRESHOLD', threshold.toString());
    if (interval !== undefined) updateEnv('MONITOR_INTERVAL', interval.toString());

    if (emailConfig) {
      updateEnv('EMAIL_ENABLED', emailConfig.enabled ? 'true' : 'false');
      if (emailConfig.host) updateEnv('EMAIL_HOST', emailConfig.host);
      if (emailConfig.port) updateEnv('EMAIL_PORT', emailConfig.port.toString());
      if (emailConfig.user) updateEnv('EMAIL_USER', emailConfig.user);
      if (emailConfig.pass) updateEnv('EMAIL_PASS', emailConfig.pass);
      if (emailConfig.to) updateEnv('EMAIL_TO', emailConfig.to);
    }

    const isNotMasked = (val: string) => val && !val.startsWith('****');

    if (webhookConfig) {
      updateEnv('WEBHOOK_ENABLED', webhookConfig.enabled ? 'true' : 'false');
      if (isNotMasked(webhookConfig.url)) updateEnv('WEBHOOK_URL', webhookConfig.url);
      if (webhookConfig.type) updateEnv('WEBHOOK_TYPE', webhookConfig.type);
    }

    if (telegramConfig) {
      updateEnv('TELEGRAM_ENABLED', telegramConfig.enabled ? 'true' : 'false');
      if (isNotMasked(telegramConfig.botToken)) updateEnv('TELEGRAM_BOT_TOKEN', telegramConfig.botToken);
      if (isNotMasked(telegramConfig.chatId)) updateEnv('TELEGRAM_CHAT_ID', telegramConfig.chatId);
      if (telegramConfig.proxyHost) updateEnv('TELEGRAM_PROXY_HOST', telegramConfig.proxyHost);
      if (telegramConfig.proxyPort) updateEnv('TELEGRAM_PROXY_PORT', telegramConfig.proxyPort.toString());
    }

    fs.writeFileSync(envPath, envContent);

    res.json({ success: true, message: '配置已保存，请重启服务生效' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 测试邮件通知
app.post('/api/test/email', async (req, res) => {
  try {
    const { host, port, user, pass, to } = req.body;

    const testNotifier = new NotificationService({
      email: { enabled: true, host, port, user, pass, to }
    });

    await testNotifier.sendAlert({
      assetId: 'test',
      assetName: '测试资产',
      assetType: 'crypto',
      oldPrice: 100,
      newPrice: 105,
      changePercent: 5,
      timestamp: Date.now()
    });

    res.json({ success: true, message: '测试邮件已发送，请检查收件箱' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: `发送失败: ${error.message}` });
  }
});

// 测试 Webhook 通知
app.post('/api/test/webhook', async (req, res) => {
  try {
    const { url, type } = req.body;

    const testNotifier = new NotificationService({
      webhook: { enabled: true, url, type }
    });

    await testNotifier.sendAlert({
      assetId: 'test',
      assetName: '测试资产',
      assetType: 'crypto',
      oldPrice: 100,
      newPrice: 105,
      changePercent: 5,
      timestamp: Date.now()
    });

    res.json({ success: true, message: 'Webhook 测试消息已发送' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: `发送失败: ${error.message}` });
  }
});

// 测试 Telegram 通知
app.post('/api/test/telegram', async (req, res) => {
  try {
    const { botToken, chatId, proxyHost, proxyPort } = req.body;

    const testNotifier = new NotificationService({
      telegram: {
        enabled: true,
        botToken,
        chatId,
        proxyHost: proxyHost || undefined,
        proxyPort: proxyPort ? parseInt(proxyPort) : undefined
      }
    });

    await testNotifier.sendAlert({
      assetId: 'test',
      assetName: '测试资产',
      assetType: 'crypto',
      oldPrice: 100,
      newPrice: 105,
      changePercent: 5,
      timestamp: Date.now()
    });

    res.json({ success: true, message: 'Telegram 测试消息已发送' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: `发送失败: ${error.message}` });
  }
});

// 生成 Telegram Bot 二维码
app.post('/api/telegram/qrcode', async (req, res) => {
  try {
    const { botToken } = req.body;
    if (!botToken) {
      return res.status(400).json({ success: false, message: '请提供 Bot Token' });
    }

    // 从 token 中提取 bot username
    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(botToken, { polling: false });

    try {
      const botInfo = await bot.getMe();
      const botUsername = botInfo.username;

      // 生成 Telegram 深度链接
      const deepLink = `https://t.me/${botUsername}?start=getchatid`;

      // 生成二维码
      const qrCodeDataUrl = await QRCode.toDataURL(deepLink, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });

      res.json({
        success: true,
        qrCode: qrCodeDataUrl,
        botUsername,
        deepLink,
        message: '请使用 Telegram 扫描二维码或点击链接'
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: `无法连接到 Telegram Bot: ${error.message}`
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: `生成二维码失败: ${error.message}`
    });
  }
});

// 获取 Telegram Chat ID（轮询方式）
app.post('/api/telegram/chatid', async (req, res) => {
  try {
    const { botToken } = req.body;
    if (!botToken) {
      return res.status(400).json({ success: false, message: '请提供 Bot Token' });
    }
    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(botToken, { polling: false });

    const updates = await bot.getUpdates({ limit: 10, timeout: 0 });

    if (updates.length === 0) {
      return res.json({
        success: false,
        message: '等待用户扫码...'
      });
    }

    const latestUpdate = updates[updates.length - 1];
    const chatId = latestUpdate.message?.chat?.id || latestUpdate.message?.from?.id;
    const username = latestUpdate.message?.from?.username;
    const firstName = latestUpdate.message?.from?.first_name;

    if (chatId) {
      res.json({
        success: true,
        chatId: chatId.toString(),
        username: username || '未设置',
        firstName: firstName || '未知'
      });
    } else {
      res.json({
        success: false,
        message: '等待用户扫码...'
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: `获取失败: ${error.message}`
    });
  }
});

// 测试 Telegram 并获取 Chat ID（旧方法，保留兼容）
app.post('/api/telegram/test', async (req, res) => {
  try {
    const { botToken } = req.body;
    if (!botToken) {
      return res.status(400).json({ success: false, message: '请提供 Bot Token' });
    }

    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(botToken, { polling: false });

    // 获取最近的更新
    const updates = await bot.getUpdates({ limit: 10 });

    if (updates.length === 0) {
      return res.json({
        success: false,
        message: '未找到消息记录。请先给你的 Bot 发送 /start 命令，然后再点击测试。'
      });
    }

    // 获取最新消息的 Chat ID
    const latestUpdate = updates[updates.length - 1];
    const chatId = latestUpdate.message?.chat?.id || latestUpdate.message?.from?.id;
    const username = latestUpdate.message?.from?.username;
    const firstName = latestUpdate.message?.from?.first_name;

    if (chatId) {
      res.json({
        success: true,
        chatId: chatId.toString(),
        username: username || '未设置',
        firstName: firstName || '未知',
        message: `找到你的 Chat ID: ${chatId}`
      });
    } else {
      res.json({
        success: false,
        message: '无法获取 Chat ID，请确保已给 Bot 发送过消息'
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: `测试失败: ${error.message}`
    });
  }
});

// 启动服务
async function startServer() {
  await monitor.start();

  const tryListen = (port: number, maxRetries = 5): void => {
    const server = app.listen(port, () => {
      console.log(`\n🌐 Web 界面已启动: http://localhost:${port}`);
      console.log(`📊 在浏览器中打开上述地址进行配置和监控\n`);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && maxRetries > 0) {
        console.warn(`⚠️ 端口 ${port} 已被占用，尝试端口 ${port + 1}...`);
        tryListen(port + 1, maxRetries - 1);
      } else {
        console.error(`❌ 服务启动失败:`, err.message);
        process.exit(1);
      }
    });
  };

  tryListen(Number(PORT));
}

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n\n👋 收到退出信号，正在关闭...');
  monitor.stop();
  process.exit(0);
});

startServer().catch(console.error);
