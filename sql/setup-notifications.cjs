const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config();

async function main() {
  if (process.env.DATABASE_DRIVER === 'mysql') {
    const mysql = require('mysql2/promise');
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'investment_monitor', multipleStatements: true
    });
    try {
      if ((process.env.MYSQL_DATABASE || 'investment_monitor') !== 'investment_monitor') throw new Error('004 migration targets investment_monitor; review SQL before applying to another database');
      await connection.query(fs.readFileSync(path.join(__dirname, '004_user_notifications_mysql.sql'), 'utf8'));
      console.log('Notification table ready.');
    } finally { await connection.end(); }
  }
  if (!process.env.NOTIFICATION_ENCRYPTION_KEY) {
    const envPath = path.join(__dirname, '../.env');
    const contents = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const line = `NOTIFICATION_ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}`;
    fs.writeFileSync(envPath, /^NOTIFICATION_ENCRYPTION_KEY=.*$/m.test(contents)
      ? contents.replace(/^NOTIFICATION_ENCRYPTION_KEY=.*$/m, line) : contents + '\n' + line + '\n');
    console.log('Generated local encryption key; retain it when backing up the database.');
  }
}
main().catch(error => { console.error('Notification setup failed:', error.code || error.message); process.exitCode = 1; });
