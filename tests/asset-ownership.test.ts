import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('asset history and mutations are limited to the owning user', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'investment-asset-ownership-'));
  process.env.DATABASE_DRIVER = 'sqljs';
  process.env.DATABASE_PATH = join(dir, 'test.db');
  process.env.JWT_SECRET = 'asset-ownership-integration-test';

  const { app } = await import('../src/server');
  const { database } = await import('../src/database');
  await database.init();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  async function api(path: string, method = 'GET', body?: unknown, token?: string) {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  }

  try {
    const alice = (await api('/api/auth/register', 'POST', { email: 'asset-alice@example.com', password: 'password-123' })).data;
    const bob = (await api('/api/auth/register', 'POST', { email: 'asset-bob@example.com', password: 'password-123' })).data;
    const assetId = `${alice.user.id}:crypto:BTCUSDT`;
    const assetPath = encodeURIComponent(assetId);
    await database.addAsset(assetId, alice.user.id, 'crypto', 'BTCUSDT', 'Bitcoin', 60000, 5);
    await database.savePrice({ assetId, price: 100, timestamp: Math.floor(Date.now() / 1000) });

    assert.equal((await api(`/api/prices/${assetPath}`)).status, 401);
    assert.equal((await api(`/api/prices/${assetPath}`, 'GET', undefined, bob.token)).status, 404);
    assert.equal((await api(`/api/assets/${assetPath}`, 'PUT', { interval: 120, threshold: 1 }, bob.token)).status, 404);
    assert.equal((await api(`/api/assets/${assetPath}`, 'DELETE', undefined, bob.token)).status, 404);

    // The database methods must also remain scoped if a route misses a check.
    await database.updateAssetForUser(assetId, bob.user.id, 120000, 1);
    await database.removeAssetForUser(assetId, bob.user.id);
    assert.deepEqual(await database.getHistoricalPricesForUser(assetId, bob.user.id, 0), []);
    const unchanged = await database.getAssetByIdForUser(assetId, alice.user.id);
    assert.equal(unchanged?.interval, 60000);
    assert.equal(unchanged?.threshold, 5);
    assert.equal(unchanged?.enabled, true);
    assert.deepEqual((await database.getHistoricalPricesForUser(assetId, alice.user.id, 0)).map(price => price.price), [100]);

    const ownPrices = await api(`/api/prices/${assetPath}`, 'GET', undefined, alice.token);
    assert.equal(ownPrices.status, 200);
    assert.deepEqual(ownPrices.data.map((price: { price: number }) => price.price), [100]);
    assert.equal((await api(`/api/assets/${assetPath}`, 'PUT', { interval: 120, threshold: 1 }, alice.token)).status, 200);
    const updated = await database.getAssetByIdForUser(assetId, alice.user.id);
    assert.equal(updated?.interval, 120000);
    assert.equal(updated?.threshold, 1);
    assert.equal((await api(`/api/assets/${assetPath}`, 'DELETE', undefined, alice.token)).status, 200);
    assert.equal(await database.getAssetByIdForUser(assetId, alice.user.id), undefined);
    assert.equal((await api(`/api/prices/${assetPath}`, 'GET', undefined, alice.token)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
