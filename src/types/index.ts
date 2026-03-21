export type AssetType = 'crypto' | 'stock' | 'metal' | 'forex';
export type UserPlan = 'free' | 'pro';

export const PLAN_LIMITS: Record<UserPlan, number> = {
  free: 10,
  pro: 100
};

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  plan: UserPlan;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  createdAt: number;
}

export interface Asset {
  id: string;
  userId: string;
  type: AssetType;
  symbol: string;
  name: string;
  enabled: boolean;
  interval?: number;
  threshold?: number;
}

export interface PriceData {
  assetId: string;
  price: number;
  timestamp: number;
}

export interface PriceAlert {
  assetId: string;
  assetName: string;
  assetType: AssetType;
  oldPrice: number;
  newPrice: number;
  changePercent: number;
  timestamp: number;
}

export interface NotificationConfig {
  email?: {
    enabled: boolean;
    host: string;
    port: number;
    user: string;
    pass: string;
    to: string;
  };
  webhook?: {
    enabled: boolean;
    url: string;
    type: 'dingtalk' | 'wecom' | 'custom';
  };
  telegram?: {
    enabled: boolean;
    botToken: string;
    chatId: string;
    proxyHost?: string;
    proxyPort?: number;
  };
}

export interface MonitorConfig {
  interval: number;
  threshold: number;
  notifications: NotificationConfig;
}
