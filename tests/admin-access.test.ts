import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('shared settings and research writes require an explicitly configured admin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'investment-admin-'));
  process.env.DATABASE_DRIVER = 'sqljs';
  process.env.DATABASE_PATH = join(dir, 'test.db');
  process.env.JWT_SECRET = 'admin-integration-test-only';
  process.env.ADMIN_EMAILS = 'admin@example.com';
  process.env.VERCEL = '1';

  const { app } = await import('../src/server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  async function api(route: string, method = 'GET', body?: unknown, token?: string) {
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() as any };
  }

  try {
    const admin = await api('/api/auth/register', 'POST', { email: 'admin@example.com', password: 'password-123' });
    const member = await api('/api/auth/register', 'POST', { email: 'member@example.com', password: 'password-123' });
    assert.equal(admin.status, 200);
    assert.equal(member.status, 200);

    assert.equal((await api('/api/auth/me', 'GET', undefined, admin.body.token)).body.isAdmin, true);
    assert.equal((await api('/api/auth/me', 'GET', undefined, member.body.token)).body.isAdmin, false);
    assert.equal((await api('/api/config', 'GET', undefined, member.body.token)).status, 403);
    assert.equal((await api('/api/config', 'GET', undefined, admin.body.token)).status, 200);
    assert.equal((await api('/api/config', 'POST', { threshold: 7 }, admin.body.token)).status, 409);

    for (const route of ['/api/recommendations/run', '/api/research-profiles', '/api/recommendation-factors',
      '/api/stock-factor-values', '/api/recommendation-reviews', '/api/test/webhook']) {
      assert.equal((await api(route, 'POST', {}, member.body.token)).status, 403, route);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(dir, { recursive: true, force: true });
    delete process.env.VERCEL;
    delete process.env.ADMIN_EMAILS;
  }
});
