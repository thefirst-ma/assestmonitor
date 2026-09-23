(function (root) {
  'use strict';
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  function risk(item) {
    const m = item.metrics || {};
    const missing = ['volatility', 'drawdownFromHigh'].filter(key => !finite(m[key]));
    const reasons = [];
    if (finite(m.volatility) && m.volatility >= .55) reasons.push('年化波动率达到 55%');
    if (finite(m.drawdownFromHigh) && m.drawdownFromHigh <= -.30) reasons.push('距历史区间高点回撤达到 30%');
    if (reasons.length) return { level: 'high', label: '重点核验', reasons, missing };
    if (missing.length) return { level: 'unknown', label: '数据不足', reasons: ['缺少波动或回撤指标'], missing };
    if (m.volatility >= .30 || m.drawdownFromHigh <= -.15) return { level: 'medium', label: '常规核验', reasons: ['年化波动率达到 30% 或区间回撤达到 15%'], missing };
    return { level: 'low', label: '较低波动', reasons: ['年化波动率低于 30%，区间回撤小于 15%'], missing };
  }
  function filterRecommendations(items, filters) {
    const query = (filters.query || '').trim().toLowerCase();
    return items.filter(item => (!query || `${item.symbol} ${item.name}`.toLowerCase().includes(query))
      && (!filters.horizon || item.horizon === filters.horizon)
      && (!filters.action || item.action === filters.action)
      && (!filters.risk || risk(item).level === filters.risk)
      && finite(item.score) && item.score >= (Number(filters.minScore) || 0))
      .sort((a, b) => filters.sort === 'symbol' ? a.symbol.localeCompare(b.symbol)
        : filters.sort === 'volatility' ? (finite(a.metrics?.volatility) ? a.metrics.volatility : Infinity) - (finite(b.metrics?.volatility) ? b.metrics.volatility : Infinity)
        : b.score - a.score);
  }
  function reviewSummary(items, costBps = 0) {
    const reviewed = items.filter(item => ['accurate', 'mixed', 'inaccurate'].includes(item.reviewOutcome));
    const accurate = reviewed.filter(item => item.reviewOutcome === 'accurate').length;
    const mixed = reviewed.filter(item => item.reviewOutcome === 'mixed').length;
    const returns = reviewed.map(item => item.actualReturn).filter(finite);
    const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null;
    return { total: items.length, reviewed: reviewed.length, pending: items.length - reviewed.length,
      accurate, mixed, inaccurate: reviewed.length - accurate - mixed,
      accuracy: reviewed.length ? accurate / reviewed.length * 100 : null,
      returnSamples: returns.length, meanReturn: mean,
      costAdjustedReturn: mean === null ? null : mean - Math.max(0, Number(costBps) || 0) / 100 };
  }
  function filterHistory(items, filters) {
    const query = (filters.query || '').trim().toLowerCase();
    return items.filter(item => (!query || `${item.symbol} ${item.name}`.toLowerCase().includes(query))
      && (!filters.horizon || item.horizon === filters.horizon)
      && (!filters.outcome || (item.reviewOutcome || 'pending') === filters.outcome));
  }
  function csv(rows) {
    return '\uFEFF' + rows.map(row => row.map(value => {
      let text = String(value ?? '');
      if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    }).join(',')).join('\r\n');
  }
  const api = { risk, filterRecommendations, reviewSummary, filterHistory, csv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ResearchTools = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
