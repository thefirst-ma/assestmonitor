// Copies existing app data into the new VPS database using prepared statements.
// Both databases must already have the numbered sql/ schema installed.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const tables = [
  'users', 'assets', 'prices', 'research_profiles', 'recommendation_factors',
  'stock_factor_values', 'recommendation_runs', 'recommendation_items',
  'recommendation_reviews', 'user_notifications'
];

async function openConnections() {
  const local = await mysql.createConnection({ host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '', database: process.env.MYSQL_DATABASE || 'investment_monitor' });
  const privateDir = path.join(__dirname, '.private');
  const remote = await mysql.createConnection({ host: '202.182.109.93', port: 3306,
    user: 'investment_monitor_app', password: fs.readFileSync(path.join(privateDir, 'tokyo-app-password'), 'utf8').trim(),
    database: 'investment_monitor', ssl: { ca: fs.readFileSync(path.join(privateDir, 'tokyo-ca.pem'), 'utf8'), rejectUnauthorized: true } });
  return { local, remote };
}

async function main() {
  const { local, remote } = await openConnections();
  try {
    const counts = [];
    for (const table of tables) {
      const [[source]] = await local.query(`SELECT COUNT(*) AS n FROM ${table}`);
      const [[destination]] = await remote.query(`SELECT COUNT(*) AS n FROM ${table}`);
      counts.push({ table, source: source.n, destination: destination.n });
    }
    console.table(counts);
    if (!process.argv.includes('--apply')) return;
    if (counts.some(row => row.destination !== 0 && row.table !== 'recommendation_factors')) {
      throw new Error('Remote app tables are not empty; migration stopped to avoid changing existing data');
    }
    const [[localFactors], [remoteFactors]] = await Promise.all([
      local.query('SELECT id, name, weight, enabled FROM recommendation_factors ORDER BY id'),
      remote.query('SELECT id, name, weight, enabled FROM recommendation_factors ORDER BY id')
    ]);
    const normalized = rows => rows.map(row => [row.id, row.name, Number(row.weight), Number(row.enabled)]);
    if (remoteFactors.length && JSON.stringify(normalized(localFactors)) !== JSON.stringify(normalized(remoteFactors))) {
      throw new Error('Seeded remote factors differ from local factors; migration stopped');
    }
    await remote.beginTransaction();
    try {
      for (const { table, source } of counts) {
        if (table === 'recommendation_factors' && remoteFactors.length) continue;
        if (!source) continue;
        const [rows, fields] = await local.query(`SELECT * FROM ${table}`);
        const columns = fields.map(field => field.name);
        const names = columns.map(name => `\`${name}\``).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        for (const row of rows) {
          await remote.execute(`INSERT INTO ${table} (${names}) VALUES (${placeholders})`, columns.map(name => row[name]));
        }
      }
      await remote.commit();
      console.log('Existing local app data copied to Tokyo database.');
    } catch (error) { await remote.rollback(); throw error; }
  } finally { await local.end(); await remote.end(); }
}
main().catch(error => { console.error('Migration failed:', error.code || error.message); process.exitCode = 1; });
