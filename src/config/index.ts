import dotenv from 'dotenv';
import { MonitorConfig } from '../types';

dotenv.config();

export const proxyConfig = {
  host: process.env.API_PROXY_HOST || process.env.TELEGRAM_PROXY_HOST || '',
  port: parseInt(process.env.API_PROXY_PORT || process.env.TELEGRAM_PROXY_PORT || '0'),
  get enabled() { return !!this.host && this.port > 0; }
};

export const config: MonitorConfig = {
  interval: parseInt(process.env.MONITOR_INTERVAL || '900000'),
  threshold: parseFloat(process.env.PRICE_CHANGE_THRESHOLD || '0.1'),
  notifications: {
    email: process.env.EMAIL_ENABLED === 'true' ? {
      enabled: true,
      host: process.env.EMAIL_HOST || '',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      user: process.env.EMAIL_USER || '',
      pass: process.env.EMAIL_PASS || '',
      to: process.env.EMAIL_TO || ''
    } : undefined,
    webhook: process.env.WEBHOOK_ENABLED === 'true' ? {
      enabled: true,
      url: process.env.WEBHOOK_URL || '',
      type: (process.env.WEBHOOK_TYPE as any) || 'custom'
    } : undefined,
    telegram: process.env.TELEGRAM_ENABLED === 'true' ? {
      enabled: true,
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      proxyHost: process.env.TELEGRAM_PROXY_HOST || undefined,
      proxyPort: process.env.TELEGRAM_PROXY_PORT ? parseInt(process.env.TELEGRAM_PROXY_PORT) : undefined
    } : undefined
  }
};

export const DATABASE_PATH = process.env.DATABASE_PATH || './data/crypto.db';

/** 涨跌幅计算回看窗口（秒）：与窗口内最高价/最低价比较，避免「分多步下跌每步都小于阈值」导致漏报 */
export const PRICE_ALERT_LOOKBACK_SECONDS = parseInt(process.env.PRICE_ALERT_LOOKBACK_SECONDS || '3600', 10);

/** 同一资产两次通知之间的最短间隔（秒），0 表示不限制 */
export const ALERT_COOLDOWN_SECONDS = parseInt(process.env.ALERT_COOLDOWN_SECONDS || '300', 10);
