const researchSelections = new Set();
let researchRows = [];
let visibleReviewItems = [];
const researchFilterIds = ['researchQuery', 'researchHorizon', 'researchAction', 'researchRisk', 'researchMinScore', 'researchSort'];
const researchKey = item => `${item.horizon}:${item.symbol}`;
const researchNumber = (value, suffix = '') => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) + suffix : '未提供';
const researchPercent = value => researchNumber(typeof value === 'number' ? value * 100 : undefined, '%');

function researchFilters() {
  return { query: $('researchQuery').value, horizon: $('researchHorizon').value, action: $('researchAction').value,
    risk: $('researchRisk').value, minScore: $('researchMinScore').value, sort: $('researchSort').value };
}

function restoreResearchFilter() {
  researchSelections.clear();
  researchFilterIds.forEach(id => $(id).value = id === 'researchSort' ? 'score' : id === 'researchMinScore' ? '0' : '');
  try {
    const saved = JSON.parse(localStorage.getItem('research-filter:' + currentUser.id) || '{}');
    researchFilterIds.forEach(id => { if (typeof saved[id] === 'string') $(id).value = saved[id]; });
  } catch { /* Ignore unavailable storage or obsolete saved filters. */ }
}

function saveResearchFilter() {
  try {
    localStorage.setItem('research-filter:' + currentUser.id, JSON.stringify(Object.fromEntries(researchFilterIds.map(id => [id, $(id).value]))));
    toast('筛选已保存到当前浏览器');
  } catch { toast('浏览器无法保存筛选', 'error'); }
}

function resetResearchFilter() {
  researchFilterIds.forEach(id => $(id).value = id === 'researchSort' ? 'score' : id === 'researchMinScore' ? '0' : '');
  renderResearchWorkbench();
}

function riskPill(item) {
  const risk = ResearchTools.risk(item);
  const color = { high: 'red', medium: 'orange', low: 'green', unknown: 'blue' }[risk.level];
  return `<span class="status-pill ${color}" title="${escapeHtml(risk.reasons.join('；'))}">${risk.label}</span>`;
}

function renderResearchWorkbench() {
  const all = Object.entries(cachedRecommendations).flatMap(([horizon, items]) => items.map(item => ({ ...item, horizon })));
  const keys = new Set(all.map(researchKey));
  for (const key of researchSelections) if (!keys.has(key)) researchSelections.delete(key);
  researchRows = ResearchTools.filterRecommendations(all, researchFilters());
  $('researchCount').textContent = `当前榜单 ${all.length} 条 · 筛选后 ${researchRows.length} 条 · 已选 ${researchSelections.size} 条`;
  $('researchCompare').textContent = `对比 (${researchSelections.size}/3)`;
  $('researchCompare').disabled = researchSelections.size < 2;
  if (!researchRows.length) {
    $('recommendationGrid').innerHTML = '<div class="empty">没有符合条件的推荐。</div>';
    return;
  }
  $('recommendationGrid').innerHTML = `<table class="table research-table"><thead><tr><th>对比</th><th>股票 / 周期</th><th>推荐分</th><th>风险核验</th><th>波动 / 回撤</th><th>推荐依据与风险</th><th>研究</th></tr></thead><tbody>${researchRows.map((item, index) => `
    <tr><td><input type="checkbox" aria-label="对比 ${escapeHtml(item.symbol)} ${horizonLabel(item.horizon)}" ${researchSelections.has(researchKey(item)) ? 'checked' : ''} onchange="toggleResearchSelection(${index}, this.checked)"></td>
    <td><b>${escapeHtml(item.name || item.symbol)}</b><small>${escapeHtml(item.symbol)} · ${horizonLabel(item.horizon)}</small></td>
    <td><b>${researchNumber(item.score)}</b><small>${escapeHtml(actionText[item.action] || item.action)}</small></td>
    <td>${riskPill(item)}<small>${(item.factorContributions || []).length} 项因子</small></td>
    <td>${researchPercent(item.metrics?.volatility)}<small>${researchPercent(item.metrics?.drawdownFromHigh)}</small></td>
    <td class="research-evidence">${escapeHtml(item.reasons?.[0] || '暂无推荐依据')}<small>${escapeHtml(item.risks?.[0] || '未提供风险说明')}</small></td>
    <td><button class="link-btn" onclick="openResearchDetail(${index})">查看依据</button></td></tr>`).join('')}</tbody></table>`;
}

function toggleResearchSelection(index, checked) {
  const key = researchKey(researchRows[index]);
  if (checked && !researchSelections.has(key) && researchSelections.size >= 3) toast('最多对比三条推荐', 'error');
  else if (checked) researchSelections.add(key);
  else researchSelections.delete(key);
  renderResearchWorkbench();
}

function openResearchDetail(index) { showResearchDialog([researchRows[index]], '推荐依据'); }
function openResearchComparison() {
  const items = Object.entries(cachedRecommendations).flatMap(([horizon, rows]) => rows.map(item => ({ ...item, horizon })))
    .filter(item => researchSelections.has(researchKey(item)));
  if (items.length >= 2) showResearchDialog(items, '推荐横向对比');
}
function showResearchDialog(items, title) {
  $('researchDialogTitle').textContent = title;
  const list = values => values?.length ? `<ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>` : '未提供';
  const fields = [
    ['推荐分', item => researchNumber(item.score)],
    ['风险核验', item => riskPill(item) + list(ResearchTools.risk(item).reasons)],
    ['年化波动率', item => researchPercent(item.metrics?.volatility)],
    ['距区间高点回撤', item => researchPercent(item.metrics?.drawdownFromHigh)],
    ['推荐原因', item => list(item.reasons)], ['风险依据', item => list(item.risks)],
    ['因子贡献', item => (item.factorContributions || []).length ? (item.factorContributions || []).map(f => `<p><b>${escapeHtml(f.name)}</b> · ${researchNumber(f.score)} 分<br><small>权重 ${researchPercent(f.weight)} · 贡献 ${researchNumber(f.contribution)}<br>${escapeHtml(f.summary || '未提供证据')}</small></p>`).join('') : '未提供因子快照']
  ];
  $('researchDialogBody').innerHTML = `<div class="research-scroll"><table class="table"><thead><tr><th>研究维度</th>${items.map(item => `<th>${escapeHtml(item.name || item.symbol)}<br><small>${escapeHtml(item.symbol)} · ${horizonLabel(item.horizon)}</small></th>`).join('')}</tr></thead><tbody>${fields.map(([name, render]) => `<tr><th>${name}</th>${items.map(item => `<td>${render(item)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  $('researchDialog').showModal();
}

function renderReviewWorkbench() {
  visibleReviewItems = ResearchTools.filterHistory(currentHistoryItems, { query: $('historyQuery').value,
    horizon: $('historyHorizon').value, outcome: $('historyOutcome').value });
  $('historyTable').innerHTML = visibleReviewItems.length ? renderHistoryTable(visibleReviewItems) : '<div class="empty">没有符合条件的复盘记录。</div>';
  $('reviewSampleScope').textContent = `最近载入 ${currentHistoryItems.length} 条（最多 500 条）· 当前筛选 ${visibleReviewItems.length} 条`;
  renderReviewAnalytics();
}

function renderReviewAnalytics() {
  const cost = Math.min(1000, Math.max(0, Number($('reviewCostBps').value) || 0));
  const summary = ResearchTools.reviewSummary(visibleReviewItems, cost);
  const pct = value => value === null ? '—' : value.toFixed(1) + '%';
  $('reviewAnalytics').innerHTML = `<div class="research-metrics">
    <div class="research-metric"><span>已复盘 / 样本</span><strong>${summary.reviewed} / ${summary.total}</strong><small>待复盘 ${summary.pending} 条</small></div>
    <div class="research-metric"><span>人工判断准确率</span><strong>${pct(summary.accuracy)}</strong><small>准确 ${summary.accurate} · 部分准确 ${summary.mixed}</small></div>
    <div class="research-metric"><span>平均已录入收益</span><strong>${pct(summary.meanReturn)}</strong><small>${summary.returnSamples} 条有效收益记录</small></div>
    <div class="research-metric"><span>额外成本情景收益</span><strong>${pct(summary.costAdjustedReturn)}</strong><small>每条扣减 ${cost} 基点</small></div></div>
    <div class="research-scroll"><table class="table"><thead><tr><th>周期</th><th>已复盘</th><th>人工准确率</th><th>平均收益</th><th>准确 / 部分 / 不准确</th></tr></thead><tbody>${['monthly', 'quarterly', 'yearly'].map(horizon => {
      const group = ResearchTools.reviewSummary(visibleReviewItems.filter(item => item.horizon === horizon));
      const width = n => group.reviewed ? n / group.reviewed * 100 : 0;
      return `<tr><td>${horizonLabel(horizon)}</td><td>${group.reviewed} / ${group.total}</td><td>${pct(group.accuracy)}</td><td>${pct(group.meanReturn)}</td><td><div class="review-distribution" role="img" aria-label="准确 ${group.accurate}，部分准确 ${group.mixed}，不准确 ${group.inaccurate}"><span style="width:${width(group.accurate)}%;background:var(--green)"></span><span style="width:${width(group.mixed)}%;background:var(--orange)"></span><span style="width:${width(group.inaccurate)}%;background:var(--red)"></span></div><small>${group.accurate} / ${group.mixed} / ${group.inaccurate}</small></td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="research-note">统计仅覆盖当前筛选样本。准确率为人工标记“准确”÷已复盘条数，部分准确单列；待复盘与缺失收益不按零收益计入。收益为简单平均，未进行持仓加权或年化，不是组合回测。额外成本情景每 100 基点扣减 1 个百分点。</p>`;
}

function exportReviewCsv() {
  const rows = [['批次', '推荐时间', '股票', '名称', '周期', '评分', '结论', '录入收益%', '复盘原因'], ...visibleReviewItems.map(item => [
    item.runId, dateTime(item.generatedAt), item.symbol, item.name, horizonLabel(item.horizon), item.score,
    item.reviewOutcome || 'pending', item.actualReturn, item.reviewReason
  ])];
  const url = URL.createObjectURL(new Blob([ResearchTools.csv(rows)], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'recommendation-reviews.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
