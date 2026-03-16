import { database } from './database';
import { priceService } from './services/price';
import { NotificationService } from './services/notifier';
import { config } from './config';
import { PriceAlert, AssetType } from './types';

export class InvestmentMonitor {
  private notifier: NotificationService;
  private intervalId?: NodeJS.Timeout;

  constructor() {
    this.notifier = new NotificationService(config.notifications);
  }

  async start(): Promise<void> {
    console.log('🚀 投资标的监控平台启动');
    console.log(`⏱️  监控间隔: ${config.interval / 1000}秒`);
    console.log(`📊 涨跌幅阈值: ±${config.threshold}%`);

    // 初始化数据库
    await database.init();

    // 立即执行一次
    await this.checkPrices();

    // 定时执行
    this.intervalId = setInterval(() => {
      this.checkPrices().catch(console.error);
    }, config.interval);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      console.log('⏹️  监控已停止');
    }
  }

  private async checkPrices(): Promise<void> {
    const assets = database.getEnabledAssets();

    if (assets.length === 0) {
      console.log('⚠️  没有配置监控资产');
      return;
    }

    console.log(`\n🔍 [${new Date().toLocaleString('zh-CN')}] 检查 ${assets.length} 个资产...`);

    const timestamp = Math.floor(Date.now() / 1000);

    for (const asset of assets) {
      try {
        const currentPrice = await priceService.getPrice(asset.type, asset.symbol);

        // 保存当前价格
        database.savePrice({
          assetId: asset.id,
          price: currentPrice,
          timestamp
        });

        // 获取上一次价格
        const lastPrice = database.getLatestPrice(asset.id);

        const typeEmoji = this.getTypeEmoji(asset.type);

        if (lastPrice && lastPrice.timestamp !== timestamp) {
          const changePercent = ((currentPrice - lastPrice.price) / lastPrice.price) * 100;

          console.log(`  ${typeEmoji} ${asset.name}: $${currentPrice.toFixed(2)} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%)`);

          // 检查是否触发警报
          if (Math.abs(changePercent) >= config.threshold) {
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
          console.log(`  ${typeEmoji} ${asset.name}: $${currentPrice.toFixed(2)} (首次记录)`);
        }
      } catch (error: any) {
        console.error(`❌ ${asset.name} 价格获取失败:`, error.message);
      }
    }
  }

  private getTypeEmoji(type: AssetType): string {
    const emojis: Record<AssetType, string> = {
      crypto: '₿',
      stock: '📈',
      metal: '🥇',
      forex: '💱'
    };
    return emojis[type] || '📊';
  }

  // 添加监控资产
  async addAsset(type: AssetType, symbol: string, name?: string): Promise<void> {
    const isValid = await priceService.validateSymbol(type, symbol);
    if (!isValid) {
      throw new Error(`无效的资产: ${type}:${symbol}`);
    }

    const id = `${type}:${symbol}`;
    const assetName = name || symbol;
    database.addAsset(id, type, symbol, assetName);
    console.log(`✅ 已添加监控: ${assetName} (${type})`);
  }

  // 移除监控资产
  removeAsset(id: string): void {
    database.removeAsset(id);
    console.log(`🗑️  已移除监控: ${id}`);
  }

  // 列出所有监控资产
  listAssets(): void {
    const assets = database.getEnabledAssets();
    console.log('\n📋 当前监控资产:');
    assets.forEach(a => {
      const emoji = this.getTypeEmoji(a.type);
      console.log(`  ${emoji} ${a.name} (${a.type}:${a.symbol})`);
    });
  }
}
