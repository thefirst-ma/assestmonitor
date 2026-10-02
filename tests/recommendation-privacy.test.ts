import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';

test('shared recommendations and readiness ignore users\' private assets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'investment-recommendation-privacy-'));
  process.env.DATABASE_DRIVER = 'sqljs';
  process.env.DATABASE_PATH = join(dir, 'test.db');
  process.env.JWT_SECRET = 'recommendation-privacy-integration-test';
  process.env.RECOMMENDATION_STOCK_POOL = 'AAPL';

  const { database } = await import('../src/database');
  const { RecommendationService, recommendationService } = await import('../src/services/recommendation');
  const { recommendationConfig } = await import('../src/config');
  const { app } = await import('../src/server');

  try {
    await database.init();
    const user = await database.createUser('private@example.com', 'test-password-hash');
    const assetId = `${user.id}:stock:PRIV`;
    await database.addAsset(assetId, user.id, 'stock', 'PRIV', 'PRIVATE_PORTFOLIO_ONLY');
    const now = Math.floor(Date.now() / 1000);
    for (let day = 0; day < 30; day++) {
      await database.savePrice({ assetId, price: 100 + day, timestamp: now - (29 - day) * 86400 });
    }

    const emptyPool = new RecommendationService({ ...recommendationConfig, stockPool: [], limit: 10 });
    const staged = await emptyPool.generateStagedRecommendations();
    assert.deepEqual(staged, { monthly: [], quarterly: [], yearly: [] });
    assert.deepEqual(await emptyPool.getDataReadiness(), []);

    const publicPool = new RecommendationService({ ...recommendationConfig, stockPool: ['AAPL', 'aapl'] });
    const scoredSymbols: string[] = [];
    (publicPool as any).scoreSymbol = async (symbol: string) => {
      scoredSymbols.push(symbol);
      return {
        rawScore: 75,
        recommendation: {
          symbol,
          name: 'Apple',
          score: 75,
          horizon: 'yearly',
          action: 'buy',
          reasons: [],
          risks: [],
          stageScores: { monthly: 75, quarterly: 75, yearly: 75 },
          strategicFactors: {},
          metrics: {}
        }
      };
    };
    const publicRecommendations = await publicPool.generateStagedRecommendations();
    assert.deepEqual(scoredSymbols, ['AAPL']);
    assert.deepEqual(publicRecommendations.yearly.map(item => item.symbol), ['AAPL']);
    const readiness = await publicPool.getDataReadiness();
    assert.deepEqual(readiness.map(item => ({ symbol: item.symbol, name: item.name })), [
      { symbol: 'AAPL', name: 'AAPL' }
    ]);
    assert.equal(JSON.stringify(readiness).includes('PRIVATE_PORTFOLIO_ONLY'), false);
    assert.equal(JSON.stringify(readiness).includes('PRIV'), false);
    assert.equal(readiness[0].pricePoints, 0);
    assert.ok(readiness[0].missing.includes('公开市场历史未核验'));

    const factor = { score: 60, label: '中性', summary: '' };
    const legacyRecommendation = (symbol: string, name: string) => ({
      symbol, name, score: 70, horizon: 'monthly' as const, action: 'watch' as const,
      reasons: [], risks: [],
      stageScores: { monthly: 70, quarterly: 70, yearly: 70 },
      strategicFactors: { moat: factor, leadership: factor, industryTrend: factor, policyImpact: factor },
      metrics: {}
    });
    await database.saveRecommendationRun({
      monthly: [
        legacyRecommendation('PRIV', 'PRIVATE_PORTFOLIO_ONLY'),
        legacyRecommendation('AAPL', 'PRIVATE_AAPL_ALIAS')
      ],
      quarterly: [], yearly: []
    }, 'legacy-test');

    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!);
    const originalGenerate = recommendationService.generateStagedRecommendations;
    recommendationService.generateStagedRecommendations = async () => ({ monthly: [], quarterly: [], yearly: [] });
    async function get(path: string) {
      const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
      return { status: response.status, data: await response.json() };
    }
    try {
      const latest = await get('/api/recommendations/latest');
      assert.equal(latest.status, 200);
      assert.deepEqual(latest.data.recommendations.monthly.map((item: { symbol: string; name: string }) => ({ symbol: item.symbol, name: item.name })), [
        { symbol: 'AAPL', name: 'AAPL' }
      ]);
      const history = await get('/api/recommendations/history');
      assert.equal(history.status, 200);
      assert.deepEqual(history.data.history.map((item: { symbol: string; name: string }) => ({ symbol: item.symbol, name: item.name })), [
        { symbol: 'AAPL', name: 'AAPL' }
      ]);
      assert.equal((await get('/api/recommendations/report/PRIV')).status, 404);
      const report = await get('/api/recommendations/report/AAPL');
      assert.equal(report.status, 200);
      assert.deepEqual(report.data.report.history.map((item: { symbol: string; name: string }) => ({ symbol: item.symbol, name: item.name })), [
        { symbol: 'AAPL', name: 'AAPL' }
      ]);
    } finally {
      recommendationService.generateStagedRecommendations = originalGenerate;
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
