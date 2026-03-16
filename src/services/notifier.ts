import nodemailer from 'nodemailer';
import axios from 'axios';
import TelegramBot from 'node-telegram-bot-api';
import { PriceAlert, NotificationConfig } from '../types';

export class NotificationService {
  private telegramBot?: TelegramBot;

  constructor(private config: NotificationConfig) {
    if (this.config.telegram?.enabled && this.config.telegram.botToken) {
      const botOptions: any = { polling: false };

      // 配置代理
      if (this.config.telegram.proxyHost && this.config.telegram.proxyPort) {
        botOptions.request = {
          proxy: `http://${this.config.telegram.proxyHost}:${this.config.telegram.proxyPort}`
        };
        console.log(`📡 Telegram 使用代理: ${this.config.telegram.proxyHost}:${this.config.telegram.proxyPort}`);
      }

      this.telegramBot = new TelegramBot(this.config.telegram.botToken, botOptions);
    }
  }

  async sendAlert(alert: PriceAlert): Promise<void> {
    const message = this.formatMessage(alert);

    const promises: Promise<void>[] = [];

    if (this.config.email?.enabled) {
      promises.push(this.sendEmail(message, alert));
    }

    if (this.config.webhook?.enabled) {
      promises.push(this.sendWebhook(message, alert));
    }

    if (this.config.telegram?.enabled) {
      promises.push(this.sendTelegram(message, alert));
    }

    await Promise.allSettled(promises);
  }

  private formatMessage(alert: PriceAlert): string {
    const direction = alert.changePercent > 0 ? '上涨' : '下跌';
    const emoji = alert.changePercent > 0 ? '📈' : '📉';
    const typeNames: Record<string, string> = {
      crypto: '加密货币',
      stock: '股票',
      metal: '贵金属',
      forex: '外汇'
    };

    return `${emoji} ${typeNames[alert.assetType] || '资产'} ${alert.assetName} 价格${direction}警报\n\n` +
           `原价格: $${alert.oldPrice.toFixed(2)}\n` +
           `当前价格: $${alert.newPrice.toFixed(2)}\n` +
           `涨跌幅: ${alert.changePercent > 0 ? '+' : ''}${alert.changePercent.toFixed(2)}%\n` +
           `时间: ${new Date(alert.timestamp).toLocaleString('zh-CN')}`;
  }

  private async sendEmail(message: string, alert: PriceAlert): Promise<void> {
    if (!this.config.email) return;

    try {
      const transporter = nodemailer.createTransport({
        host: this.config.email.host,
        port: this.config.email.port,
        secure: this.config.email.port === 465,
        auth: {
          user: this.config.email.user,
          pass: this.config.email.pass
        }
      });

      await transporter.sendMail({
        from: this.config.email.user,
        to: this.config.email.to,
        subject: `投资标的价格警报: ${alert.assetName}`,
        text: message
      });

      console.log(`✉️  邮件通知已发送: ${alert.assetName}`);
    } catch (error) {
      console.error('邮件发送失败:', error);
    }
  }

  private async sendWebhook(message: string, alert: PriceAlert): Promise<void> {
    if (!this.config.webhook) return;

    try {
      let payload: any;

      switch (this.config.webhook.type) {
        case 'dingtalk':
          payload = {
            msgtype: 'text',
            text: { content: message }
          };
          break;

        case 'wecom':
          payload = {
            msgtype: 'text',
            text: { content: message }
          };
          break;

        default:
          payload = {
            assetId: alert.assetId,
            assetName: alert.assetName,
            assetType: alert.assetType,
            oldPrice: alert.oldPrice,
            newPrice: alert.newPrice,
            changePercent: alert.changePercent,
            timestamp: alert.timestamp,
            message
          };
      }

      await axios.post(this.config.webhook.url, payload);
      console.log(`🔔 Webhook通知已发送: ${alert.assetName}`);
    } catch (error) {
      console.error('Webhook发送失败:', error);
    }
  }

  private async sendTelegram(message: string, alert: PriceAlert): Promise<void> {
    if (!this.config.telegram || !this.telegramBot) return;

    try {
      await this.telegramBot.sendMessage(this.config.telegram.chatId, message, {
        parse_mode: 'HTML'
      });
      console.log(`📱 Telegram通知已发送: ${alert.assetName}`);
    } catch (error) {
      console.error('Telegram发送失败:', error);
    }
  }
}
