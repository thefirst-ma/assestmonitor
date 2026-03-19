import axios, { AxiosRequestConfig } from 'axios';
import { AssetType } from '../types';
import { proxyConfig } from '../config';

function applyProxy(config: AxiosRequestConfig): AxiosRequestConfig {
  if (proxyConfig.enabled) {
    config.proxy = { host: proxyConfig.host, port: proxyConfig.port, protocol: 'http' };
  }
  return config;
}

async function requestWithRetry<T>(config: AxiosRequestConfig, retries = 3, delay = 2000): Promise<T> {
  applyProxy(config);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios(config);
      return response.data as T;
    } catch (error: any) {
      const isLast = attempt === retries;
      if (isLast) throw error;
      const isRetryable = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
        || error.code === 'ECONNRESET' || error.code === 'EPROTO'
        || !error.response || error.response.status >= 500 || error.response.status === 451;
      if (!isRetryable) throw error;
      console.warn(`⚠️ 请求失败 (${attempt}/${retries})，${delay / 1000}s 后重试...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('请求失败');
}

// 价格数据提供者接口
export interface PriceProvider {
  getPrice(symbol: string): Promise<number>;
  validateSymbol(symbol: string): Promise<boolean>;
  searchSymbols(query: string): Promise<Array<{ symbol: string; name: string }>>;
}

// 加密货币 - OKX 优先，Binance 备用
class CryptoProvider implements PriceProvider {
  private readonly commonCryptos = [
    { symbol: 'BTCUSDT', name: 'Bitcoin/USDT' },
    { symbol: 'ETHUSDT', name: 'Ethereum/USDT' },
    { symbol: 'BNBUSDT', name: 'BNB/USDT' },
    { symbol: 'SOLUSDT', name: 'Solana/USDT' },
    { symbol: 'XRPUSDT', name: 'Ripple/USDT' },
    { symbol: 'ADAUSDT', name: 'Cardano/USDT' },
    { symbol: 'DOGEUSDT', name: 'Dogecoin/USDT' },
    { symbol: 'MATICUSDT', name: 'Polygon/USDT' },
    { symbol: 'DOTUSDT', name: 'Polkadot/USDT' },
    { symbol: 'LTCUSDT', name: 'Litecoin/USDT' },
    { symbol: 'AVAXUSDT', name: 'Avalanche/USDT' },
    { symbol: 'LINKUSDT', name: 'Chainlink/USDT' },
    { symbol: 'ATOMUSDT', name: 'Cosmos/USDT' },
    { symbol: 'UNIUSDT', name: 'Uniswap/USDT' },
    { symbol: 'ETCUSDT', name: 'Ethereum Classic/USDT' },
    { symbol: 'XLMUSDT', name: 'Stellar/USDT' },
    { symbol: 'ALGOUSDT', name: 'Algorand/USDT' },
    { symbol: 'VETUSDT', name: 'VeChain/USDT' },
    { symbol: 'FILUSDT', name: 'Filecoin/USDT' },
    { symbol: 'TRXUSDT', name: 'TRON/USDT' }
  ];

  private toOkxInstId(symbol: string): string {
    const s = symbol.toUpperCase();
    if (s.endsWith('USDT')) return s.replace('USDT', '-USDT');
    if (s.endsWith('USDC')) return s.replace('USDC', '-USDC');
    if (s.endsWith('BTC')) return s.replace('BTC', '-BTC');
    return s + '-USDT';
  }

  async getPrice(symbol: string): Promise<number> {
    // OKX (国内直连)
    try {
      const instId = this.toOkxInstId(symbol);
      const data = await requestWithRetry<any>({
        url: 'https://www.okx.com/api/v5/market/ticker',
        params: { instId },
        timeout: 15000
      }, 2, 1000);
      if (data?.data?.[0]?.last) return parseFloat(data.data[0].last);
    } catch (e: any) {
      console.warn(`OKX 获取失败，尝试 Binance: ${e.message}`);
    }

    // Binance 备用
    const data = await requestWithRetry<{ price: string }>({
      url: 'https://api.binance.com/api/v3/ticker/price',
      params: { symbol },
      timeout: 15000
    });
    return parseFloat(data.price);
  }

  async validateSymbol(symbol: string): Promise<boolean> {
    try {
      await this.getPrice(symbol);
      return true;
    } catch {
      return this.commonCryptos.some(c => c.symbol === symbol);
    }
  }

  async searchSymbols(query: string): Promise<Array<{ symbol: string; name: string }>> {
    const q = query.toLowerCase();

    try {
      const data = await requestWithRetry<any>({
        url: 'https://www.okx.com/api/v5/market/tickers',
        params: { instType: 'SPOT' },
        timeout: 15000
      }, 2, 1000);

      if (data?.data) {
        const results = data.data
          .filter((t: any) => t.instId.toLowerCase().includes(q))
          .slice(0, 20)
          .map((t: any) => {
            const [base, quote] = t.instId.split('-');
            return { symbol: base + quote, name: `${base}/${quote}` };
          });
        if (results.length > 0) return results;
      }
    } catch {
      console.log('OKX API 搜索不可用，使用本地列表');
    }

    return this.commonCryptos.filter(c =>
      c.symbol.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q)
    );
  }
}

// Yahoo Finance API - 股票
class YahooFinanceProvider implements PriceProvider {
  async getPrice(symbol: string): Promise<number> {
    const data = await requestWithRetry<any>({
      url: `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`,
      params: { interval: '1d', range: '1d' },
      timeout: 15000
    });
    return parseFloat(data.chart.result[0].meta.regularMarketPrice);
  }

  async validateSymbol(symbol: string): Promise<boolean> {
    try {
      await this.getPrice(symbol);
      return true;
    } catch {
      return false;
    }
  }

  async searchSymbols(query: string): Promise<Array<{ symbol: string; name: string }>> {
    try {
      const data = await requestWithRetry<any>({
        url: 'https://query1.finance.yahoo.com/v1/finance/search',
        params: { q: query, quotesCount: 30, newsCount: 0, enableFuzzyQuery: true },
        timeout: 15000
      });

      return data.quotes
        .filter((q: any) => q.quoteType === 'EQUITY' || q.quoteType === 'ETF')
        .map((q: any) => ({
          symbol: q.symbol,
          name: `${q.longname || q.shortname || q.symbol} (${q.exchDisp || q.exchange || ''})`
        }));
    } catch (error) {
      console.error('Yahoo Finance 搜索失败:', error);
      return [];
    }
  }
}

// 贵金属 - 通过 Yahoo Finance 期货行情获取
class MetalsProvider implements PriceProvider {
  private readonly metals = [
    { symbol: 'gold', name: '黄金 (Gold)', yahoo: 'GC=F' },
    { symbol: 'silver', name: '白银 (Silver)', yahoo: 'SI=F' },
    { symbol: 'platinum', name: '铂金 (Platinum)', yahoo: 'PL=F' },
    { symbol: 'palladium', name: '钯金 (Palladium)', yahoo: 'PA=F' }
  ];

  async getPrice(symbol: string): Promise<number> {
    const metal = this.metals.find(m => m.symbol.toLowerCase() === symbol.toLowerCase());
    if (!metal) throw new Error(`未知贵金属: ${symbol}`);

    const data = await requestWithRetry<any>({
      url: `https://query1.finance.yahoo.com/v8/finance/chart/${metal.yahoo}`,
      params: { interval: '1d', range: '1d' },
      timeout: 15000
    });
    return parseFloat(data.chart.result[0].meta.regularMarketPrice);
  }

  async validateSymbol(symbol: string): Promise<boolean> {
    return this.metals.some(m => m.symbol.toLowerCase() === symbol.toLowerCase());
  }

  async searchSymbols(query: string): Promise<Array<{ symbol: string; name: string }>> {
    return this.metals.filter(m =>
      m.symbol.toLowerCase().includes(query.toLowerCase()) ||
      m.name.toLowerCase().includes(query.toLowerCase())
    );
  }
}

// Forex API - 外汇
class ForexProvider implements PriceProvider {
  private readonly currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'AUD', 'CAD', 'CHF', 'HKD', 'SGD'];

  async getPrice(symbol: string): Promise<number> {
    const [base, quote] = symbol.split('/');
    const data = await requestWithRetry<any>({
      url: `https://api.exchangerate-api.com/v4/latest/${base}`,
      timeout: 15000
    });
    return parseFloat(data.rates[quote]);
  }

  async validateSymbol(symbol: string): Promise<boolean> {
    try {
      await this.getPrice(symbol);
      return true;
    } catch {
      return false;
    }
  }

  async searchSymbols(query: string): Promise<Array<{ symbol: string; name: string }>> {
    const results: Array<{ symbol: string; name: string }> = [];
    const q = query.toUpperCase();

    for (const base of this.currencies) {
      for (const quote of this.currencies) {
        if (base !== quote && (base.includes(q) || quote.includes(q))) {
          results.push({
            symbol: `${base}/${quote}`,
            name: `${base} to ${quote}`
          });
        }
      }
    }

    return results.slice(0, 20);
  }
}

// 价格服务管理器
export class PriceService {
  private providers: Map<AssetType, PriceProvider>;

  constructor() {
    this.providers = new Map([
      ['crypto', new CryptoProvider()],
      ['stock', new YahooFinanceProvider()],
      ['metal', new MetalsProvider()],
      ['forex', new ForexProvider()]
    ]);
  }

  async getPrice(type: AssetType, symbol: string): Promise<number> {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`不支持的资产类型: ${type}`);
    }
    return provider.getPrice(symbol);
  }

  async validateSymbol(type: AssetType, symbol: string): Promise<boolean> {
    const provider = this.providers.get(type);
    if (!provider) return false;
    return provider.validateSymbol(symbol);
  }

  async searchSymbols(type: AssetType, query: string): Promise<Array<{ symbol: string; name: string }>> {
    const provider = this.providers.get(type);
    if (!provider) return [];
    return provider.searchSymbols(query);
  }

  // 批量获取价格
  async getPrices(assets: Array<{ type: AssetType; symbol: string }>): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    await Promise.allSettled(
      assets.map(async (asset) => {
        try {
          const price = await this.getPrice(asset.type, asset.symbol);
          prices.set(`${asset.type}:${asset.symbol}`, price);
        } catch (error) {
          console.error(`获取价格失败 ${asset.type}:${asset.symbol}:`, error);
        }
      })
    );

    return prices;
  }
}

export const priceService = new PriceService();
