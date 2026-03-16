import axios from 'axios';

const BINANCE_API = 'https://api.binance.com/api/v3';

export class BinanceService {
  // 获取当前价格
  async getPrice(symbol: string): Promise<number> {
    try {
      const response = await axios.get(`${BINANCE_API}/ticker/price`, {
        params: { symbol }
      });
      return parseFloat(response.data.price);
    } catch (error) {
      throw new Error(`Failed to fetch price for ${symbol}: ${error}`);
    }
  }

  // 批量获取价格
  async getPrices(symbols: string[]): Promise<Map<string, number>> {
    try {
      const response = await axios.get(`${BINANCE_API}/ticker/price`);
      const prices = new Map<string, number>();

      response.data.forEach((item: any) => {
        if (symbols.includes(item.symbol)) {
          prices.set(item.symbol, parseFloat(item.price));
        }
      });

      return prices;
    } catch (error) {
      throw new Error(`Failed to fetch prices: ${error}`);
    }
  }

  // 验证交易对是否存在
  async validateSymbol(symbol: string): Promise<boolean> {
    try {
      const response = await axios.get(`${BINANCE_API}/exchangeInfo`);
      return response.data.symbols.some((s: any) => s.symbol === symbol);
    } catch (error) {
      return false;
    }
  }
}

export const binanceService = new BinanceService();
