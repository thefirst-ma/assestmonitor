import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'investment-monitor-worker-'));
process.env.DATABASE_DRIVER = 'sqljs';
process.env.DATABASE_PATH = join(dir, 'test.db');
process.env.ALERT_COOLDOWN_SECONDS = '0';

const { InvestmentMonitor } = require('../src/monitor') as typeof import('../src/monitor');
const { database } = require('../src/database') as typeof import('../src/database');
const { priceService } = require('../src/services/price') as typeof import('../src/services/price');

const originalGetPrice = priceService.getPrice;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function until(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await sleep(10);
  assert.ok(predicate(), 'condition was not reached in time');
}

test('refreshes remote asset changes without postponing existing sampling intervals', async () => {
  await database.init();
  await database.addAsset('worker:crypto:AAA', 'worker', 'crypto', 'AAA', 'AAA', 80, 50);
  const calls = new Map<string, number>();
  priceService.getPrice = (async (_type, symbol) => {
    calls.set(symbol, (calls.get(symbol) || 0) + 1);
    return 100;
  }) as typeof priceService.getPrice;
  const monitor = new InvestmentMonitor();
  try {
    await monitor.start();
    for (let i = 0; i < 5; i++) {
      await sleep(25);
      await monitor.scheduleAll();
    }
    assert.ok((calls.get('AAA') || 0) >= 2, 'refreshes must preserve the running 80 ms timer');

    await database.addAsset('worker:crypto:BBB', 'worker', 'crypto', 'BBB', 'BBB', 80, 50);
    await monitor.scheduleAll();
    await until(() => (calls.get('BBB') || 0) > 0);

    await database.updateAsset('worker:crypto:AAA', 120, 50);
    await monitor.scheduleAll();
    await until(() => (calls.get('AAA') || 0) >= 3);

    await database.removeAsset('worker:crypto:BBB');
    await monitor.scheduleAll();
    const removedCount = calls.get('BBB') || 0;
    await sleep(180);
    assert.equal(calls.get('BBB'), removedCount, 'removed asset must not be sampled again');
  } finally {
    await monitor.stop();
    priceService.getPrice = originalGetPrice;
    await database.removeAsset('worker:crypto:AAA');
  }
});

test('a slow group never overlaps and stop waits for its in-flight check', async () => {
  await database.addAsset('worker:crypto:SLOW', 'worker', 'crypto', 'SLOW', 'SLOW', 25, 50);
  let entered = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  priceService.getPrice = (async () => {
    entered++;
    await gate;
    return 100;
  }) as typeof priceService.getPrice;
  const monitor = new InvestmentMonitor();
  try {
    await monitor.start();
    await until(() => entered === 1);
    await sleep(90);
    assert.equal(entered, 1, 'timer ticks must not start a second check while the first is pending');
    let stopped = false;
    const stopping = monitor.stop().then(() => { stopped = true; });
    await sleep(25);
    assert.equal(stopped, false, 'stop must wait for the active check');
    release();
    await stopping;
    await sleep(50);
    assert.equal(entered, 1, 'stop must cancel future ticks');
  } finally {
    release();
    await monitor.stop();
    priceService.getPrice = originalGetPrice;
    await database.removeAsset('worker:crypto:SLOW');
  }
});

test('simultaneous interval groups cannot send duplicate alerts for one logical asset', async () => {
  const now = Math.floor(Date.now() / 1000) - 1;
  for (const [id, symbol, interval] of [
    ['worker:crypto:BTCUSDT', 'BTCUSDT', 5_000],
    ['worker:crypto:BTC-USDT', 'BTC-USDT', 6_000]
  ] as const) {
    await database.addAsset(id, 'worker', 'crypto', symbol, symbol, interval, 1);
    await database.savePrice({ assetId: id, price: 100, timestamp: now });
  }
  priceService.getPrice = (async () => 102) as typeof priceService.getPrice;
  const monitor = new InvestmentMonitor();
  let alerts = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  (monitor as any).notifier.sendAlertWithoutTelegram = async () => {
    alerts++;
    await gate;
  };
  (monitor as any).notifier.sendTelegramMerged = async () => undefined;
  try {
    await monitor.start();
    await until(() => alerts === 1);
    let bothSampled = false;
    const deadline = Date.now() + 1_000;
    while (!bothSampled && Date.now() < deadline) {
      const first = await database.getLatestPrice('worker:crypto:BTCUSDT');
      const second = await database.getLatestPrice('worker:crypto:BTC-USDT');
      bothSampled = first?.price === 102 && second?.price === 102;
      if (!bothSampled) await sleep(10);
    }
    assert.ok(bothSampled, 'both interval groups must finish sampling before checking alert deduplication');
    assert.equal(alerts, 1);
  } finally {
    release();
    await monitor.stop();
    priceService.getPrice = originalGetPrice;
    await database.removeAsset('worker:crypto:BTCUSDT');
    await database.removeAsset('worker:crypto:BTC-USDT');
  }
});

after(() => rmSync(dir, { recursive: true, force: true }));
