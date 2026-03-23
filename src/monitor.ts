import { database } from './database';
import { priceService } from './services/price';
import { NotificationService } from './services/notifier';
import { config, PRICE_ALERT_LOOKBACK_SECONDS, ALERT_COOLDOWN_SECONDS } from './config';
import { PriceAlert, Asset, AssetType } from './types';

export class InvestmentMonitor {
  private notifier: NotificationService;
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private running = false;
  /** 上次对该资产发出通知的时间（毫秒），用于冷却避免刷屏 */
  private lastAlertAt: Map<string, number> = new Map();

  constructor() {
    this.notifier = new NotificationService(config.notifications);
  }

  async start(): Promise<void> {
    console.log('🚀 投资标的监控平台启动');
    console.log(`⏱️  默认监控间隔: ${config.interval / 1000}秒`);
    console.log(`📊 默认涨跌幅阈值: ±${config.threshold}%`);
    console.log(`📂 涨跌回看窗口: ${PRICE_ALERT_LOOKBACK_SECONDS}s（与窗口内最高/最低价比较，减少漏报）`);
    if (ALERT_COOLDOWN_SECONDS > 0) {
      console.log(`🔕 通知冷却: 同一资产 ${ALERT_COOLDOWN_SECONDS}s 内最多一条`);
    }

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
    const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    console.log(`\n🔍 [${ts}] 检查 ${assets.length} 个资产...`);
    const timestamp = Math.floor(Date.now() / 1000);

    for (const asset of assets) {
      try {
        const lastPrice = database.getLatestPrice(asset.id);
        const currentPrice = await priceService.getPrice(asset.type, asset.symbol);

        const emoji = this.getTypeEmoji(asset.type);
        const threshold = asset.threshold ?? config.threshold;

        if (!lastPrice) {
          database.savePrice({ assetId: asset.id, price: currentPrice, timestamp });
          console.log(`  ${emoji} ${asset.name}: $${currentPrice.toFixed(2)} (首次记录) [间隔:${(asset.interval || config.interval) / 1000}s, 阈值:${threshold}%]`);
          continue;
        }

        // 窗口内最高/最低价：捕捉「短时间内累计涨跌超过阈值」而相邻两次采样每步都偏小的情况
        const fromTs = timestamp - PRICE_ALERT_LOOKBACK_SECONDS;
        const hist = database.getHistoricalPrices(asset.id, fromTs);
        const windowPrices = hist.map(h => h.price);
        windowPrices.push(lastPrice.price);
        const maxInWindow = Math.max(...windowPrices);
        const minInWindow = Math.min(...windowPrices);

        const changeConsecutive = ((currentPrice - lastPrice.price) / lastPrice.price) * 100;
        const dropFromPeakPct = maxInWindow > 0 ? ((maxInWindow - currentPrice) / maxInWindow) * 100 : 0;
        const riseFromTroughPct = minInWindow > 0 ? ((currentPrice - minInWindow) / minInWindow) * 100 : 0;

        const hitConsecutive = Math.abs(changeConsecutive) >= threshold;
        const hitDropWindow = dropFromPeakPct >= threshold;
        const hitRiseWindow = riseFromTroughPct >= threshold;

        let shouldAlert = hitConsecutive || hitDropWindow || hitRiseWindow;

        const chFromPeak = ((currentPrice - maxInWindow) / maxInWindow) * 100;
        const chFromTrough = ((currentPrice - minInWindow) / minInWindow) * 100;

        let alertOld = lastPrice.price;
        let alertChange = changeConsecutive;
        let reason = '相邻采样';

        if (shouldAlert) {
          const candidates: Array<{ old: number; ch: number; r: string }> = [];
          if (hitConsecutive) candidates.push({ old: lastPrice.price, ch: changeConsecutive, r: '相邻采样' });
          if (hitDropWindow) candidates.push({ old: maxInWindow, ch: chFromPeak, r: `窗口回落(近${PRICE_ALERT_LOOKBACK_SECONDS}s最高)` });
          if (hitRiseWindow) candidates.push({ old: minInWindow, ch: chFromTrough, r: `窗口反弹(近${PRICE_ALERT_LOOKBACK_SECONDS}s最低)` });
          const best = candidates.reduce((a, b) => (Math.abs(b.ch) > Math.abs(a.ch) ? b : a));
          alertOld = best.old;
          alertChange = best.ch;
          reason = best.r;
        }

        const cooldownMs = ALERT_COOLDOWN_SECONDS * 1000;
        const lastAt = this.lastAlertAt.get(asset.id) || 0;
        if (shouldAlert && cooldownMs > 0 && Date.now() - lastAt < cooldownMs) {
          shouldAlert = false;
        }

        const extra = ` 邻次${changeConsecutive > 0 ? '+' : ''}${changeConsecutive.toFixed(2)}% | 近${PRICE_ALERT_LOOKBACK_SECONDS}s 高$${maxInWindow.toFixed(2)} 低$${minInWindow.toFixed(2)}`;
        console.log(`  ${emoji} ${asset.name}: $${currentPrice.toFixed(2)} (${changeConsecutive > 0 ? '+' : ''}${changeConsecutive.toFixed(2)}%) [阈值:${threshold}%]${extra}`);

        database.savePrice({ assetId: asset.id, price: currentPrice, timestamp });

        if (shouldAlert) {
          this.lastAlertAt.set(asset.id, Date.now());
          const alert: PriceAlert = {
            assetId: asset.id,
            assetName: asset.name,
            assetType: asset.type,
            oldPrice: alertOld,
            newPrice: currentPrice,
            changePercent: alertChange,
            timestamp: Date.now()
          };
          console.log(`  🔔 触发通知 (${reason}): ${alertChange > 0 ? '+' : ''}${alertChange.toFixed(2)}%`);
          await this.notifier.sendAlert(alert);
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
