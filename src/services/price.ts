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

// Yahoo Finance API - 股票（支持中文搜索）
class YahooFinanceProvider implements PriceProvider {
  private readonly cnStocks: Array<{ symbol: string; name: string; pinyin: string }> = [
    // 上证 A 股热门
    { symbol: '600519.SS', name: '贵州茅台', pinyin: 'guizhou maotai' },
    { symbol: '601318.SS', name: '中国平安', pinyin: 'zhongguo pingan' },
    { symbol: '600036.SS', name: '招商银行', pinyin: 'zhaoshang yinhang' },
    { symbol: '601398.SS', name: '工商银行', pinyin: 'gongshang yinhang' },
    { symbol: '600276.SS', name: '恒瑞医药', pinyin: 'hengrui yiyao' },
    { symbol: '601012.SS', name: '隆基绿能', pinyin: 'longji lvneng' },
    { symbol: '600900.SS', name: '长江电力', pinyin: 'changjiang dianli' },
    { symbol: '600809.SS', name: '山西汾酒', pinyin: 'shanxi fenjiu' },
    { symbol: '601888.SS', name: '中国中免', pinyin: 'zhongguo zhongmian' },
    { symbol: '600030.SS', name: '中信证券', pinyin: 'zhongxin zhengquan' },
    { symbol: '601166.SS', name: '兴业银行', pinyin: 'xingye yinhang' },
    { symbol: '600887.SS', name: '伊利股份', pinyin: 'yili gufen' },
    { symbol: '603259.SS', name: '药明康德', pinyin: 'yaoming kangde' },
    { symbol: '600031.SS', name: '三一重工', pinyin: 'sanyi zhonggong' },
    { symbol: '600050.SS', name: '中国联通', pinyin: 'zhongguo liantong' },
    { symbol: '601857.SS', name: '中国石油', pinyin: 'zhongguo shiyou' },
    { symbol: '600028.SS', name: '中国石化', pinyin: 'zhongguo shihua' },
    { symbol: '601668.SS', name: '中国建筑', pinyin: 'zhongguo jianzhu' },
    { symbol: '600104.SS', name: '上汽集团', pinyin: 'shangqi jituan' },
    { symbol: '601633.SS', name: '长城汽车', pinyin: 'changcheng qiche' },
    { symbol: '600438.SS', name: '通威股份', pinyin: 'tongwei gufen' },
    { symbol: '600309.SS', name: '万华化学', pinyin: 'wanhua huaxue' },
    { symbol: '601899.SS', name: '紫金矿业', pinyin: 'zijin kuangye' },
    { symbol: '600000.SS', name: '浦发银行', pinyin: 'pufa yinhang' },
    { symbol: '601939.SS', name: '建设银行', pinyin: 'jianshe yinhang' },
    { symbol: '601288.SS', name: '农业银行', pinyin: 'nongye yinhang' },
    { symbol: '601988.SS', name: '中国银行', pinyin: 'zhongguo yinhang' },
    { symbol: '600585.SS', name: '海螺水泥', pinyin: 'hailuo shuini' },
    { symbol: '601601.SS', name: '中国太保', pinyin: 'zhongguo taibao' },
    { symbol: '600690.SS', name: '海尔智家', pinyin: 'haier zhijia' },
    // 深证 A 股热门
    { symbol: '000858.SZ', name: '五粮液', pinyin: 'wuliangye' },
    { symbol: '000333.SZ', name: '美的集团', pinyin: 'meidi jituan' },
    { symbol: '002594.SZ', name: '比亚迪', pinyin: 'biyadi' },
    { symbol: '000001.SZ', name: '平安银行', pinyin: 'pingan yinhang' },
    { symbol: '000651.SZ', name: '格力电器', pinyin: 'geli dianqi' },
    { symbol: '002415.SZ', name: '海康威视', pinyin: 'haikang weishi' },
    { symbol: '000568.SZ', name: '泸州老窖', pinyin: 'luzhou laojiao' },
    { symbol: '002304.SZ', name: '洋河股份', pinyin: 'yanghe gufen' },
    { symbol: '002714.SZ', name: '牧原股份', pinyin: 'muyuan gufen' },
    { symbol: '000725.SZ', name: '京东方A', pinyin: 'jingdongfang' },
    { symbol: '002352.SZ', name: '顺丰控股', pinyin: 'shunfeng konggu' },
    { symbol: '000002.SZ', name: '万科A', pinyin: 'wanke' },
    { symbol: '002230.SZ', name: '科大讯飞', pinyin: 'keda xunfei' },
    { symbol: '300750.SZ', name: '宁德时代', pinyin: 'ningde shidai' },
    { symbol: '300059.SZ', name: '东方财富', pinyin: 'dongfang caifu' },
    { symbol: '300124.SZ', name: '汇川技术', pinyin: 'huichuan jishu' },
    { symbol: '300015.SZ', name: '爱尔眼科', pinyin: 'aier yanke' },
    { symbol: '002475.SZ', name: '立讯精密', pinyin: 'lixun jingmi' },
    { symbol: '300760.SZ', name: '迈瑞医疗', pinyin: 'mairui yiliao' },
    { symbol: '002241.SZ', name: '歌尔股份', pinyin: 'goer gufen' },
    // 港股热门
    { symbol: '0700.HK', name: '腾讯控股', pinyin: 'tengxun konggu' },
    { symbol: '9988.HK', name: '阿里巴巴', pinyin: 'alibaba' },
    { symbol: '3690.HK', name: '美团', pinyin: 'meituan' },
    { symbol: '9999.HK', name: '网易', pinyin: 'wangyi' },
    { symbol: '1810.HK', name: '小米集团', pinyin: 'xiaomi jituan' },
    { symbol: '9618.HK', name: '京东集团', pinyin: 'jingdong jituan' },
    { symbol: '9888.HK', name: '百度集团', pinyin: 'baidu jituan' },
    { symbol: '0941.HK', name: '中国移动', pinyin: 'zhongguo yidong' },
    { symbol: '2318.HK', name: '中国平安', pinyin: 'zhongguo pingan' },
    { symbol: '0005.HK', name: '汇丰控股', pinyin: 'huifeng konggu' },
    { symbol: '1299.HK', name: '友邦保险', pinyin: 'youbang baoxian' },
    { symbol: '2020.HK', name: '安踏体育', pinyin: 'anta tiyu' },
    { symbol: '0388.HK', name: '香港交易所', pinyin: 'xianggang jiaoyisuo' },
    { symbol: '1024.HK', name: '快手', pinyin: 'kuaishou' },
    { symbol: '0981.HK', name: '中芯国际', pinyin: 'zhongxin guoji' },
    // 美股中概热门
    { symbol: 'BABA', name: '阿里巴巴(美)', pinyin: 'alibaba' },
    { symbol: 'PDD', name: '拼多多', pinyin: 'pinduoduo' },
    { symbol: 'JD', name: '京东', pinyin: 'jingdong' },
    { symbol: 'BIDU', name: '百度', pinyin: 'baidu' },
    { symbol: 'NIO', name: '蔚来汽车', pinyin: 'weilai qiche' },
    { symbol: 'XPEV', name: '小鹏汽车', pinyin: 'xiaopeng qiche' },
    { symbol: 'LI', name: '理想汽车', pinyin: 'lixiang qiche' },
    { symbol: 'NTES', name: '网易(美)', pinyin: 'wangyi' },
    { symbol: 'BILI', name: '哔哩哔哩', pinyin: 'bilibili' },
    { symbol: 'TME', name: '腾讯音乐', pinyin: 'tengxun yinyue' },
    // 美股科技巨头
    { symbol: 'AAPL', name: '苹果', pinyin: 'pingguo apple' },
    { symbol: 'MSFT', name: '微软', pinyin: 'weiruan microsoft' },
    { symbol: 'GOOGL', name: '谷歌', pinyin: 'guge google' },
    { symbol: 'AMZN', name: '亚马逊', pinyin: 'yamaxun amazon' },
    { symbol: 'TSLA', name: '特斯拉', pinyin: 'tesila tesla' },
    { symbol: 'META', name: 'Meta/脸书', pinyin: 'lianshu facebook meta' },
    { symbol: 'NVDA', name: '英伟达', pinyin: 'yingweida nvidia' },
    { symbol: 'AMD', name: 'AMD/超威', pinyin: 'chaowei amd' },
    { symbol: 'INTC', name: '英特尔', pinyin: 'yingteer intel' },
    { symbol: 'NFLX', name: '奈飞', pinyin: 'naifei netflix' },
  ];

  private isChinese(str: string): boolean {
    return /[\u4e00-\u9fff]/.test(str);
  }

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
    const q = query.toLowerCase().trim();

    // 先在中文本地列表中搜索（中文名、拼音、股票代码都匹配）
    const localResults = this.cnStocks.filter(s =>
      s.name.includes(q) ||
      s.pinyin.includes(q) ||
      s.symbol.toLowerCase().includes(q)
    ).map(s => ({ symbol: s.symbol, name: s.name }));

    if (localResults.length > 0) return localResults.slice(0, 20);

    // 如果是中文输入但本地没匹配到，直接返回空（Yahoo 对中文支持差）
    if (this.isChinese(q)) return [];

    // 英文关键词走 Yahoo Finance API
    try {
      const data = await requestWithRetry<any>({
        url: 'https://query1.finance.yahoo.com/v1/finance/search',
        params: { q: query, quotesCount: 30, newsCount: 0, enableFuzzyQuery: true },
        timeout: 15000
      });

      return data.quotes
        .filter((item: any) => item.quoteType === 'EQUITY' || item.quoteType === 'ETF')
        .map((item: any) => ({
          symbol: item.symbol,
          name: `${item.longname || item.shortname || item.symbol} (${item.exchDisp || item.exchange || ''})`
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
    this.providers = new Map<AssetType, PriceProvider>([
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
