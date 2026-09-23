const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const mysql = require('mysql2/promise');

async function main() {
  const ca = execFileSync('ssh', ['-o', 'BatchMode=yes', 'tokyo-vps', 'sudo', 'cat', '/etc/mysql/ssl/investment-monitor/server.pem'], { encoding: 'utf8', timeout: 20000 });
  const dir = path.join(__dirname, '.private');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tokyo-ca.pem'), ca, { mode: 0o600 });
  const password = fs.readFileSync(path.join(dir, 'tokyo-app-password'), 'utf8').trim();
  const host = '202.182.109.93';
  const config = { host, port: 3306, user: 'investment_monitor_app', password,
    database: 'investment_monitor', connectTimeout: 12000 };
  const db = await mysql.createConnection({ ...config, ssl: { ca, rejectUnauthorized: true } });
  try {
    const [[{ ssl_version }]] = await db.query("SHOW SESSION STATUS LIKE 'Ssl_version'").then(([rows]) => [[{ ssl_version: rows[0]?.Value }]]);
    if (!ssl_version) throw new Error('TLS connection was not negotiated');
    const [tables] = await db.query('SHOW TABLES');
    console.log(`Tokyo database reachable with ${ssl_version}; ${tables.length} tables found.`);
  } finally { await db.end(); }
  try {
    const plain = await mysql.createConnection(config);
    await plain.end();
    throw new Error('Database account accepted a plaintext connection');
  } catch (error) {
    if (error.message === 'Database account accepted a plaintext connection') throw error;
    console.log('Plaintext connection rejected as expected.');
  }
}
main().catch(error => { console.error('Tokyo database verification failed:', error.code || error.message); process.exitCode = 1; });
