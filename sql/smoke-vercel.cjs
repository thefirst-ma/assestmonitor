const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { spawnSync } = require('node:child_process');

const base = 'https://investment-monitor-delta.vercel.app';
const email = `deploy-smoke-${Date.now()}@example.invalid`;
const password = crypto.randomBytes(20).toString('base64url');
let userId;

async function request(endpoint, token, options = {}) {
  const args = ['--silent', '--show-error', '--max-time', '30', '-w', '\n%{http_code}', '-X', options.method || 'GET'];
  for (const [name, value] of Object.entries({ ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers })) {
    args.push('-H', `${name}: ${value}`);
  }
  if (options.body) args.push('--data-binary', '@-');
  args.push(`${base}${endpoint}`);
  const result = spawnSync('curl.exe', args, { input: options.body, encoding: 'utf8', timeout: 35000 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'curl failed');
  const split = result.stdout.lastIndexOf('\n');
  const raw = result.stdout.slice(0, split);
  let body;
  try { body = JSON.parse(raw); } catch { body = {}; }
  return { status: Number(result.stdout.slice(split + 1)), body };
}

async function cleanup() {
  if (!userId) return;
  const privateDir = path.join(__dirname, '.private');
  const connection = await mysql.createConnection({
    host: '202.182.109.93',
    port: 3306,
    user: 'investment_monitor_app',
    password: fs.readFileSync(path.join(privateDir, 'tokyo-app-password'), 'utf8').trim(),
    database: 'investment_monitor',
    ssl: { ca: fs.readFileSync(path.join(privateDir, 'tokyo-ca.pem')), rejectUnauthorized: true }
  });
  try {
    await connection.query('DELETE FROM users WHERE id = ? AND email = ?', [userId, email]);
    console.log('Disposable user removed');
  } finally {
    await connection.end();
  }
}

async function main() {
  const home = await request('/index.html');
  console.log('Home:', home.status);
  const unauthorized = await request('/api/auth/me');
  console.log('Unauthenticated:', unauthorized.status);
  const cron = await request('/api/cron/recommendations');
  console.log('Cron without secret:', cron.status);

  const registration = await request('/api/auth/register', null, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  console.log('Register:', registration.status, registration.body.success);
  userId = registration.body.user?.id;
  if (!registration.body.token || !userId) throw new Error(registration.body.message || 'Registration failed');

  const token = registration.body.token;
  for (const endpoint of ['/api/auth/me', '/api/assets', '/api/recommendations/latest', '/api/recommendations/history', '/api/recommendation-factors']) {
    const result = await request(endpoint, token);
    const detail = endpoint.endsWith('/latest')
      ? `run=${result.body.run?.id || 'none'} items=${result.body.recommendations?.monthly?.length || result.body.items?.length || 0}`
      : '';
    console.log(endpoint, result.status, result.body.success, detail);
    if (result.status !== 200) throw new Error(`${endpoint}: ${result.body.message || result.status}`);
  }
  if (home.status !== 200 || unauthorized.status !== 401 || cron.status !== 401) throw new Error('Public route check failed');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => cleanup().catch(error => {
  console.error('Cleanup failed:', error.message);
  process.exitCode = 1;
}));
