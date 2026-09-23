import axios from 'axios';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { database } from '../database';

export type Channel = 'wechat' | 'qq';
export interface UserNotification {
  userId: string;
  channel: Channel;
  enabled: boolean;
  secret: string;
  destination: string;
  priceAlerts: boolean;
  dailyReport: boolean;
}

function key(): Buffer {
  const value = process.env.NOTIFICATION_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('请先配置 NOTIFICATION_ENCRYPTION_KEY（32 字节十六进制密钥）');
  return Buffer.from(value, 'hex');
}

export function encryptToken(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64')).join('.');
}

function decryptToken(value: string): string {
  const [iv, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8');
}

export function validateChannel(value: string): Channel {
  if (value !== 'wechat' && value !== 'qq') throw new Error('不支持的通知渠道');
  return value;
}

export async function sendPush(setting: UserNotification, title: string, content: string): Promise<string> {
  if (!setting.secret) throw new Error('请先保存 PushPlus Token');
  const token = decryptToken(setting.secret);
  let data;
  try {
    ({ data } = await axios.post('https://www.pushplus.plus/send', {
      token, channel: setting.channel, option: setting.destination || undefined,
      title, content, template: 'txt'
    }, { timeout: 15000, maxRedirects: 0 }));
  } catch {
    throw new Error('推送服务连接失败，请稍后重试');
  }
  if (data?.code !== 200 || typeof data?.data !== 'string') {
    throw new Error(`推送平台拒绝请求（错误码 ${Number(data?.code) || '未知'}），请检查令牌、绑定状态和额度`);
  }
  return data.data;
}

export async function notifyUser(userId: string, event: 'priceAlerts' | 'dailyReport', title: string, content: string): Promise<void> {
  const settings = await database.getUserNotifications(userId);
  for (const setting of settings.filter(item => item.enabled && item[event])) {
    try {
      await sendPush(setting, title, content);
    } catch (error) {
      console.error(`通知失败 (${setting.channel}, ${userId}):`, (error as Error).message);
    }
  }
}

export async function notifyReportSubscribers(content: string): Promise<void> {
  for (const userId of await database.getNotificationSubscribers()) {
    await notifyUser(userId, 'dailyReport', '长期股票推荐日报', content);
  }
}
