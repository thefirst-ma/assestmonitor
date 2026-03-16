import axios from 'axios';
import { AssetType } from '../types';

// 价格数据提供者接口
export interface PriceProvider {
  getPrice(symbol: string): Promise<number>;
  validateSymbol(symbol: string): Promise<boolean>;
  searchSymbols(query: string): Promise<Array<{ symbol: string; name: string }>>;
}

// Binance API - 加密货币
class BinanceProvider implements PriceProvider {
  private readonly API = 'https://api.binance.com/api/v3';

  // 常见加密货币列表（备用）
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

  async getPrice(symbol: string): Promise<number> {
    const response = await axios.get(`${this.API}/ticker/price`, {
      params: { symbol },
      timeout: 5000
    });
    return parseFloat(response.data.price);
  }

  async validateSymbol(symbol: string): Promise<boolean> {
    try {
      await this.getPrice(symbol);
      return true;
    } catch {
      // 如果 API 失败，检查是否在常见列表中
      return this.commonCryptos.some(c => c.symbol === symbol);
    }
  }

  async searchSymbols(query: string): Promise<Array<{ symbol: string; name: string }>> {
    const q = query.toLowerCase();

    // 先尝试从 API 获取
    try {
      const response = await axios.get(`${this.API}/exchangeInfo`, { timeout: 5000 });
      const symbols = response.data.symbols
        .filter((s: any) =>
          s.symbol.toLowerCase().includes(q) ||
          s.baseAsset.toLowerCase().includes(q)
        )
        .slice(0, 20)
        .map((s: any) => ({
          symbol: s.symbol,
          name: `${s.baseAsset}/${s.quoteAsset}`
        }));

      if (symbols.length > 0) return symbols;
    } catch (error) {
      console.log('Binance API 不可用，使用本地列表');
    }

    // 如果 API 失败，使用本地常见列表
    return this.commonCryptos.filter(c =>
      c.symbol.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q)
    );
  }
}

// Yahoo Finance API - 股票（支持全球市场）
class YahooFinanceProvider implements PriceProvider {
  async getPrice(symbol: string): Promise<number> {
    const response = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`, {
      params: { interval: '1d', range: '1d' },
      timeout: 10000
    });
    const quote = response.data.chart.result[0].meta.regularMarketPrice;
    return parseFloat(quote);
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
      // Yahoo Finance 搜索支持全球股票市场
      // 美股：AAPL, TSLA, GOOGL
      // A股：600519.SS（上交所）, 000001.SZ（深交所）
      // 港股：0700.HK
      // 其他市场也支持
      const response = await axios.get(`https://query1.finance.yahoo.com/v1/finance/search`, {
        params: {
          q: query,
          quotesCount: 30,  // 增加结果数量
          newsCount: 0,
          enableFuzzyQuery: true  // 启用模糊搜索
        },
        timeout: 10000
      });

      return response.data.quotes
        .filter((q: any) => q.quoteType === 'EQUITY' || q.quoteType === 'ETF')  // 只返回股票和ETF
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

// Metals API - 贵金属
class MetalsProvider implements PriceProvider {
  private readonly metals = [
    { symbol: 'gold', name: '黄金 (Gold)' },
    { symbol: 'silver', name: '白银 (Silver)' },
    { symbol: 'platinum', name: '铂金 (Platinum)' },
    { symbol: 'palladium', name: '钯金 (Palladium)' }
  ];

  async getPrice(symbol: string): Promise<number> {
    // 使用免费的金属价格 API
    const response = await axios.get(`https://api.metals.live/v1/spot/${symbol.toLowerCase()}`);
    return parseFloat(response.data[0].price);
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
    // 使用 exchangerate-api.com 免费 API
    const [base, quote] = symbol.split('/');
    const response = await axios.get(`https://api.exchangerate-api.com/v4/latest/${base}`);
    return parseFloat(response.data.rates[quote]);
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
      ['crypto', new BinanceProvider()],
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
