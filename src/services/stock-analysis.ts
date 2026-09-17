import { Asset, PriceData, StockAnalysis, StockAnalysisMetric, RecommendationAction } from '../types';

type SeriesPoint = Pick<PriceData, 'price' | 'timestamp'>;

function pctChange(from: number, to: number): number {
  if (from <= 0) return 0;
  return ((to - from) / from) * 100;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = average(values) ?? 0;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function metric(
  label: string,
  value: number | null,
  unit: StockAnalysisMetric['unit'],
  status: StockAnalysisMetric['status']
): StockAnalysisMetric {
  return { label, value, unit, status };
}

function statusBySignedPct(value: number, deadZone = 0.3): StockAnalysisMetric['status'] {
  if (value > deadZone) return 'positive';
  if (value < -deadZone) return 'negative';
  return 'neutral';
}

function statusByRisk(value: number, lowRisk = 2, highRisk = 6): StockAnalysisMetric['status'] {
  if (value <= lowRisk) return 'positive';
  if (value >= highRisk) return 'negative';
  return 'neutral';
}

export class StockAnalysisService {
  analyze(asset: Asset, prices: PriceData[]): StockAnalysis {
    if (asset.type !== 'stock') {
      throw new Error('仅支持股票资产分析');
    }

    const series = this.normalizeSeries(prices);
    if (series.length < 2) {
      throw new Error('历史价格不足，至少需要 2 个价格点。请先运行监控积累数据。');
    }

    const latest = series[series.length - 1].price;
    const previous = series[series.length - 2].price;
    const first = series[0].price;
    const shortWindow = series.slice(-Math.min(5, series.length)).map(p => p.price);
    const mediumWindow = series.slice(-Math.min(20, series.length)).map(p => p.price);
    const shortAvg = average(shortWindow);
    const mediumAvg = average(mediumWindow);
    const returns = this.returns(series);

    const changeLatest = pctChange(previous, latest);
    const changePeriod = pctChange(first, latest);
    const shortTrend = shortAvg ? pctChange(shortAvg, latest) : 0;
    const mediumTrend = mediumAvg ? pctChange(mediumAvg, latest) : 0;
    const volatility = stddev(returns);
    const maxDrawdown = this.maxDrawdown(series);

    const score = this.score({
      changeLatest,
      changePeriod,
      shortTrend,
      mediumTrend,
      volatility,
      maxDrawdown,
      dataPoints: series.length
    });
    const action = this.action(score);
    const confidence = this.confidence(series.length);
    const { reasons, risks } = this.explain({
      action,
      changeLatest,
      changePeriod,
      shortTrend,
      mediumTrend,
      volatility,
      maxDrawdown,
      dataPoints: series.length
    });

    return {
      assetId: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      score,
      action,
      confidence,
      latestPrice: latest,
      dataPoints: series.length,
      generatedAt: Date.now(),
      metrics: {
        changeLatest: metric('最新涨跌', changeLatest, '%', statusBySignedPct(changeLatest)),
        changePeriod: metric('区间涨跌', changePeriod, '%', statusBySignedPct(changePeriod, 1)),
        shortTrend: metric('短期趋势', shortTrend, '%', statusBySignedPct(shortTrend, 0.5)),
        mediumTrend: metric('中期趋势', mediumTrend, '%', statusBySignedPct(mediumTrend, 1)),
        volatility: metric('波动风险', volatility, '%', statusByRisk(volatility)),
        maxDrawdown: metric('最大回撤', maxDrawdown, '%', statusByRisk(maxDrawdown, 4, 12))
      },
      reasons,
      risks
    };
  }

  rank(assets: Asset[], pricesByAssetId: Map<string, PriceData[]>): StockAnalysis[] {
    return assets
      .filter(asset => asset.type === 'stock')
      .map(asset => {
        try {
          return this.analyze(asset, pricesByAssetId.get(asset.id) || []);
        } catch {
          return undefined;
        }
      })
      .filter((analysis): analysis is StockAnalysis => analysis !== undefined)
      .sort((a, b) => b.score - a.score);
  }

  private normalizeSeries(prices: PriceData[]): SeriesPoint[] {
    return prices
      .filter(price => Number.isFinite(price.price) && price.price > 0)
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((price, index, arr) => index === 0 || price.timestamp !== arr[index - 1].timestamp);
  }

  private returns(series: SeriesPoint[]): number[] {
    const values: number[] = [];
    for (let i = 1; i < series.length; i += 1) {
      values.push(pctChange(series[i - 1].price, series[i].price));
    }
    return values;
  }

  private maxDrawdown(series: SeriesPoint[]): number {
    let peak = series[0].price;
    let max = 0;
    for (const point of series) {
      peak = Math.max(peak, point.price);
      max = Math.max(max, peak > 0 ? ((peak - point.price) / peak) * 100 : 0);
    }
    return max;
  }

  private score(input: {
    changeLatest: number;
    changePeriod: number;
    shortTrend: number;
    mediumTrend: number;
    volatility: number;
    maxDrawdown: number;
    dataPoints: number;
  }): number {
    let score = 50;

    score += clamp(input.shortTrend * 2.2, -18, 18);
    score += clamp(input.mediumTrend * 1.5, -18, 18);
    score += clamp(input.changePeriod * 0.8, -15, 15);
    score += clamp(input.changeLatest * 1.2, -8, 8);
    score -= clamp(input.volatility * 2.5, 0, 18);
    score -= clamp(input.maxDrawdown * 0.9, 0, 18);

    if (input.dataPoints < 8) score -= 8;
    if (input.dataPoints >= 20) score += 4;

    return Math.round(clamp(score, 0, 100));
  }

  private action(score: number): RecommendationAction {
    if (score >= 70) return 'buy';
    if (score >= 50) return 'watch';
    return 'avoid';
  }

  private confidence(dataPoints: number): number {
    return Math.round(clamp((dataPoints / 30) * 100, 15, 100));
  }

  private explain(input: {
    action: RecommendationAction;
    changeLatest: number;
    changePeriod: number;
    shortTrend: number;
    mediumTrend: number;
    volatility: number;
    maxDrawdown: number;
    dataPoints: number;
  }): { reasons: string[]; risks: string[] } {
    const reasons: string[] = [];
    const risks: string[] = [];

    if (input.shortTrend > 0.5) reasons.push('价格强于短期均价，短线动量偏正。');
    if (input.mediumTrend > 1) reasons.push('价格强于中期均价，趋势结构较好。');
    if (input.changePeriod > 3) reasons.push('观察区间内累计涨幅为正，资金方向偏多。');
    if (input.volatility <= 2) reasons.push('近期波动较低，风险暴露相对可控。');
    if (input.action === 'buy' && reasons.length === 0) reasons.push('综合评分较高，具备继续跟踪的技术条件。');

    if (input.shortTrend < -0.5) risks.push('价格低于短期均价，短线趋势偏弱。');
    if (input.mediumTrend < -1) risks.push('价格低于中期均价，中期趋势仍需修复。');
    if (input.volatility >= 6) risks.push('近期波动偏高，仓位需要更保守。');
    if (input.maxDrawdown >= 12) risks.push('观察区间最大回撤较大，止损纪律很重要。');
    if (input.dataPoints < 8) risks.push('样本点偏少，建议继续监控后再提高判断权重。');
    if (risks.length === 0) risks.push('未发现明显技术风险，但仍需结合基本面和市场环境。');

    return { reasons, risks };
  }
}

export const stockAnalysisService = new StockAnalysisService();
