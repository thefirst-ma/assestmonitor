import express, { Request, Response, NextFunction } from 'express';
import { InvestmentMonitor } from './monitor';
import { database } from './database';
import { config } from './config';
import { priceService } from './services/price';
import { NotificationService } from './services/notifier';
import { authService } from './services/auth';
import { stripeService } from './services/stripe';
import { AssetType, PLAN_LIMITS, UserPlan } from './types';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3001;

function maskSecret(value: string, visibleEnd = 4): string {
  if (!value || value.length <= visibleEnd) return '****';
  return '****' + value.slice(-visibleEnd);
}

// Stripe webhook needs raw body, must be before express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req: Request, res: Response) => {
  try {
    const sig = req.headers['stripe-signature'] as string;
    stripeService.handleWebhookEvent(req.body, sig);
    res.json({ received: true });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const monitor = new InvestmentMonitor();

// ---- Auth middleware ----

interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: '请先登录' });
    return;
  }

  try {
    const token = header.slice(7);
    const { userId, email } = authService.verifyToken(token);
    req.userId = userId;
    req.userEmail = email;
    next();
  } catch (error: any) {
    res.status(401).json({ success: false, message: error.message });
  }
}

// ---- Public routes ----

app.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const { user, token } = await authService.register(email, password);
    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, plan: user.plan }
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const { user, token } = await authService.login(email, password);
    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, plan: user.plan }
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// ---- Protected routes ----

app.get('/api/auth/me', authMiddleware, (req: AuthRequest, res: Response) => {
  const user = database.getUserById(req.userId!);
  if (!user) { res.status(404).json({ success: false, message: '用户不存在' }); return; }

  const assetCount = database.getAssetCountByUser(user.id);
  const limit = PLAN_LIMITS[user.plan as UserPlan];

  res.json({
    id: user.id,
    email: user.email,
    plan: user.plan,
    assetCount,
    assetLimit: limit,
    stripeConfigured: stripeService.isConfigured()
  });
});

// Search (public — no auth needed for searching)
app.get('/api/search/:type', async (req: Request, res: Response) => {
  try {
    const type = req.params.type as AssetType;
    const query = req.query.q as string || '';
    const results = await priceService.searchSymbols(type, query);
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Assets — protected
app.get('/api/assets', authMiddleware, (req: AuthRequest, res: Response) => {
  const assets = database.getAssetsByUser(req.userId!);
  res.json(assets);
});

app.post('/api/assets', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = database.getUserById(req.userId!);
    if (!user) { res.status(404).json({ success: false, message: '用户不存在' }); return; }

    const limit = PLAN_LIMITS[user.plan as UserPlan];
    const count = database.getAssetCountByUser(user.id);

    if (count >= limit) {
      res.status(403).json({
        success: false,
        message: `${user.plan === 'free' ? '免费' : 'Pro'}版已达上限 (${count}/${limit})，${user.plan === 'free' ? '升级 Pro 可监控 100 个指标' : '已达最大限制'}`,
        limitReached: true
      });
      return;
    }

    const { type, symbol, name, interval, threshold } = req.body;
    const assetInterval = interval ? interval * 1000 : undefined;
    await monitor.addAsset(type as AssetType, symbol.toUpperCase(), name, req.userId!, assetInterval, threshold);
    res.json({ success: true, message: `已添加监控: ${name || symbol}` });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.put('/api/assets/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { interval, threshold } = req.body;
    const assetInterval = interval ? interval * 1000 : undefined;
    monitor.updateAsset(req.params.id, assetInterval, threshold);
    res.json({ success: true, message: '资产设置已更新' });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.delete('/api/assets/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    monitor.removeAsset(req.params.id);
    res.json({ success: true, message: `已移除监控: ${req.params.id}` });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.get('/api/prices/:assetId', authMiddleware, (req: AuthRequest, res: Response) => {
  const hours = parseInt(req.query.hours as string) || 24;
  const fromTimestamp = Math.floor(Date.now() / 1000) - (hours * 60 * 60);
  const prices = database.getHistoricalPrices(req.params.assetId, fromTimestamp);
  res.json(prices);
});

// ---- Stripe routes ----

app.post('/api/stripe/checkout', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const url = await stripeService.createCheckoutSession(req.userId!, req.userEmail!);
    res.json({ success: true, url });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/stripe/portal', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const url = await stripeService.createPortalSession(req.userId!);
    res.json({ success: true, url });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ---- Config routes (protected) ----

app.get('/api/config', authMiddleware, (req: AuthRequest, res: Response) => {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const envVars: any = {};
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) envVars[match[1].trim()] = match[2].trim();
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
      interval: config.interval, threshold: config.threshold,
      emailEnabled: config.notifications.email?.enabled || false,
      webhookEnabled: config.notifications.webhook?.enabled || false,
      telegramEnabled: config.notifications.telegram?.enabled || false
    });
  }
});

app.post('/api/config', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { threshold, interval, emailConfig, webhookConfig, telegramConfig } = req.body;
    const envPath = path.join(__dirname, '../.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

    const updateEnv = (key: string, value: string) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) envContent = envContent.replace(regex, `${key}=${value}`);
      else envContent += `\n${key}=${value}`;
    };
    const hasOwn = (obj: any, key: string) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);

    if (threshold !== undefined) updateEnv('PRICE_CHANGE_THRESHOLD', threshold.toString());
    if (interval !== undefined) updateEnv('MONITOR_INTERVAL', interval.toString());

    if (emailConfig) {
      if (hasOwn(emailConfig, 'enabled')) updateEnv('EMAIL_ENABLED', emailConfig.enabled ? 'true' : 'false');
      if (hasOwn(emailConfig, 'host') && emailConfig.host) updateEnv('EMAIL_HOST', emailConfig.host);
      if (hasOwn(emailConfig, 'port') && emailConfig.port) updateEnv('EMAIL_PORT', emailConfig.port.toString());
      if (hasOwn(emailConfig, 'user') && emailConfig.user) updateEnv('EMAIL_USER', emailConfig.user);
      if (hasOwn(emailConfig, 'pass') && emailConfig.pass) updateEnv('EMAIL_PASS', emailConfig.pass);
      if (hasOwn(emailConfig, 'to') && emailConfig.to) updateEnv('EMAIL_TO', emailConfig.to);
    }

    const isNotMasked = (val: string) => val && !val.startsWith('****');

    if (webhookConfig) {
      if (hasOwn(webhookConfig, 'enabled')) updateEnv('WEBHOOK_ENABLED', webhookConfig.enabled ? 'true' : 'false');
      if (hasOwn(webhookConfig, 'url') && isNotMasked(webhookConfig.url)) updateEnv('WEBHOOK_URL', webhookConfig.url);
      if (hasOwn(webhookConfig, 'type') && webhookConfig.type) updateEnv('WEBHOOK_TYPE', webhookConfig.type);
    }

    if (telegramConfig) {
      if (hasOwn(telegramConfig, 'enabled')) updateEnv('TELEGRAM_ENABLED', telegramConfig.enabled ? 'true' : 'false');
      if (hasOwn(telegramConfig, 'botToken') && isNotMasked(telegramConfig.botToken)) updateEnv('TELEGRAM_BOT_TOKEN', telegramConfig.botToken);
      if (hasOwn(telegramConfig, 'chatId') && isNotMasked(telegramConfig.chatId)) updateEnv('TELEGRAM_CHAT_ID', telegramConfig.chatId);
      if (hasOwn(telegramConfig, 'proxyHost') && telegramConfig.proxyHost) updateEnv('TELEGRAM_PROXY_HOST', telegramConfig.proxyHost);
      if (hasOwn(telegramConfig, 'proxyPort') && telegramConfig.proxyPort) updateEnv('TELEGRAM_PROXY_PORT', telegramConfig.proxyPort.toString());
    }

    fs.writeFileSync(envPath, envContent);
    res.json({ success: true, message: '配置已保存，请重启服务生效' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ---- Notification test routes (protected) ----

app.post('/api/test/email', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { host, port, user, pass, to } = req.body;
    const testNotifier = new NotificationService({ email: { enabled: true, host, port, user, pass, to } });
    await testNotifier.sendAlert({ assetId: 'test', assetName: '测试资产', assetType: 'crypto', oldPrice: 100, newPrice: 105, changePercent: 5, timestamp: Date.now() });
    res.json({ success: true, message: '测试邮件已发送，请检查收件箱' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: `发送失败: ${error.message}` });
  }
});

app.post('/api/test/webhook', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { url, type } = req.body;
    const testNotifier = new NotificationService({ webhook: { enabled: true, url, type } });
    await testNotifier.sendAlert({ assetId: 'test', assetName: '测试资产', assetType: 'crypto', oldPrice: 100, newPrice: 105, changePercent: 5, timestamp: Date.now() });
    res.json({ success: true, message: 'Webhook 测试消息已发送' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: `发送失败: ${error.message}` });
  }
});

app.post('/api/test/telegram', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { botToken, chatId, proxyHost, proxyPort } = req.body;
    const testNotifier = new NotificationService({ telegram: { enabled: true, botToken, chatId, proxyHost: proxyHost || undefined, proxyPort: proxyPort ? parseInt(proxyPort) : undefined } });
    await testNotifier.sendAlert({ assetId: 'test', assetName: '测试资产', assetType: 'crypto', oldPrice: 100, newPrice: 105, changePercent: 5, timestamp: Date.now() });
    res.json({ success: true, message: 'Telegram 测试消息已发送' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: `发送失败: ${error.message}` });
  }
});

app.post('/api/telegram/qrcode', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { botToken } = req.body;
    if (!botToken) { res.status(400).json({ success: false, message: '请提供 Bot Token' }); return; }
    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(botToken, { polling: false });
    const botInfo = await bot.getMe();
    const deepLink = `https://t.me/${botInfo.username}?start=getchatid`;
    const qrCodeDataUrl = await QRCode.toDataURL(deepLink, { width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
    res.json({ success: true, qrCode: qrCodeDataUrl, botUsername: botInfo.username, deepLink });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/telegram/chatid', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { botToken } = req.body;
    if (!botToken) { res.status(400).json({ success: false, message: '请提供 Bot Token' }); return; }
    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(botToken, { polling: false });
    const updates = await bot.getUpdates({ limit: 10, timeout: 0 });
    if (updates.length === 0) { res.json({ success: false, message: '等待用户扫码...' }); return; }
    const latest = updates[updates.length - 1];
    const chatId = latest.message?.chat?.id || latest.message?.from?.id;
    if (chatId) {
      res.json({ success: true, chatId: chatId.toString(), username: latest.message?.from?.username || '未设置', firstName: latest.message?.from?.first_name || '未知' });
    } else {
      res.json({ success: false, message: '等待用户扫码...' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/telegram/test', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { botToken } = req.body;
    if (!botToken) { res.status(400).json({ success: false, message: '请提供 Bot Token' }); return; }
    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(botToken, { polling: false });
    const updates = await bot.getUpdates({ limit: 10 });
    if (updates.length === 0) { res.json({ success: false, message: '未找到消息记录。请先给 Bot 发送 /start' }); return; }
    const latest = updates[updates.length - 1];
    const chatId = latest.message?.chat?.id || latest.message?.from?.id;
    if (chatId) {
      res.json({ success: true, chatId: chatId.toString(), username: latest.message?.from?.username || '未设置', firstName: latest.message?.from?.first_name || '未知', message: `Chat ID: ${chatId}` });
    } else {
      res.json({ success: false, message: '无法获取 Chat ID' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ---- Server startup ----

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

process.on('SIGINT', () => {
  console.log('\n\n👋 收到退出信号，正在关闭...');
  monitor.stop();
  process.exit(0);
});

startServer().catch(console.error);
