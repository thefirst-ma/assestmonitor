import express, { Request, Response, NextFunction } from 'express';
import { InvestmentMonitor } from './monitor';
import { database } from './database';
import { config, recommendationConfig } from './config';
import { priceService } from './services/price';
import { NotificationService } from './services/notifier';
import { authService } from './services/auth';
import { stripeService } from './services/stripe';
import { stockAnalysisService } from './services/stock-analysis';
import { recommendationService } from './services/recommendation';
import { recommendationScheduler } from './recommendationScheduler';
import { encryptToken, sendPush, validateChannel } from './services/user-notifications';
import {
  AssetType,
  PLAN_LIMITS,
  RecommendationFactor,
  RecommendationHorizon,
  RecommendationReview,
  ResearchProfile,
  ReviewOutcome,
  StockFactorValue,
  StrategicFactor,
  UserPlan
} from './types';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3001;

export { app };

function maskSecret(value: string, visibleEnd = 4): string {
  if (!value || value.length <= visibleEnd) return '****';
  return '****' + value.slice(-visibleEnd);
}

// Stripe webhook needs raw body, must be before express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const sig = req.headers['stripe-signature'] as string;
    await stripeService.handleWebhookEvent(req.body, sig);
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

app.get('/api/cron/recommendations', async (req: Request, res: Response) => {
  const secret = process.env.CRON_SECRET;
  const expected = secret ? Buffer.from(`Bearer ${secret}`) : Buffer.alloc(0);
  const received = Buffer.from(req.headers.authorization || '');
  if (!secret || received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }
  if (!recommendationConfig.enabled) {
    res.status(503).json({ success: false, message: 'Recommendation schedule is disabled' });
    return;
  }

  try {
    const { runId, recommendations } = await recommendationService.generateAndSaveRecommendations('vercel-cron');
    await recommendationService.sendTelegramReport(recommendations);
    res.json({ success: true, runId });
  } catch (error: any) {
    console.error('Daily recommendation cron failed:', error);
    res.status(500).json({ success: false, message: 'Daily recommendation generation failed' });
  }
});

const authAttempts = new Map<string, { count: number; until: number }>();
app.use('/api/auth', (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'POST') return next();
  const now = Date.now();
  for (const [ip, entry] of authAttempts) if (entry.until <= now) authAttempts.delete(ip);
  const ip = req.ip || 'unknown';
  const entry = authAttempts.get(ip) || { count: 0, until: now + 15 * 60 * 1000 };
  entry.count++;
  authAttempts.set(ip, entry);
  if (entry.count > 30) { res.status(429).json({ success: false, message: '尝试过于频繁，请 15 分钟后重试' }); return; }
  next();
});

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

app.get('/api/notifications', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await database.getUserNotifications(req.userId!);
    res.json(rows.map(({ secret, userId, ...setting }) => ({ ...setting, configured: !!secret })));
  } catch {
    res.status(500).json({ success: false, message: '读取通知配置失败，请确认已执行 sql/004_user_notifications_mysql.sql' });
  }
});

app.put('/api/notifications/:channel', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const channel = validateChannel(req.params.channel);
    const { enabled, token, destination, priceAlerts, dailyReport } = req.body;
    if ([enabled, priceAlerts, dailyReport].some(value => typeof value !== 'boolean')) throw new Error('通知开关必须为布尔值');
    if (typeof token !== 'string' || typeof destination !== 'string' || !/^[\w-]{0,100}$/.test(destination)) throw new Error('通知参数格式不正确');
    if (token && !/^[a-zA-Z0-9_-]{16,200}$/.test(token)) throw new Error('PushPlus Token 格式不正确');
    const existing = (await database.getUserNotifications(req.userId!)).find(row => row.channel === channel);
    const secret = token ? encryptToken(token) : existing?.secret || '';
    if (enabled && !secret) throw new Error('启用前请填写 PushPlus Token');
    await database.saveUserNotification({ userId: req.userId!, channel, enabled, secret,
      destination: channel === 'qq' ? destination : '', priceAlerts, dailyReport });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.code ? '保存失败，请检查数据库迁移' : error.message });
  }
});

const notificationTests = new Map<string, number>();
app.post('/api/notifications/:channel/test', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const channel = validateChannel(req.params.channel);
    const key = `${req.userId}:${channel}`;
    const now = Date.now();
    for (const [id, expiry] of notificationTests) if (expiry <= now) notificationTests.delete(id);
    if (notificationTests.has(key)) { res.status(429).json({ success: false, message: '请间隔一分钟再测试' }); return; }
    const setting = (await database.getUserNotifications(req.userId!)).find(row => row.channel === channel);
    if (!setting?.secret) throw new Error('请先保存此渠道的配置');
    notificationTests.set(key, now + 60000);
    const receipt = await sendPush(setting, '投研系统通知测试', '通知连接测试。收到此消息后，即可订阅价格提醒和长期推荐日报。');
    res.json({ success: true, receipt, message: '推送平台已受理，请在微信或 QQ 确认收信' });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.code ? '测试失败，请检查通知配置' : error.message });
  }
});

app.get('/api/auth/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await database.getUserById(req.userId!);
  if (!user) { res.status(404).json({ success: false, message: '用户不存在' }); return; }

  const assetCount = await database.getAssetCountByUser(user.id);
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
app.get('/api/assets', authMiddleware, async (req: AuthRequest, res: Response) => {
  const assets = await database.getAssetsByUser(req.userId!);
  res.json(assets);
});

app.post('/api/assets', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await database.getUserById(req.userId!);
    if (!user) { res.status(404).json({ success: false, message: '用户不存在' }); return; }

    const limit = PLAN_LIMITS[user.plan as UserPlan];
    const count = await database.getAssetCountByUser(user.id);

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

app.put('/api/assets/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { interval, threshold } = req.body;
    const assetInterval = interval ? interval * 1000 : undefined;
    await monitor.updateAsset(req.params.id, assetInterval, threshold);
    res.json({ success: true, message: '资产设置已更新' });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.delete('/api/assets/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await monitor.removeAsset(req.params.id);
    res.json({ success: true, message: `已移除监控: ${req.params.id}` });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.get('/api/prices/:assetId', authMiddleware, async (req: AuthRequest, res: Response) => {
  const hours = parseInt(req.query.hours as string) || 24;
  const fromTimestamp = Math.floor(Date.now() / 1000) - (hours * 60 * 60);
  const prices = await database.getHistoricalPrices(req.params.assetId, fromTimestamp);
  res.json(prices);
});

app.get('/api/analysis/:assetId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const asset = await database.getAssetByIdForUser(req.params.assetId, req.userId!);
    if (!asset) {
      res.status(404).json({ success: false, message: '资产不存在' });
      return;
    }
    if (asset.type !== 'stock') {
      res.status(400).json({ success: false, message: '仅支持股票分析' });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 120;
    const prices = await database.getLastNPrices(asset.id, Math.min(Math.max(limit, 2), 500));
    const analysis = stockAnalysisService.analyze(asset, prices);
    res.json({ success: true, analysis });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.get('/api/recommendations/stocks', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 120;
    const assets = (await database.getAssetsByUser(req.userId!)).filter(asset => asset.type === 'stock');
    const pricesByAssetId = new Map(
      await Promise.all(assets.map(async asset => [asset.id, await database.getLastNPrices(asset.id, Math.min(Math.max(limit, 2), 500))] as const))
    );
    const recommendations = stockAnalysisService.rank(assets, pricesByAssetId);
    res.json({ success: true, recommendations });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.get('/api/recommendations/staged', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const recommendations = await recommendationService.generateStagedRecommendations();
    res.json({ success: true, recommendations });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/recommendations/latest', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, ...await database.getLatestRecommendationSnapshot() });
  } catch {
    res.status(500).json({ success: false, message: '读取推荐快照失败，请稍后重试' });
  }
});

app.post('/api/recommendations/run', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await recommendationService.generateAndSaveRecommendations('manual');
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/recommendations/history', authMiddleware, async (req: AuthRequest, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  res.json({ success: true, history: await database.getRecommendationHistory(limit), runs: await database.getRecommendationRuns(20) });
});

app.get('/api/recommendations/health', authMiddleware, async (req: AuthRequest, res: Response) => {
  res.json({ success: true, health: await recommendationService.getDataReadiness() });
});

app.get('/api/recommendations/report/:symbol', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const report = await recommendationService.getStockReport(req.params.symbol);
    res.json({ success: true, report });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/research-profiles', authMiddleware, async (req: AuthRequest, res: Response) => {
  res.json({ success: true, profiles: await database.getResearchProfiles() });
});

app.get('/api/research-profiles/:symbol', authMiddleware, async (req: AuthRequest, res: Response) => {
  const profile = await database.getResearchProfile(req.params.symbol);
  if (!profile) {
    res.status(404).json({ success: false, message: '研究档案不存在' });
    return;
  }
  res.json({ success: true, profile });
});

app.post('/api/research-profiles', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body;
    const factor = (key: string): StrategicFactor => ({
      score: Math.min(100, Math.max(0, Math.round(Number(body[key]?.score ?? 60)))),
      label: String(body[key]?.label || '待研究'),
      summary: String(body[key]?.summary || '')
    });
    const profile: ResearchProfile = {
      symbol: String(body.symbol || '').trim().toUpperCase(),
      moat: factor('moat'),
      leadership: factor('leadership'),
      industryTrend: factor('industryTrend'),
      policyImpact: factor('policyImpact'),
      confidence: Math.min(100, Math.max(0, Math.round(Number(body.confidence ?? 60)))),
      notes: String(body.notes || ''),
      updatedAt: Math.floor(Date.now() / 1000)
    };
    if (!profile.symbol) {
      res.status(400).json({ success: false, message: '请填写股票代码' });
      return;
    }
    res.json({ success: true, profile: await database.upsertResearchProfile(profile) });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.get('/api/recommendation-factors', authMiddleware, async (req: AuthRequest, res: Response) => {
  res.json({ success: true, factors: await database.getRecommendationFactors(true) });
});

app.post('/api/recommendation-factors', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body || {};
    const factor: Partial<RecommendationFactor> & Pick<RecommendationFactor, 'name'> = {
      id: body.id ? String(body.id).trim() : undefined,
      name: String(body.name || '').trim(),
      description: String(body.description || ''),
      weight: Number(body.weight ?? 1),
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      sortOrder: Math.round(Number(body.sortOrder ?? 100))
    };
    if (!factor.name) {
      res.status(400).json({ success: false, message: '请填写因子名称' });
      return;
    }
    res.json({ success: true, factor: await database.upsertRecommendationFactor(factor) });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.get('/api/stock-factor-values/:symbol', authMiddleware, async (req: AuthRequest, res: Response) => {
  res.json({ success: true, values: await database.getStockFactorValues(req.params.symbol) });
});

app.post('/api/stock-factor-values', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body || {};
    const value: StockFactorValue = {
      symbol: String(body.symbol || '').trim().toUpperCase(),
      factorId: String(body.factorId || '').trim(),
      score: Math.min(100, Math.max(0, Math.round(Number(body.score ?? 60)))),
      label: String(body.label || ''),
      summary: String(body.summary || ''),
      updatedAt: Math.floor(Date.now() / 1000)
    };
    res.json({ success: true, value: await database.upsertStockFactorValue(value) });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/recommendation-reviews', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body || {};
    const allowedOutcomes: ReviewOutcome[] = ['accurate', 'inaccurate', 'mixed', 'pending'];
    const outcome = allowedOutcomes.includes(body.outcome) ? body.outcome : 'pending';
    const allowedHorizons: RecommendationHorizon[] = ['monthly', 'quarterly', 'yearly'];
    const horizon = allowedHorizons.includes(body.horizon) ? body.horizon : undefined;
    if (!horizon) {
      res.status(400).json({ success: false, message: '推荐阶段不合法' });
      return;
    }
    const review: RecommendationReview = {
      runId: String(body.runId || ''),
      symbol: String(body.symbol || '').trim().toUpperCase(),
      horizon,
      outcome,
      reason: String(body.reason || ''),
      actualReturn: body.actualReturn === undefined || body.actualReturn === '' ? undefined : Number(body.actualReturn),
      reviewedAt: Math.floor(Date.now() / 1000)
    };
    res.json({ success: true, review: await database.upsertRecommendationReview(review) });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
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
      hasWebhookUrl: !!envVars.WEBHOOK_URL,
      recommendationEnabled: recommendationConfig.enabled,
      recommendationLimit: recommendationConfig.limit,
      recommendationMinScore: recommendationConfig.minScore,
      recommendationHour: recommendationConfig.hour,
      recommendationMinute: recommendationConfig.minute,
      recommendationTimezone: recommendationConfig.timezone
    });
  } else {
    res.json({
      interval: config.interval, threshold: config.threshold,
      emailEnabled: config.notifications.email?.enabled || false,
      webhookEnabled: config.notifications.webhook?.enabled || false,
      telegramEnabled: config.notifications.telegram?.enabled || false,
      recommendationEnabled: recommendationConfig.enabled,
      recommendationLimit: recommendationConfig.limit,
      recommendationMinScore: recommendationConfig.minScore,
      recommendationHour: recommendationConfig.hour,
      recommendationMinute: recommendationConfig.minute,
      recommendationTimezone: recommendationConfig.timezone
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
  recommendationScheduler.start();

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

if (require.main === module) {
  process.on('SIGINT', () => {
    console.log('\n\n👋 收到退出信号，正在关闭...');
    monitor.stop();
    recommendationScheduler.stop();
    process.exit(0);
  });

  startServer().catch(console.error);
}
