import { database } from './database';
import { priceService } from './services/price';
import { NotificationService } from './services/notifier';
import { config } from './config';
import { PriceAlert, Asset, AssetType } from './types';

export class InvestmentMonitor {
  private notifier: NotificationService;
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private running = false;

  constructor() {
    this.notifier = new NotificationService(config.notifications);
  }

  async start(): Promise<void> {
    console.log('🚀 投资标的监控平台启动');
    console.log(`⏱️  默认监控间隔: ${config.interval / 1000}秒`);
    console.log(`📊 默认涨跌幅阈值: ±${config.threshold}%`);

    await database.init();
    this.running = true;
    this.scheduleAll();
  }

  stop(): void {
    this.running = false;
    for (const [id, timer] of this.timers) {
      clearInterval(timer);
    }
    this.timers.clear();
    console.log('⏹️  监控已停止');
  }

  scheduleAll(): void {
    for (const [, timer] of this.timers) {
      clearInterval(timer);
    }
    this.timers.clear();

    const assets = database.getEnabledAssets();
    if (assets.length === 0) {
      console.log('⚠️  没有配置监控资产');
      return;
    }

    const groups = new Map<number, Asset[]>();
    for (const asset of assets) {
      const interval = asset.interval || config.interval;
      if (!groups.has(interval)) groups.set(interval, []);
      groups.get(interval)!.push(asset);
    }

    for (const [interval, groupAssets] of groups) {
      const names = groupAssets.map(a => a.name).join(', ');
      console.log(`⏱️  [${interval / 1000}s] ${names}`);

      this.checkGroup(groupAssets);

      const timer = setInterval(() => {
        if (this.running) this.checkGroup(groupAssets).catch(console.error);
      }, interval);
      this.timers.set(`group_${interval}`, timer);
    }
  }

  private async checkGroup(assets: Asset[]): Promise<void> {
    console.log(`\n🔍 [${new Date().toLocaleString('zh-CN')}] 检查 ${assets.length} 个资产...`);
    const timestamp = Math.floor(Date.now() / 1000);

    for (const asset of assets) {
      try {
        const lastPrice = database.getLatestPrice(asset.id);
        const currentPrice = await priceService.getPrice(asset.type, asset.symbol);

        database.savePrice({ assetId: asset.id, price: currentPrice, timestamp });

        const emoji = this.getTypeEmoji(asset.type);
        const threshold = asset.threshold || config.threshold;

        if (lastPrice) {
          const changePercent = ((currentPrice - lastPrice.price) / lastPrice.price) * 100;
          console.log(`  ${emoji} ${asset.name}: $${currentPrice.toFixed(2)} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%) [阈值:${threshold}%]`);

          if (Math.abs(changePercent) >= threshold) {
            const alert: PriceAlert = {
              assetId: asset.id,
              assetName: asset.name,
              assetType: asset.type,
              oldPrice: lastPrice.price,
              newPrice: currentPrice,
              changePercent,
              timestamp: Date.now()
            };
            await this.notifier.sendAlert(alert);
          }
        } else {
          console.log(`  ${emoji} ${asset.name}: $${currentPrice.toFixed(2)} (首次记录) [间隔:${(asset.interval || config.interval) / 1000}s, 阈值:${threshold}%]`);
        }
      } catch (error: any) {
        console.error(`❌ ${asset.name} 价格获取失败:`, error.message);
      }
    }
  }

  private getTypeEmoji(type: AssetType): string {
    const emojis: Record<AssetType, string> = {
      crypto: '₿', stock: '📈', metal: '🥇', forex: '💱'
    };
    return emojis[type] || '📊';
  }

  async addAsset(type: AssetType, symbol: string, name?: string, userId?: string, interval?: number, threshold?: number): Promise<void> {
    const isValid = await priceService.validateSymbol(type, symbol);
    if (!isValid) throw new Error(`无效的资产: ${type}:${symbol}`);

    const id = userId ? `${userId}:${type}:${symbol}` : `${type}:${symbol}`;
    const assetName = name || symbol;
    database.addAsset(id, userId || '', type, symbol, assetName, interval, threshold);
    console.log(`✅ 已添加监控: ${assetName} (${type}) [间隔:${(interval || config.interval) / 1000}s, 阈值:${threshold || config.threshold}%]`);

    if (this.running) this.scheduleAll();
  }

  updateAsset(id: string, interval?: number, threshold?: number): void {
    database.updateAsset(id, interval, threshold);
    console.log(`✏️  已更新: ${id} [间隔:${(interval || config.interval) / 1000}s, 阈值:${threshold || config.threshold}%]`);
    if (this.running) this.scheduleAll();
  }

  removeAsset(id: string): void {
    database.removeAsset(id);
    console.log(`🗑️  已移除监控: ${id}`);
    if (this.running) this.scheduleAll();
  }

  listAssets(): void {
    const assets = database.getEnabledAssets();
    console.log('\n📋 当前监控资产:');
    assets.forEach(a => {
      const emoji = this.getTypeEmoji(a.type);
      const interval = (a.interval || config.interval) / 1000;
      const threshold = a.threshold || config.threshold;
      console.log(`  ${emoji} ${a.name} (${a.type}:${a.symbol}) [${interval}s, ±${threshold}%]`);
    });
  }
}
