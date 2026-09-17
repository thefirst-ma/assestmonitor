export type AssetType = 'crypto' | 'stock' | 'metal' | 'forex';
export type UserPlan = 'free' | 'pro';

export const PLAN_LIMITS: Record<UserPlan, number> = {
  free: 10,
  pro: 100
};

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  plan: UserPlan;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  createdAt: number;
}

export interface Asset {
  id: string;
  userId: string;
  type: AssetType;
  symbol: string;
  name: string;
  enabled: boolean;
  interval?: number;
  threshold?: number;
}

export interface PriceData {
  assetId: string;
  price: number;
  timestamp: number;
}

export type RecommendationAction = 'buy' | 'watch' | 'avoid';

export interface StockAnalysisMetric {
  label: string;
  value: number | null;
  unit: '%' | 'price' | 'score';
  status: 'positive' | 'neutral' | 'negative';
}

export interface StockAnalysis {
  assetId: string;
  symbol: string;
  name: string;
  score: number;
  action: RecommendationAction;
  confidence: number;
  latestPrice: number;
  dataPoints: number;
  generatedAt: number;
  metrics: {
    changeLatest: StockAnalysisMetric;
    changePeriod: StockAnalysisMetric;
    shortTrend: StockAnalysisMetric;
    mediumTrend: StockAnalysisMetric;
    volatility: StockAnalysisMetric;
    maxDrawdown: StockAnalysisMetric;
  };
  reasons: string[];
  risks: string[];
}

export interface PriceAlert {
  assetId: string;
  assetName: string;
  assetType: AssetType;
  /** 展示用，合并 Telegram 时作为标的标识 */
  symbol?: string;
  oldPrice: number;
  newPrice: number;
  changePercent: number;
  timestamp: number;
}

export interface NotificationConfig {
  email?: {
    enabled: boolean;
    host: string;
    port: number;
    user: string;
    pass: string;
    to: string;
  };
  webhook?: {
    enabled: boolean;
    url: string;
    type: 'dingtalk' | 'wecom' | 'custom';
  };
  telegram?: {
    enabled: boolean;
    botToken: string;
    chatId: string;
    proxyHost?: string;
    proxyPort?: number;
  };
}

export interface MonitorConfig {
  interval: number;
  threshold: number;
  notifications: NotificationConfig;
}

export interface StockRecommendation {
  symbol: string;
  name: string;
  score: number;
  horizon: RecommendationHorizon;
  action: RecommendationAction;
  price?: number;
  marketCap?: number;
  reasons: string[];
  risks: string[];
  stageScores: Record<RecommendationHorizon, number>;
  strategicFactors: StrategicFactors;
  factorContributions?: FactorContribution[];
  metrics: {
    trailingPE?: number;
    forwardPE?: number;
    pegRatio?: number;
    priceToBook?: number;
    dividendYield?: number;
    profitMargins?: number;
    returnOnEquity?: number;
    revenueGrowth?: number;
    earningsGrowth?: number;
    debtToEquity?: number;
    freeCashflow?: number;
    oneYearReturn?: number;
    threeMonthReturn?: number;
    volatility?: number;
    distanceToSma200?: number;
    drawdownFromHigh?: number;
  };
}

export type RecommendationHorizon = 'monthly' | 'quarterly' | 'yearly';

export interface StrategicFactor {
  score: number;
  label: string;
  summary: string;
}

export interface StrategicFactors {
  moat: StrategicFactor;
  leadership: StrategicFactor;
  industryTrend: StrategicFactor;
  policyImpact: StrategicFactor;
}

export interface RecommendationConfig {
  enabled: boolean;
  hour: number;
  minute: number;
  timezone: string;
  limit: number;
  minScore: number;
  stockPool: string[];
  runOnStart: boolean;
}

export interface ResearchProfile {
  symbol: string;
  moat: StrategicFactor;
  leadership: StrategicFactor;
  industryTrend: StrategicFactor;
  policyImpact: StrategicFactor;
  confidence: number;
  notes: string;
  updatedAt: number;
}

export interface DataReadiness {
  symbol: string;
  name: string;
  pricePoints: number;
  hasResearchProfile: boolean;
  hasMoat: boolean;
  hasLeadership: boolean;
  hasIndustryTrend: boolean;
  hasPolicyImpact: boolean;
  readinessScore: number;
  missing: string[];
}

export interface RecommendationRun {
  id: string;
  generatedAt: number;
  source: string;
}

export interface RecommendationHistoryItem {
  runId: string;
  generatedAt: number;
  source: string;
  horizon: RecommendationHorizon;
  symbol: string;
  name: string;
  score: number;
  action: RecommendationAction;
  price?: number;
  factorContributions?: FactorContribution[];
  reviewOutcome?: ReviewOutcome;
  reviewReason?: string;
  actualReturn?: number;
  reviewedAt?: number;
}

export type StagedRecommendations = Record<RecommendationHorizon, StockRecommendation[]>;

export interface RecommendationFactor {
  id: string;
  name: string;
  description: string;
  weight: number;
  enabled: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface StockFactorValue {
  symbol: string;
  factorId: string;
  score: number;
  label: string;
  summary: string;
  updatedAt: number;
}

export interface FactorContribution {
  factorId: string;
  name: string;
  weight: number;
  score: number;
  contribution: number;
  label: string;
  summary: string;
}

export type ReviewOutcome = 'accurate' | 'inaccurate' | 'mixed' | 'pending';

export interface RecommendationReview {
  runId: string;
  symbol: string;
  horizon: RecommendationHorizon;
  outcome: ReviewOutcome;
  reason: string;
  actualReturn?: number;
  reviewedAt: number;
}
