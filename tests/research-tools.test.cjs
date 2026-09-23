const { test } = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../public/research-tools');

test('risk distinguishes missing data from low volatility and retains known high risk', () => {
  assert.equal(tools.risk({}).level, 'unknown');
  assert.equal(tools.risk({ metrics: { volatility: null, drawdownFromHigh: 0 } }).level, 'unknown');
  assert.equal(tools.risk({ metrics: { volatility: .55 } }).level, 'high');
  assert.equal(tools.risk({ metrics: { volatility: .15, drawdownFromHigh: -.3 } }).level, 'high');
  assert.equal(tools.risk({ metrics: { volatility: .3, drawdownFromHigh: -.05 } }).level, 'medium');
  assert.equal(tools.risk({ metrics: { volatility: .2, drawdownFromHigh: -.05 } }).level, 'low');
});

test('recommendation filters combine horizon, score, action, risk and query', () => {
  const rows = [
    { symbol: 'AAPL', name: 'Apple', horizon: 'yearly', action: 'buy', score: 85, metrics: { volatility: .2, drawdownFromHigh: -.1 } },
    { symbol: 'AAPL', name: 'Apple', horizon: 'monthly', action: 'watch', score: 68, metrics: {} },
    { symbol: 'MSFT', name: 'Microsoft', horizon: 'yearly', action: 'buy', score: 80, metrics: {} }
  ];
  assert.equal(tools.filterRecommendations(rows, { query: 'apple', horizon: 'yearly', action: 'buy', minScore: 80, risk: 'low' }).length, 1);
  assert.equal(tools.filterRecommendations(rows, { minScore: 99 }).length, 0);
  assert.equal(tools.filterRecommendations(rows, { sort: 'volatility' })[0].symbol, 'AAPL');
  assert.equal(rows[0].score, 85);
});

test('review statistics exclude pending and missing returns, keep partial accuracy separate', () => {
  const rows = [
    { reviewOutcome: 'accurate', actualReturn: 10 },
    { reviewOutcome: 'inaccurate', actualReturn: -4 },
    { reviewOutcome: 'mixed', actualReturn: 0 },
    { reviewOutcome: 'pending', actualReturn: 999 },
    { reviewOutcome: 'accurate', actualReturn: null },
    { reviewOutcome: 'accurate' }
  ];
  const stats = tools.reviewSummary(rows, 30);
  assert.equal(stats.reviewed, 5);
  assert.equal(stats.accuracy, 60);
  assert.equal(stats.mixed, 1);
  assert.equal(stats.returnSamples, 3);
  assert.equal(stats.meanReturn, 2);
  assert.equal(stats.costAdjustedReturn, 1.7);
  assert.equal(tools.reviewSummary([]).accuracy, null);
  assert.equal(tools.reviewSummary([{ reviewOutcome: 'pending' }]).meanReturn, null);
});

test('filtered review rows preserve identity for correct save targets', () => {
  const rows = [{ symbol: 'A', horizon: 'monthly' }, { symbol: 'B', horizon: 'yearly', reviewOutcome: 'accurate' }];
  const filtered = tools.filterHistory(rows, { horizon: 'yearly' });
  assert.equal(rows.indexOf(filtered[0]), 1);
  assert.equal(tools.filterHistory(rows, { outcome: 'pending' }).length, 1);
});

test('CSV handles delimiters, quotes and spreadsheet formula injection', () => {
  const output = tools.csv([['=HYPERLINK("x")', 'comma,value', 'two\nlines', 0, null]]);
  assert.ok(output.startsWith('\uFEFF'));
  assert.ok(output.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(output.includes('"comma,value"'));
  assert.ok(output.includes('"0",""'));
});
