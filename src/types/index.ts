export type AssetType = 'crypto' | 'stock' | 'metal' | 'forex';

export interface Asset {
  id: string;
  type: AssetType;
  symbol: string;
  name: string;
  enabled: boolean;
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
