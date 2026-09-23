import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axios from 'axios';

test('registration and per-user notifications', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'investment-notifications-'));
  process.env.DATABASE_DRIVER = 'sqljs';
  process.env.DATABASE_PATH = join(dir, 'test.db');
  process.env.NOTIFICATION_ENCRYPTION_KEY = 'ab'.repeat(32);
  process.env.JWT_SECRET = 'integration-test-only';
  const { app } = await import('../src/server');
  const { database } = await import('../src/database');
  const { notifyUser, notifyReportSubscribers } = await import('../src/services/user-notifications');
  await database.init();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const originalPost = axios.post;
  const calls: any[] = [];
  let fail = false;
  axios.post = (async (url: string, payload: any) => {
    assert.equal(url, 'https://www.pushplus.plus/send');
    calls.push(payload);
    return { data: fail ? { code: 600, msg: 'invalid' } : { code: 200, data: 'receipt-123' } };
  }) as any;
  async function api(path: string, method = 'GET', body?: any, token?: string) {
    const response = await fetch(base + path, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  try {
    assert.equal((await api('/api/notifications')).status, 401);
    assert.equal((await api('/api/recommendations/latest')).status, 401);
    for (const body of [{ email: {}, password: '12345678' }, { email: 'bad', password: '12345678' }, { email: 'a@example.com', password: 'short' }]) {
      assert.equal((await api('/api/auth/register', 'POST', body)).status, 400);
    }
    const a = await api('/api/auth/register', 'POST', { email: '  Alice@EXAMPLE.com ', password: 'password-123' });
    assert.equal(a.status, 200);
    assert.equal(a.data.user.email, 'alice@example.com');
    assert.equal(a.data.user.passwordHash, undefined);
    const b = await api('/api/auth/register', 'POST', { email: 'bob@example.com', password: 'password-123' });
    assert.equal(b.status, 200);
    assert.equal((await api('/api/auth/register', 'POST', { email: 'alice@example.com', password: 'password-123' })).status, 400);
    assert.equal((await api('/api/auth/login', 'POST', { email: 'ALICE@example.com', password: 'password-123' })).status, 200);
    assert.equal((await api('/api/auth/login', 'POST', { email: 'alice@example.com', password: 'incorrect' })).status, 400);
    const token = a.data.token;
    assert.equal((await api('/api/recommendations/latest', 'GET', undefined, token)).data.run, null);
    const recommendations: any = { monthly: [{ symbol: 'TEST', name: 'Test stock', score: 80, action: 'watch', metrics: { volatility: .2 }, factorContributions: [] }], quarterly: [], yearly: [] };
    await database.saveRecommendationRun(recommendations, 'test');
    const latest = await api('/api/recommendations/latest', 'GET', undefined, token);
    assert.equal(latest.data.recommendations.monthly[0].metrics.volatility, .2);
    assert.equal(latest.data.recommendations.monthly[0].horizon, 'monthly');
    const setting = { enabled: true, token: 'test-token-1234567890', destination: '', priceAlerts: true, dailyReport: false };
    assert.equal((await api('/api/notifications/wechat', 'PUT', setting, token)).status, 200);
    assert.equal((await api('/api/notifications/qq', 'PUT', { ...setting, enabled: 'true' }, token)).status, 400);
    const rows = await api('/api/notifications', 'GET', undefined, token);
    assert.equal(rows.data[0].configured, true);
    assert.equal(rows.data[0].secret, undefined);
    assert.deepEqual((await api('/api/notifications', 'GET', undefined, b.data.token)).data, []);
    assert.equal((await api('/api/notifications/wechat/test', 'POST', {}, b.data.token)).status, 400);
    assert.equal(readFileSync(process.env.DATABASE_PATH).includes(Buffer.from(setting.token)), false);
    await api('/api/notifications/wechat', 'PUT', { ...setting, token: '' }, token);
    await notifyUser(a.data.user.id, 'priceAlerts', 'price', 'price changed');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].token, setting.token);
    await notifyUser(b.data.user.id, 'priceAlerts', 'price', 'private');
    await notifyReportSubscribers('daily');
    assert.equal(calls.length, 1);
    await api('/api/notifications/qq', 'PUT', { ...setting, dailyReport: true, priceAlerts: false, destination: 'group-code' }, token);
    await notifyReportSubscribers('monthly quarterly yearly');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].channel, 'qq');
    assert.equal(calls[1].option, 'group-code');
    assert.equal((await api('/api/notifications/wechat/test', 'POST', {}, token)).data.receipt, 'receipt-123');
    assert.equal((await api('/api/notifications/wechat/test', 'POST', {}, token)).status, 429);
    fail = true;
    const failed = await api('/api/notifications/qq/test', 'POST', {}, token);
    assert.equal(failed.status, 400);
    assert.match(failed.data.message, /600/);
    await api('/api/notifications/wechat', 'PUT', { ...setting, token: '', enabled: false }, token);
    const before = calls.length;
    await notifyUser(a.data.user.id, 'priceAlerts', 'price', 'disabled');
    assert.equal(calls.length, before);
    axios.post = (async () => { throw new Error('network failure with secret test-token-1234567890'); }) as any;
    const { sendPush } = await import('../src/services/user-notifications');
    const stored = (await database.getUserNotifications(a.data.user.id))[0];
    await assert.rejects(sendPush(stored, 'test', 'test'), /推送服务连接失败/);
    const realKey = process.env.NOTIFICATION_ENCRYPTION_KEY;
    process.env.NOTIFICATION_ENCRYPTION_KEY = 'cd'.repeat(32);
    await assert.rejects(sendPush(stored, 'test', 'test'));
    process.env.NOTIFICATION_ENCRYPTION_KEY = realKey;
  } finally {
    axios.post = originalPost;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
