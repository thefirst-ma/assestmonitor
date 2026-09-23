const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
require('dotenv').config();

const privateDir = path.join(__dirname, '../sql/.private');
const values = {
  DATABASE_DRIVER: 'mysql',
  MYSQL_HOST: '202.182.109.93',
  MYSQL_PORT: '3306',
  MYSQL_DATABASE: 'investment_monitor',
  MYSQL_USER: 'investment_monitor_app',
  MYSQL_PASSWORD: fs.readFileSync(path.join(privateDir, 'tokyo-app-password'), 'utf8').trim(),
  MYSQL_SSL_CA_BASE64: fs.readFileSync(path.join(privateDir, 'tokyo-ca.pem')).toString('base64'),
  MYSQL_CONNECTION_LIMIT: '3',
  JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  NOTIFICATION_ENCRYPTION_KEY: process.env.NOTIFICATION_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex'),
  RECOMMENDATION_ENABLED: 'true',
  CRON_SECRET: crypto.randomBytes(32).toString('hex')
};

const entries = process.argv.includes('--cron-only')
  ? [['CRON_SECRET', values.CRON_SECRET]]
  : Object.entries(values);

for (const [name, value] of entries) {
  const result = spawnSync('npx', ['--yes', 'vercel', 'env', 'add', name, 'production', '--yes', '--sensitive', '--scope', 'thefirstmas-projects'],
    { shell: true, input: value + '\n', encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0) {
    console.error(`${name}: configuration failed`, result.stderr?.slice(-400) || result.error?.message);
    process.exit(1);
  }
  console.log(`${name}: configured`);
}
