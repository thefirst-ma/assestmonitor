import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';

test('email reset codes are private, limited, single-use, and revoke old sessions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'investment-password-reset-'));
  const dbPath = join(dir, 'test.db');
  process.env.DATABASE_DRIVER = 'sqljs';
  process.env.DATABASE_PATH = dbPath;
  process.env.JWT_SECRET = 'password-reset-integration-test-secret';
  process.env.EMAIL_ENABLED = 'false';
  process.env.EMAIL_HOST = 'smtp.gmail.com';
  process.env.EMAIL_PORT = '587';
  process.env.EMAIL_USER = 'your-email@gmail.com';
  process.env.EMAIL_PASS = 'your-app-password';

  const nodemailer = require('nodemailer') as typeof import('nodemailer');
  const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
  const originalCreateTransport = nodemailer.createTransport;
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  const sent: Array<{ to: string; text: string }> = [];
  let failSend = false;
  let transportCreations = 0;
  (nodemailer as any).createTransport = () => {
    transportCreations++;
    return {
    sendMail: async (message: { to: string; text: string }) => {
      sent.push(message);
      if (failSend) throw new Error('SMTP send failed');
      return { accepted: [message.to] };
    },
    close: () => undefined
    };
  };

  const { app } = await import('../src/server');
  const { database } = await import('../src/database');
  await database.init();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const api = async (route: string, body?: unknown, token?: string) => {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  };
  const request = (email: string) => api('/api/auth/password-reset/request', { email });
  const confirm = (email: string, code: string, newPassword = 'new-password-123') =>
    api('/api/auth/password-reset/confirm', { email, code, newPassword });
  const codeFromLastEmail = () => {
    const match = sent.at(-1)?.text.match(/\b\d{6}\b/);
    assert.ok(match, 'a six-digit code was sent');
    return match[0];
  };
  const storedReset = async (userId: string) => {
    const SQL = await initSqlJs();
    const snapshot = new SQL.Database(readFileSync(dbPath));
    try {
      const rows = snapshot.exec('SELECT code_hash, expires_at, attempts, send_count, status FROM password_reset_codes WHERE user_id = ?', [userId]);
      return rows[0]?.values[0];
    } finally { snapshot.close(); }
  };

  try {
    const registered = await api('/api/auth/register', { email: 'reset@example.com', password: 'old-password-123' });
    assert.equal(registered.status, 200);
    const userId = registered.data.user.id as string;
    const oldToken = registered.data.token as string;
    const legacyToken = jwt.sign({ userId, email: 'reset@example.com' }, process.env.JWT_SECRET!, { expiresIn: '7d' });
    assert.equal((await api('/api/auth/me', undefined, legacyToken)).status, 200);
    const originalGetAuthVersion = database.getAuthVersionByUserId.bind(database);
    (database as any).getAuthVersionByUserId = async () => { throw new Error('temporary DB outage'); };
    try {
      assert.equal((await api('/api/auth/me', undefined, legacyToken)).status, 503);
    } finally {
      (database as any).getAuthVersionByUserId = originalGetAuthVersion;
    }

    const disabledKnown = await request('reset@example.com');
    const disabledUnknown = await request('unknown@example.com');
    assert.equal(disabledKnown.status, 503);
    assert.equal(disabledUnknown.status, 503);
    assert.deepEqual(disabledKnown.data, disabledUnknown.data);
    assert.equal(transportCreations, 0, 'placeholder credentials must fail before opening SMTP');
    assert.equal(await storedReset(userId), undefined);

    process.env.EMAIL_USER = 'sender@example.com';
    process.env.EMAIL_PASS = 'test-app-password';

    const unknown = await request('unknown@example.com');
    assert.equal(unknown.status, 200);
    assert.equal(sent.length, 0);
    assert.equal(transportCreations, 0, 'unknown accounts do not open SMTP connections');
    const first = await request(' RESET@EXAMPLE.COM ');
    assert.equal(first.status, 200);
    assert.deepEqual(first.data, unknown.data);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'reset@example.com');
    const firstCode = codeFromLastEmail();
    assert.equal(JSON.stringify(first.data).includes(firstCode), false);
    const stored = await storedReset(userId);
    assert.ok(stored);
    assert.match(String(stored[0]), /^[a-f0-9]{64}$/);
    assert.notEqual(stored[0], firstCode);
    assert.equal(stored[2], 0);
    assert.equal(stored[4], 'active');

    assert.deepEqual((await request('reset@example.com')).data, first.data);
    assert.equal(sent.length, 1, 'resend cooldown must be persisted');
    for (let i = 0; i < 5; i++) {
      assert.equal((await confirm('reset@example.com', firstCode === '000000' ? '000001' : '000000')).status, 400);
    }
    assert.equal((await storedReset(userId))?.[2], 5);
    assert.equal((await confirm('reset@example.com', firstCode)).status, 400, 'five failures exhaust the code');
    assert.equal((await api('/api/auth/login', { email: 'reset@example.com', password: 'old-password-123' })).status, 200);

    now += 61_000;
    assert.equal((await request('reset@example.com')).status, 200);
    assert.equal(sent.length, 2);
    const secondCode = codeFromLastEmail();
    assert.equal((await confirm('reset@example.com', firstCode)).status, 400, 'resend invalidates the previous code');
    now += 61_000;
    assert.equal((await request('reset@example.com')).status, 200);
    assert.equal(sent.length, 3);
    const thirdCode = codeFromLastEmail();
    assert.equal((await confirm('reset@example.com', secondCode)).status, 400);
    now += 601_000;
    assert.equal((await confirm('reset@example.com', thirdCode)).status, 400, 'code expires after 10 minutes');
    assert.deepEqual((await request('reset@example.com')).data, first.data);
    assert.equal(sent.length, 3, 'only three sends are allowed in one hour');

    now += 3_601_000;
    assert.equal((await request('reset@example.com')).status, 200);
    assert.equal(sent.length, 4);
    const finalCode = codeFromLastEmail();
    const races = await Promise.all([confirm('reset@example.com', finalCode), confirm('reset@example.com', finalCode)]);
    assert.deepEqual(races.map(result => result.status).sort(), [200, 400]);
    assert.equal((await confirm('reset@example.com', finalCode)).status, 400, 'used code cannot be replayed');
    assert.equal((await api('/api/auth/me', undefined, oldToken)).status, 401, 'old JWT is revoked');
    assert.equal((await api('/api/auth/me', undefined, legacyToken)).status, 401, 'pre-version JWT is revoked too');
    assert.equal((await api('/api/auth/login', { email: 'reset@example.com', password: 'old-password-123' })).status, 400);
    const freshLogin = await api('/api/auth/login', { email: 'reset@example.com', password: 'new-password-123' });
    assert.equal(freshLogin.status, 200);
    assert.equal((await api('/api/auth/me', undefined, freshLogin.data.token)).status, 200);

    const other = await api('/api/auth/register', { email: 'send-failure@example.com', password: 'old-password-123' });
    assert.equal(other.status, 200);
    failSend = true;
    const failedSend = await request('send-failure@example.com');
    assert.equal(failedSend.status, 200);
    assert.deepEqual(failedSend.data, unknown.data, 'delivery failure must not identify a registered address');
    assert.equal((await storedReset(other.data.user.id))?.[4], 'failed');
    assert.equal((await confirm('send-failure@example.com', codeFromLastEmail())).status, 400);
    failSend = false;
    const retry = await request('send-failure@example.com');
    assert.equal(retry.status, 200, 'delivery failure permits an immediate retry');
    assert.equal((await storedReset(other.data.user.id))?.[4], 'active');
    assert.equal((await storedReset(other.data.user.id))?.[3], 2, 'failed sends still count toward the hourly cap');

    now += 901_000;
    const originalLookup = database.getUserByEmail.bind(database);
    let lookupCalls = 0;
    (database as any).getUserByEmail = async (...args: Parameters<typeof database.getUserByEmail>) => {
      lookupCalls++;
      return originalLookup(...args);
    };
    try {
      for (let i = 0; i < 13; i++) {
        const limited = await request('unknown@example.com');
        assert.equal(limited.status, 200);
        assert.deepEqual(limited.data, unknown.data);
      }
    } finally {
      (database as any).getUserByEmail = originalLookup;
    }
    assert.equal(lookupCalls, 12, 'the durable source quota stops account lookups');

    const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
    const originalHash = bcrypt.hash;
    let hashCalls = 0;
    (bcrypt as any).hash = async (...args: any[]) => {
      hashCalls++;
      return (originalHash as any)(...args);
    };
    try {
      for (let i = 0; i < 13; i++) {
        assert.equal((await confirm('unknown@example.com', '123456')).status, 400);
      }
      assert.equal(hashCalls, 12, 'the durable confirm quota stops expensive password hashing');
    } finally {
      (bcrypt as any).hash = originalHash;
    }
  } finally {
    Date.now = originalNow;
    (nodemailer as any).createTransport = originalCreateTransport;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
