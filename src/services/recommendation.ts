import axios, { AxiosRequestConfig } from 'axios';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { NotificationService } from './notifier';
import { config, proxyConfig, recommendationConfig } from '../config';
import { database } from '../database';
import {
  DataReadiness,
  FactorContribution,
  RecommendationAction,
  RecommendationConfig,
  RecommendationHorizon,
  ResearchProfile,
  StagedRecommendations,
  StockRecommendation,
  StrategicFactors
} from '../types';

interface YahooQuoteSummary {
  price?: {
    shortName?: string;
    longName?: string;
    regularMarketPrice?: YahooRawValue;
    marketCap?: YahooRawValue;
  };
  summaryDetail?: {
    trailingPE?: YahooRawValue;
    forwardPE?: YahooRawValue;
    dividendYield?: YahooRawValue;
  };
  defaultKeyStatistics?: {
    pegRatio?: YahooRawValue;
    priceToBook?: YahooRawValue;
  };
  financialData?: {
    profitMargins?: YahooRawValue;
    returnOnEquity?: YahooRawValue;
    revenueGrowth?: YahooRawValue;
    earningsGrowth?: YahooRawValue;
    debtToEquity?: YahooRawValue;
    freeCashflow?: YahooRawValue;
  };
}

interface YahooRawValue {
  raw?: number;
  fmt?: string;
}

interface PricePoint {
  close: number;
  timestamp: number;
}

interface ScoredCandidate {
  recommendation: StockRecommendation;
  rawScore: number;
}

const horizons: RecommendationHorizon[] = ['monthly', 'quarterly', 'yearly'];

const horizonLabels: Record<RecommendationHorizon, string> = {
  monthly: '月度',
  quarterly: '季度',
  yearly: '年度'
};

const researchProfiles: Record<string, Partial<StrategicFactors>> = {
  AAPL: {
    moat: { score: 92, label: '强', summary: '品牌、生态和高粘性设备用户构成核心护城河。' },
    leadership: { score: 82, label: '稳健', summary: '管理风格偏运营效率、供应链执行和资本回报。' },
    industryTrend: { score: 76, label: '中长期正向', summary: '端侧AI、服务收入和硬件升级周期提供长期变量。' },
    policyImpact: { score: 64, label: '中性偏压', summary: '反垄断、关税和供应链区域化仍需跟踪。' }
  },
  MSFT: {
    moat: { score: 94, label: '强', summary: '企业软件、云平台和开发者生态形成高切换成本。' },
    leadership: { score: 90, label: '优秀', summary: '管理层长期聚焦云、AI和平台化扩张。' },
    industryTrend: { score: 90, label: '强正向', summary: 'AI基础设施、企业软件和云迁移仍处于长期扩张线。' },
    policyImpact: { score: 68, label: '中性', summary: '大型科技监管存在约束，但业务分散度较高。' }
  },
  NVDA: {
    moat: { score: 92, label: '强', summary: 'GPU生态、CUDA软件栈和客户锁定构成核心壁垒。' },
    leadership: { score: 88, label: '进取', summary: '负责人技术视野强，战略节奏偏前瞻。' },
    industryTrend: { score: 96, label: '强正向', summary: 'AI算力需求是最明确的长期产业趋势之一。' },
    policyImpact: { score: 58, label: '偏敏感', summary: '出口管制、供应链和客户资本开支周期需要重点跟踪。' }
  },
  GOOGL: {
    moat: { score: 90, label: '强', summary: '搜索、广告、数据和AI研发形成深护城河。' },
    leadership: { score: 78, label: '稳健', summary: '负责人技术背景强，但组织效率和产品落地需持续观察。' },
    industryTrend: { score: 86, label: '正向', summary: 'AI搜索、云和广告自动化仍有长期空间。' },
    policyImpact: { score: 55, label: '偏敏感', summary: '反垄断和隐私监管是长期估值约束。' }
  },
  JNJ: {
    moat: { score: 84, label: '强', summary: '医疗品牌、渠道、研发和多元产品线增强防御性。' },
    leadership: { score: 76, label: '稳健', summary: '管理风格偏稳健经营和组合优化。' },
    industryTrend: { score: 72, label: '稳定', summary: '老龄化和医疗需求长期稳定，但成长弹性有限。' },
    policyImpact: { score: 66, label: '中性', summary: '药价、诉讼和监管节奏仍需跟踪。' }
  },
  JPM: {
    moat: { score: 86, label: '强', summary: '规模、存款基础、风控能力和综合金融网络构成优势。' },
    leadership: { score: 86, label: '强', summary: '负责人风控意识和周期管理能力突出。' },
    industryTrend: { score: 68, label: '周期中性', summary: '利率、信贷周期和资本市场活跃度决定中期弹性。' },
    policyImpact: { score: 58, label: '偏敏感', summary: '资本监管、利率政策和金融监管影响较大。' }
  }
};

const execFileAsync = promisify(execFile);

function rawNumber(value?: YahooRawValue): number | undefined {
  return typeof value?.raw === 'number' && Number.isFinite(value.raw) ? value.raw : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scoreRange(value: number | undefined, best: number, worst: number, reverse = false): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  const ratio = reverse ? (worst - value) / (worst - best) : (value - worst) / (best - worst);
  return clamp(ratio, 0, 1);
}

function scoreOrDefault(value: number | undefined, points: number, fallbackRatio: number, best: number, worst: number, reverse = false): number {
  if (value === undefined || !Number.isFinite(value)) return points * fallbackRatio;
  return scoreRange(value, best, worst, reverse) * points;
}

function pct(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

function money(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return 'n/a';
  if (Math.abs(value) >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(1)}T`;
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${value.toFixed(0)}`;
}

function applyProxy(request: AxiosRequestConfig): AxiosRequestConfig {
  if (proxyConfig.enabled) {
    request.proxy = {
      host: proxyConfig.host,
      port: proxyConfig.port,
      protocol: 'http'
    };
  }
  return request;
}

async function yahooGet<T>(url: string, params?: Record<string, string | number>): Promise<T> {
  const response = await axios(applyProxy({
    url,
    params,
    timeout: 20000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Connection: 'keep-alive'
    }
  }));
  return response.data as T;
}

async function yahooGetWithWindowsFallback<T>(url: string, params?: Record<string, string | number>): Promise<T> {
  try {
    return await yahooGet<T>(url, params);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    const fullUrl = new URL(url);
    for (const [key, value] of Object.entries(params || {})) {
      fullUrl.searchParams.set(key, String(value));
    }
    const quotedUrl = JSON.stringify(fullUrl.toString());
    const command = [
      `$Url = ${quotedUrl};`,
      '$ProgressPreference = "SilentlyContinue";',
      '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;',
      '$r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Uri $Url;',
      '$r.Content'
    ].join(' ');
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { maxBuffer: 20 * 1024 * 1024 }
    );
    return JSON.parse(stdout) as T;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = [];
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));
  return results;
}

export class RecommendationService {
  constructor(private readonly cfg: RecommendationConfig = recommendationConfig) {}

  async generateDailyRecommendations(): Promise<StockRecommendation[]> {
    const staged = await this.generateStagedRecommendations();
    return staged.yearly;
  }

  async generateStagedRecommendations(): Promise<StagedRecommendations> {
    const settled = await mapWithConcurrency(this.cfg.stockPool, 5, symbol => this.scoreSymbol(symbol));

    const allOnlineCandidates = settled
      .filter((result): result is PromiseFulfilledResult<ScoredCandidate> => result.status === 'fulfilled')
      .map(result => result.value)
      .sort((a, b) => b.rawScore - a.rawScore);

    const allLocalCandidates = await this.generateLocalRecommendations();

    const merged = new Map<string, ScoredCandidate>();
    for (const item of [...allOnlineCandidates, ...allLocalCandidates]) {
      const previous = merged.get(item.recommendation.symbol);
      if (!previous || item.rawScore > previous.rawScore) merged.set(item.recommendation.symbol, item);
    }

    const base = Array.from(merged.values()).map(item => item.recommendation);

    return horizons.reduce((acc, horizon) => {
      acc[horizon] = base
        .map(item => this.forHorizon(item, horizon))
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(this.cfg.limit, 1))
        .map(item => {
          if (item.score < this.cfg.minScore) {
            return {
              ...item,
              risks: [...item.risks, `低于最低推荐分${this.cfg.minScore}，仅作观察候选`]
            };
          }
          return item;
        });
      return acc;
    }, { monthly: [], quarterly: [], yearly: [] } as StagedRecommendations);
  }

  async generateAndSaveRecommendations(source = 'manual'): Promise<{ runId: string; recommendations: StagedRecommendations }> {
    const recommendations = await this.generateStagedRecommendations();
    const run = await database.saveRecommendationRun(recommendations, source);
    return { runId: run.id, recommendations };
  }

  async getDataReadiness(): Promise<DataReadiness[]> {
    const assets = (await database.getEnabledAssets()).filter(asset => asset.type === 'stock');
    const assetsBySymbol = new Map(assets.map(asset => [asset.symbol.toUpperCase(), asset]));
    const symbols = Array.from(new Set([
      ...this.cfg.stockPool.map(symbol => symbol.toUpperCase()),
      ...assets.map(asset => asset.symbol.toUpperCase())
    ])).sort();

    const rows: DataReadiness[] = [];
    for (const symbol of symbols) {
      const asset = assetsBySymbol.get(symbol);
      const isBuiltInPool = this.cfg.stockPool.map(item => item.toUpperCase()).includes(symbol);
      const pricePoints = asset ? (await database.getLastNPrices(asset.id, 260)).length : isBuiltInPool ? 260 : 0;
      const savedProfile = await database.getResearchProfile(symbol);
      const builtInProfile = researchProfiles[symbol];
      const profile = savedProfile || builtInProfile;
      const hasMoat = !!profile?.moat?.summary;
      const hasLeadership = !!profile?.leadership?.summary;
      const hasIndustryTrend = !!profile?.industryTrend?.summary;
      const hasPolicyImpact = !!profile?.policyImpact?.summary;
      const missing: string[] = [];
      if (pricePoints < 80) missing.push('长期价格数据不足');
      if (!hasMoat) missing.push('护城河档案缺失');
      if (!hasLeadership) missing.push('负责人档案缺失');
      if (!hasIndustryTrend) missing.push('行业趋势档案缺失');
      if (!hasPolicyImpact) missing.push('政策影响档案缺失');

      const readinessScore =
        (pricePoints >= 200 ? 30 : pricePoints >= 80 ? 22 : pricePoints >= 30 ? 12 : 0) +
        (hasMoat ? 18 : 0) +
        (hasLeadership ? 16 : 0) +
        (hasIndustryTrend ? 18 : 0) +
        (hasPolicyImpact ? 18 : 0);

      rows.push({
        symbol,
        name: asset?.name || symbol,
        pricePoints,
        hasResearchProfile: !!profile,
        hasMoat,
        hasLeadership,
        hasIndustryTrend,
        hasPolicyImpact,
        readinessScore,
        missing
      });
    }
    return rows.sort((a, b) => a.readinessScore - b.readinessScore || a.symbol.localeCompare(b.symbol));
  }

  async getStockReport(symbol: string): Promise<{
    symbol: string;
    recommendations: Partial<StagedRecommendations>;
    readiness?: DataReadiness;
    researchProfile?: ResearchProfile;
    history: Awaited<ReturnType<typeof database.getRecommendationHistoryBySymbol>>;
  }> {
    const normalized = symbol.toUpperCase();
    const staged = await this.generateStagedRecommendations();
    const recommendations: Partial<StagedRecommendations> = {};
    for (const horizon of horizons) {
      const item = staged[horizon].find(rec => rec.symbol.toUpperCase() === normalized);
      if (item) recommendations[horizon] = [item];
    }
    return {
      symbol: normalized,
      recommendations,
      readiness: (await this.getDataReadiness()).find(item => item.symbol === normalized),
      researchProfile: await database.getResearchProfile(normalized),
      history: await database.getRecommendationHistoryBySymbol(normalized)
    };
  }

  async sendDailyTelegramReport(): Promise<void> {
    const recommendations = await this.generateStagedRecommendations();
    await this.sendTelegramReport(recommendations);
  }

  async sendTelegramReport(recommendations: StagedRecommendations): Promise<void> {
    const notifier = new NotificationService(config.notifications);
    const message = this.formatTelegramReport(recommendations);
    await notifier.sendTelegramMessage(message, 'long-term stock recommendations');
  }

  formatTelegramReport(recommendations: StagedRecommendations | StockRecommendation[]): string {
    const staged: StagedRecommendations = Array.isArray(recommendations)
      ? { monthly: recommendations, quarterly: recommendations, yearly: recommendations }
      : recommendations;
    const date = new Date().toLocaleDateString('zh-CN', {
      timeZone: this.cfg.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    if (horizons.every(h => staged[h].length === 0)) {
      return [
        `长期股票推荐日报 ${date}`,
        '',
        '今天没有生成候选股票。',
        '这通常意味着外部行情源不可用，且本地监控数据还不够。'
      ].join('\n');
    }

    const lines = [
      `长期股票推荐日报 ${date}`,
      '',
      '规则: 分为月度、季度、年度三阶段；重点考虑护城河、负责人、行业趋势、政策影响；非短线买卖信号。',
      `候选池: ${this.cfg.stockPool.length} 只；每阶段最多 ${this.cfg.limit} 只。`,
      ''
    ];

    horizons.forEach(horizon => {
      lines.push(`${horizonLabels[horizon]}推荐`);
      staged[horizon].forEach((item, index) => {
        const m = item.metrics;
        lines.push(`${index + 1}. ${item.symbol} - ${item.name} | ${item.score}/100 | ${item.action}`);
        lines.push(`现价: ${item.price?.toFixed(2) ?? 'n/a'} | 1年: ${pct(m.oneYearReturn)} | 3月: ${pct(m.threeMonthReturn)} | 回撤: ${pct(m.drawdownFromHigh)}`);
        lines.push(`护城河: ${item.strategicFactors.moat.label} ${item.strategicFactors.moat.score} | 负责人: ${item.strategicFactors.leadership.label} ${item.strategicFactors.leadership.score}`);
        lines.push(`行业: ${item.strategicFactors.industryTrend.label} ${item.strategicFactors.industryTrend.score} | 政策: ${item.strategicFactors.policyImpact.label} ${item.strategicFactors.policyImpact.score}`);
        lines.push(`推荐理由: ${item.reasons.join('；') || '综合评分靠前'}`);
        if (item.risks.length > 0) lines.push(`主要风险: ${item.risks.join('；')}`);
      });
      lines.push('');
    });

    lines.push('使用方式: 月度用于调仓观察，季度用于加减仓评估，年度用于核心持仓候选。请结合仓位、行业分散和个人风险承受能力。');
    return lines.join('\n');
  }

  private forHorizon(item: StockRecommendation, horizon: RecommendationHorizon): StockRecommendation {
    const score = Math.round(item.stageScores[horizon]);
    return {
      ...item,
      horizon,
      score,
      action: this.actionForScore(score)
    };
  }

  private async createRecommendation(input: {
    symbol: string;
    name: string;
    price?: number;
    marketCap?: number;
    rawScore: number;
    reasons: string[];
    risks: string[];
    metrics: StockRecommendation['metrics'];
  }): Promise<StockRecommendation> {
    const strategicFactors = await this.buildStrategicFactors(input.symbol, input.metrics, input.marketCap);
    const factorContributions = await this.buildFactorContributions(input.symbol, strategicFactors);
    const stageScores = this.buildStageScores(input.rawScore, input.metrics, strategicFactors, factorContributions);
    const horizon: RecommendationHorizon = 'yearly';
    const score = Math.round(stageScores[horizon]);

    return {
      symbol: input.symbol,
      name: input.name,
      score,
      horizon,
      action: this.actionForScore(score),
      price: input.price,
      marketCap: input.marketCap,
      reasons: this.enrichReasons(input.reasons, strategicFactors),
      risks: this.enrichRisks(input.risks, strategicFactors),
      stageScores,
      strategicFactors,
      factorContributions,
      metrics: input.metrics
    };
  }

  private async buildFactorContributions(symbol: string, strategicFactors: StrategicFactors): Promise<FactorContribution[]> {
    const factors = await database.getRecommendationFactors(false);
    const valueMap = new Map(
      (await database.getStockFactorValues(symbol.toUpperCase())).map(value => [value.factorId, value])
    );
    const totalWeight = factors.reduce((sum, factor) => sum + Math.max(0, factor.weight), 0) || 1;
    const strategicMap: Record<string, { score: number; label: string; summary: string } | undefined> = {
      moat: strategicFactors.moat,
      leadership: strategicFactors.leadership,
      industryTrend: strategicFactors.industryTrend,
      policyImpact: strategicFactors.policyImpact
    };

    return factors.map(factor => {
      const override = valueMap.get(factor.id);
      const fallback = strategicMap[factor.id] || {
        score: 60,
        label: '待研究',
        summary: '该因子尚未填写，当前按中性分处理。'
      };
      const score = clamp(Number(override?.score ?? fallback.score), 0, 100);
      const weight = Math.max(0, Number(factor.weight));
      return {
        factorId: factor.id,
        name: factor.name,
        weight,
        score: Math.round(score),
        contribution: Number(((score * weight) / totalWeight).toFixed(2)),
        label: override?.label || fallback.label,
        summary: override?.summary || fallback.summary
      };
    });
  }

  private async buildStrategicFactors(symbol: string, metrics: StockRecommendation['metrics'], marketCap?: number): Promise<StrategicFactors> {
    const saved = await database.getResearchProfile(symbol.toUpperCase());
    const profile: Partial<StrategicFactors> = saved
      ? {
          moat: saved.moat,
          leadership: saved.leadership,
          industryTrend: saved.industryTrend,
          policyImpact: saved.policyImpact
        }
      : researchProfiles[symbol.toUpperCase()] || {};
    const marketCapScore = marketCap ? clamp(45 + Math.log10(Math.max(marketCap, 1_000_000_000) / 1_000_000_000) * 13, 35, 88) : 62;
    const trendScore = clamp(55 + ((metrics.oneYearReturn || 0) * 60) + ((metrics.threeMonthReturn || 0) * 35), 25, 92);
    const policyBase = clamp(72 - Math.max(0, (metrics.volatility || 0.25) - 0.25) * 35, 35, 82);

    return {
      moat: profile.moat || {
        score: Math.round(marketCapScore),
        label: marketCapScore >= 75 ? '较强' : marketCapScore >= 58 ? '中等' : '待验证',
        summary: '暂无人工研究档案，先用规模、价格韧性和长期稳定性近似评估护城河。'
      },
      leadership: profile.leadership || {
        score: 60,
        label: '待研究',
        summary: '负责人特点需要补充人工研究档案；当前按中性处理。'
      },
      industryTrend: profile.industryTrend || {
        score: Math.round(trendScore),
        label: trendScore >= 75 ? '正向' : trendScore >= 55 ? '中性' : '承压',
        summary: '暂无行业研究档案，先用一年和三个月价格趋势近似行业景气度。'
      },
      policyImpact: profile.policyImpact || {
        score: Math.round(policyBase),
        label: policyBase >= 70 ? '相对友好' : policyBase >= 55 ? '中性' : '偏敏感',
        summary: '暂无政策研究档案，先按波动和行业敏感度中性估计。'
      }
    };
  }

  private buildStageScores(
    baseScore: number,
    metrics: StockRecommendation['metrics'],
    strategicFactors: StrategicFactors,
    factorContributions?: FactorContribution[]
  ): Record<RecommendationHorizon, number> {
    const trendScore = clamp(
      55 +
        (metrics.threeMonthReturn || 0) * 80 +
        (metrics.distanceToSma200 || 0) * 45 -
        Math.max(0, (metrics.volatility || 0.25) - 0.25) * 25,
      0,
      100
    );
    const fundamentalScore = clamp(baseScore, 0, 100);
    const strategicScore = factorContributions && factorContributions.length > 0
      ? factorContributions.reduce((sum, item) => sum + item.contribution, 0)
      : (
          strategicFactors.moat.score * 0.34 +
          strategicFactors.leadership.score * 0.22 +
          strategicFactors.industryTrend.score * 0.28 +
          strategicFactors.policyImpact.score * 0.16
        );

    return {
      monthly: clamp(trendScore * 0.45 + fundamentalScore * 0.25 + strategicScore * 0.30, 0, 100),
      quarterly: clamp(trendScore * 0.25 + fundamentalScore * 0.35 + strategicScore * 0.40, 0, 100),
      yearly: clamp(trendScore * 0.15 + fundamentalScore * 0.25 + strategicScore * 0.60, 0, 100)
    };
  }

  private enrichReasons(reasons: string[], strategicFactors: StrategicFactors): string[] {
    const enriched = [...reasons];
    if (strategicFactors.moat.score >= 75) enriched.push(`护城河${strategicFactors.moat.label}`);
    if (strategicFactors.leadership.score >= 80) enriched.push(`负责人特点评分较高`);
    if (strategicFactors.industryTrend.score >= 75) enriched.push(`行业趋势${strategicFactors.industryTrend.label}`);
    if (strategicFactors.policyImpact.score >= 70) enriched.push(`政策环境相对友好`);
    return Array.from(new Set(enriched)).slice(0, 6);
  }

  private enrichRisks(risks: string[], strategicFactors: StrategicFactors): string[] {
    const enriched = [...risks];
    if (strategicFactors.leadership.score <= 60) enriched.push('负责人特点尚未建立研究档案');
    if (strategicFactors.policyImpact.score < 60) enriched.push('政策影响偏敏感');
    if (strategicFactors.industryTrend.score < 55) enriched.push('行业趋势承压');
    return Array.from(new Set(enriched)).slice(0, 6);
  }

  private actionForScore(score: number): RecommendationAction {
    if (score >= 72) return 'buy';
    if (score >= 55) return 'watch';
    return 'avoid';
  }

  private async scoreSymbol(symbol: string): Promise<ScoredCandidate> {
    const [summary, prices] = await Promise.all([
      this.fetchQuoteSummary(symbol).catch(() => undefined),
      this.fetchPriceHistory(symbol)
    ]);

    if (prices.length < 80) {
      throw new Error(`Not enough price history for ${symbol}`);
    }

    const latest = prices[prices.length - 1].close;
    const name = summary?.price?.longName || summary?.price?.shortName || symbol;
    const metrics = this.buildMetrics(summary, prices);
    const { rawScore, reasons, risks } = this.scoreMetrics(metrics);

    const marketCap = rawNumber(summary?.price?.marketCap);
    const recommendation = await this.createRecommendation({
      symbol,
      name,
      rawScore,
      price: rawNumber(summary?.price?.regularMarketPrice) ?? latest,
      marketCap,
      reasons,
      risks,
      metrics
    });

    return { rawScore, recommendation };
  }

  private async generateLocalRecommendations(): Promise<ScoredCandidate[]> {
    try {
      return (await Promise.all((await database.getEnabledAssets())
        .filter(asset => asset.type === 'stock')
        .map(async (asset): Promise<ScoredCandidate | undefined> => {
          const prices = (await database.getLastNPrices(asset.id, 260))
            .map(price => ({ close: price.price, timestamp: price.timestamp }))
            .filter(point => Number.isFinite(point.close) && point.close > 0);

          if (prices.length < 30) return undefined;

          const metrics = this.buildMetrics(undefined, prices);
          const { rawScore, reasons, risks } = this.scoreMetrics(metrics);
          reasons.unshift('基于本地长期监控数据');

          return {
            rawScore,
            recommendation: await this.createRecommendation({
              symbol: asset.symbol,
              name: asset.name,
              rawScore,
              price: prices[prices.length - 1].close,
              reasons,
              risks,
              metrics
            })
          };
        })))
        .filter((item): item is ScoredCandidate => item !== undefined);
    } catch {
      return [];
    }
  }

  private async fetchQuoteSummary(symbol: string): Promise<YahooQuoteSummary | undefined> {
    const modules = 'price,summaryDetail,defaultKeyStatistics,financialData';
    const data = await yahooGet<any>(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
      { modules }
    );
    return data?.quoteSummary?.result?.[0] as YahooQuoteSummary | undefined;
  }

  private async fetchPriceHistory(symbol: string): Promise<PricePoint[]> {
    const data = await yahooGetWithWindowsFallback<any>(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
      { interval: '1d', range: '1y' }
    );
    const result = data?.chart?.result?.[0];
    const timestamps: number[] = result?.timestamp || [];
    const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close || [];

    return timestamps
      .map((timestamp, index) => ({ timestamp, close: closes[index] }))
      .filter((point): point is PricePoint => typeof point.close === 'number' && Number.isFinite(point.close));
  }

  private buildMetrics(summary: YahooQuoteSummary | undefined, prices: PricePoint[]): StockRecommendation['metrics'] {
    const latest = prices[prices.length - 1].close;
    const first = prices[0].close;
    const threeMonthAgo = prices[Math.max(0, prices.length - 63)].close;
    const closes = prices.map(p => p.close);
    const sma200Window = closes.slice(-200);
    const sma200 = sma200Window.reduce((sum, close) => sum + close, 0) / sma200Window.length;
    const high = Math.max(...closes);
    const returns = closes.slice(1).map((close, index) => (close - closes[index]) / closes[index]);
    const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / Math.max(1, returns.length);
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / Math.max(1, returns.length);

    return {
      trailingPE: rawNumber(summary?.summaryDetail?.trailingPE),
      forwardPE: rawNumber(summary?.summaryDetail?.forwardPE),
      pegRatio: rawNumber(summary?.defaultKeyStatistics?.pegRatio),
      priceToBook: rawNumber(summary?.defaultKeyStatistics?.priceToBook),
      dividendYield: rawNumber(summary?.summaryDetail?.dividendYield),
      profitMargins: rawNumber(summary?.financialData?.profitMargins),
      returnOnEquity: rawNumber(summary?.financialData?.returnOnEquity),
      revenueGrowth: rawNumber(summary?.financialData?.revenueGrowth),
      earningsGrowth: rawNumber(summary?.financialData?.earningsGrowth),
      debtToEquity: rawNumber(summary?.financialData?.debtToEquity),
      freeCashflow: rawNumber(summary?.financialData?.freeCashflow),
      oneYearReturn: (latest - first) / first,
      threeMonthReturn: (latest - threeMonthAgo) / threeMonthAgo,
      volatility: Math.sqrt(variance) * Math.sqrt(252),
      distanceToSma200: (latest - sma200) / sma200,
      drawdownFromHigh: (latest - high) / high
    };
  }

  private scoreMetrics(metrics: StockRecommendation['metrics']): { rawScore: number; reasons: string[]; risks: string[] } {
    const reasons: string[] = [];
    const risks: string[] = [];

    const quality =
      scoreOrDefault(metrics.returnOnEquity, 12, 0.50, 0.25, 0.03) +
      scoreOrDefault(metrics.profitMargins, 10, 0.50, 0.25, 0.03) +
      (metrics.freeCashflow === undefined ? 2.5 : metrics.freeCashflow > 0 ? 5 : 0) +
      scoreOrDefault(metrics.debtToEquity, 3, 0.50, 40, 220, true);

    const growth =
      scoreOrDefault(metrics.revenueGrowth, 10, 0.50, 0.25, -0.05) +
      scoreOrDefault(metrics.earningsGrowth, 10, 0.50, 0.25, -0.10);

    const valuation =
      this.scoreValuation(metrics.trailingPE, metrics.forwardPE, metrics.pegRatio, metrics.priceToBook, metrics.dividendYield);

    const safety =
      scoreOrDefault(metrics.debtToEquity, 7, 0.50, 30, 250, true) +
      scoreOrDefault(metrics.volatility, 5, 0.50, 0.18, 0.65, true) +
      (metrics.drawdownFromHigh !== undefined && metrics.drawdownFromHigh > -0.35 ? 3 : 0);

    const trend =
      scoreRange(metrics.distanceToSma200, 0.15, -0.20) * 4 +
      scoreRange(metrics.oneYearReturn, 0.30, -0.20) * 4 +
      scoreRange(metrics.threeMonthReturn, 0.12, -0.15) * 2;

    let rawScore = quality + growth + valuation + safety + trend;

    if (metrics.returnOnEquity !== undefined && metrics.returnOnEquity >= 0.15) reasons.push('ROE较高');
    if (metrics.profitMargins !== undefined && metrics.profitMargins >= 0.15) reasons.push('盈利能力强');
    if (metrics.freeCashflow !== undefined && metrics.freeCashflow > 0) reasons.push('自由现金流为正');
    if (metrics.revenueGrowth !== undefined && metrics.revenueGrowth >= 0.08) reasons.push('收入仍在增长');
    if (metrics.forwardPE !== undefined && metrics.forwardPE > 0 && metrics.forwardPE <= 25) reasons.push('远期估值可接受');
    if (metrics.distanceToSma200 !== undefined && metrics.distanceToSma200 >= -0.05) reasons.push('长期趋势未明显破坏');

    if (metrics.trailingPE !== undefined && metrics.trailingPE > 45) risks.push('静态PE偏高');
    if (metrics.forwardPE !== undefined && metrics.forwardPE > 40) risks.push('远期PE偏高');
    if (metrics.debtToEquity !== undefined && metrics.debtToEquity > 180) risks.push('负债水平偏高');
    if (metrics.volatility !== undefined && metrics.volatility > 0.55) risks.push('波动较大');
    if (metrics.drawdownFromHigh !== undefined && metrics.drawdownFromHigh < -0.35) risks.push('距离一年高点回撤较深');
    if (metrics.distanceToSma200 !== undefined && metrics.distanceToSma200 < -0.15) risks.push('价格低于200日均线较多');

    rawScore -= risks.length * 2;

    return { rawScore: clamp(rawScore, 0, 100), reasons, risks };
  }

  private scoreValuation(
    trailingPE?: number,
    forwardPE?: number,
    pegRatio?: number,
    priceToBook?: number,
    dividendYield?: number
  ): number {
    let score = 0;
    score += trailingPE && trailingPE > 0 ? scoreRange(trailingPE, 12, 45, true) * 6 : 3;
    score += forwardPE && forwardPE > 0 ? scoreRange(forwardPE, 10, 35, true) * 6 : 3;
    score += pegRatio && pegRatio > 0 ? scoreRange(pegRatio, 0.8, 3.0, true) * 4 : 2;
    score += priceToBook && priceToBook > 0 ? scoreRange(priceToBook, 1.5, 10, true) * 2 : 1;
    score += dividendYield && dividendYield > 0 ? scoreRange(dividendYield, 0.04, 0.0) * 2 : 0;
    return score;
  }
}

export const recommendationService = new RecommendationService();
