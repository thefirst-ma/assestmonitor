// Generates SQL credentials locally and applies only sql/ statements over the existing SSH alias.
const { randomBytes } = require('node:crypto');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = join(__dirname, '.private');
mkdirSync(dir, { recursive: true });
const password = randomBytes(36).toString('base64url');
const sql = readFileSync(join(__dirname, '005_tokyo_app_user.mysql.sql'), 'utf8').replaceAll('{{APP_PASSWORD}}', password);
const result = spawnSync('ssh', ['-o', 'BatchMode=yes', 'tokyo-vps', 'sudo', 'mysql'], { input: sql, encoding: 'utf8', timeout: 30000 });
if (result.status !== 0) {
  console.error('Database account setup failed:', result.stderr?.slice(0, 500) || result.error?.message);
  process.exit(1);
}
writeFileSync(join(dir, 'tokyo-app-password'), password, { mode: 0o600 });
console.log('Dedicated TLS-only database account created; password stored in ignored sql/.private/.');
