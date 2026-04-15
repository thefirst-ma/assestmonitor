import { database } from './database';
import { priceService } from './services/price';
import { NotificationService } from './services/notifier';
import { config, PRICE_ALERT_LOOKBACK_SECONDS, ALERT_COOLDOWN_SECONDS } from './config';
import { PriceAlert, Asset, AssetType } from './types';

export class InvestmentMonitor {
  private notifier: NotificationService;
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private running = false;
  /** 上次对该「逻辑标的」发出通知的时间（毫秒），用于冷却；加密货币按规范化交易对合并，避免 ETH 重复推送 */
  private lastAlertAt: Map<string, number> = new Map();
  /** 本轮 checkGroup 内已告警过的逻辑键，同一轮内同一标的只推一条（即使冷却为 0） */
  private alertRoundKeys: Set<string> = new Set();
  /** 告警后忽略该时间戳之前的采样参与窗口高/低计算，避免旧峰值/谷底在冷却结束后反复触发同类告警 */
  private alertWindowFloorSec: Map<string, number> = new Map();

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
    this.alertRoundKeys.clear();
    const priceCache = new Map<string, number>();
    /** 跨用户、同 type+symbol 合并为一条 Telegram */
    const telegramMergeBatch = new Map<string, PriceAlert[]>();

    for (const asset of assets) {
      try {
        const lastPrice = database.getLatestPrice(asset.id);
        const cacheKey = `${asset.type}:${asset.symbol}`;
        let currentPrice = priceCache.get(cacheKey);
        if (currentPrice === undefined) {
          currentPrice = await priceService.getPrice(asset.type, asset.symbol);
          priceCache.set(cacheKey, currentPrice);
        }

        const emoji = this.getTypeEmoji(asset.type);
        const threshold = asset.threshold ?? config.threshold;

        if (!lastPrice) {
          database.savePrice({ assetId: asset.id, price: currentPrice, timestamp });
          console.log(`  ${emoji} ${asset.name}: $${currentPrice.toFixed(2)} (首次记录) [间隔:${(asset.interval || config.interval) / 1000}s, 阈值:${threshold}%]`);
          continue;
        }

        // 窗口内最高/最低价：捕捉「短时间内累计涨跌超过阈值」而相邻两次采样每步都偏小的情况
        const floorSec = this.alertWindowFloorSec.get(asset.id) ?? 0;
        const fromTs = Math.max(timestamp - PRICE_ALERT_LOOKBACK_SECONDS, floorSec);
        let hist = database.getHistoricalPrices(asset.id, fromTs);
        let windowLabel = `近${PRICE_ALERT_LOOKBACK_SECONDS}s`;
        // 长监控间隔时，回看时间内往往只有 0～1 个点，窗口高低退化为「仅上次价」，窗口类条件永远不触发。
        // 回退：用最近若干条历史采样构造高低区间（仍与当前价比较）。
        if (hist.length < 2) {
          const tail = database.getLastNPrices(asset.id, 120).filter(h => h.timestamp >= floorSec);
          if (tail.length >= 2) {
            hist = tail;
            windowLabel = `最近${tail.length}次采样`;
          }
        }
        const windowPrices = hist.map(h => h.price);
        if (!hist.some(h => h.timestamp === lastPrice.timestamp && h.price === lastPrice.price)) {
          windowPrices.push(lastPrice.price);
        }
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
          if (hitDropWindow) candidates.push({ old: maxInWindow, ch: chFromPeak, r: `窗口回落(${windowLabel}最高)` });
          if (hitRiseWindow) candidates.push({ old: minInWindow, ch: chFromTrough, r: `窗口反弹(${windowLabel}最低)` });
          const best = candidates.reduce((a, b) => (Math.abs(b.ch) > Math.abs(a.ch) ? b : a));
          alertOld = best.old;
          alertChange = best.ch;
          reason = best.r;
        }

        const dedupeKey = this.alertDedupeKey(asset);
        const cooldownMs = ALERT_COOLDOWN_SECONDS * 1000;
        const lastAt = this.lastAlertAt.get(dedupeKey) || 0;
        if (shouldAlert && cooldownMs > 0 && Date.now() - lastAt < cooldownMs) {
          shouldAlert = false;
        }
        if (shouldAlert && this.alertRoundKeys.has(dedupeKey)) {
          shouldAlert = false;
        }

        const extra = ` 邻次${changeConsecutive > 0 ? '+' : ''}${changeConsecutive.toFixed(2)}% | ${windowLabel} 高$${maxInWindow.toFixed(2)} 低$${minInWindow.toFixed(2)}`;
        console.log(`  ${emoji} ${asset.name}: $${currentPrice.toFixed(2)} (${changeConsecutive > 0 ? '+' : ''}${changeConsecutive.toFixed(2)}%) [阈值:${threshold}%]${extra}`);

        database.savePrice({ assetId: asset.id, price: currentPrice, timestamp });

        if (shouldAlert) {
          this.alertRoundKeys.add(dedupeKey);
          this.lastAlertAt.set(dedupeKey, Date.now());
          const alert: PriceAlert = {
            assetId: asset.id,
            assetName: asset.name,
            assetType: asset.type,
            symbol: asset.symbol,
            oldPrice: alertOld,
            newPrice: currentPrice,
            changePercent: alertChange,
            timestamp: Date.now()
          };
          console.log(`  🔔 触发通知 (${reason}): ${alertChange > 0 ? '+' : ''}${alertChange.toFixed(2)}%`);
          await this.notifier.sendAlertWithoutTelegram(alert);
          const mergeKey = this.sharedChannelDedupeKey(asset);
          if (!telegramMergeBatch.has(mergeKey)) telegramMergeBatch.set(mergeKey, []);
          telegramMergeBatch.get(mergeKey)!.push(alert);
          // 通知后窗口基准前移：后续高/低仅基于本次告警之后的采样，避免同一历史峰/谷在冷却结束后再次满足「窗口回落/反弹」
          this.alertWindowFloorSec.set(asset.id, timestamp);
        }
      } catch (error: any) {
        console.error(`❌ ${asset.name} 价格获取失败:`, error.message);
      }
    }

    for (const merged of telegramMergeBatch.values()) {
      await this.notifier.sendTelegramMerged(merged);
    }
  }

  /** 全局同标的（不含 userId）：用于单一 Telegram 渠道合并推送 */
  private sharedChannelDedupeKey(asset: Asset): string {
    if (asset.type === 'crypto') {
      const canon = asset.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
      return `crypto:${canon}`;
    }
    return `${asset.type}:${asset.symbol.toUpperCase()}`;
  }

  /** 同一用户下相同加密货币交易对（ETHUSDT / ETH-USDT / ETH/USDT）合并为一条告警 */
  private alertDedupeKey(asset: Asset): string {
    const uid = asset.userId || '';
    if (asset.type === 'crypto') {
      const canon = asset.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
      return `${uid}:crypto:${canon}`;
    }
    return `${uid}:${asset.type}:${asset.symbol.toUpperCase()}`;
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
