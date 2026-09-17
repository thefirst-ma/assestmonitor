import dotenv from 'dotenv';
import initSqlJs from 'sql.js';
import type { Database as SqlJsDatabase } from 'sql.js';
import mysql from 'mysql2/promise';
import * as fs from 'fs';
import { DATABASE_PATH, databaseConfig } from '../config';

dotenv.config();

type Row = Record<string, any>;

const requiredTables = [
  'users',
  'assets',
  'prices',
  'research_profiles',
  'recommendation_factors',
  'stock_factor_values',
  'recommendation_runs',
  'recommendation_items',
  'recommendation_reviews'
];

async function main(): Promise<void> {
  if (!fs.existsSync(DATABASE_PATH)) {
    throw new Error(`sql.js database not found: ${DATABASE_PATH}`);
  }

  const SQL = await initSqlJs();
  const sqlite = new SQL.Database(fs.readFileSync(DATABASE_PATH));
  const pool = mysql.createPool({
    host: databaseConfig.mysql.host,
    port: databaseConfig.mysql.port,
    database: databaseConfig.mysql.database,
    user: databaseConfig.mysql.user,
    password: databaseConfig.mysql.password,
    waitForConnections: true,
    connectionLimit: databaseConfig.mysql.connectionLimit,
    decimalNumbers: true
  });

  try {
    await assertTables(pool);
    const counts: Record<string, number> = {};

    counts.users = await migrateRows(sqlite, pool, 'users',
      'SELECT id, email, password_hash, plan, stripe_customer_id, stripe_subscription_id, created_at FROM users',
      row => [
        row.id,
        row.email,
        row.password_hash,
        row.plan || 'free',
        row.stripe_customer_id ?? null,
        row.stripe_subscription_id ?? null,
        Number(row.created_at || unixNow())
      ],
      `INSERT INTO users (id, email, password_hash, plan, stripe_customer_id, stripe_subscription_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE email = VALUES(email), password_hash = VALUES(password_hash), plan = VALUES(plan),
         stripe_customer_id = VALUES(stripe_customer_id), stripe_subscription_id = VALUES(stripe_subscription_id)`
    );

    counts.assets = await migrateRows(sqlite, pool, 'assets',
      'SELECT id, user_id, type, symbol, name, enabled, interval, threshold, created_at FROM assets',
      row => [
        row.id,
        row.user_id || '',
        row.type,
        row.symbol,
        row.name,
        Number(row.enabled ?? 1),
        row.interval ?? null,
        row.threshold ?? null,
        Number(row.created_at || unixNow())
      ],
      `INSERT INTO assets (id, user_id, type, symbol, name, enabled, interval_ms, threshold, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), type = VALUES(type), symbol = VALUES(symbol),
         name = VALUES(name), enabled = VALUES(enabled), interval_ms = VALUES(interval_ms), threshold = VALUES(threshold)`
    );

    counts.prices = await migrateRows(sqlite, pool, 'prices',
      'SELECT asset_id, price, timestamp FROM prices',
      row => [row.asset_id, row.price, row.timestamp],
      'INSERT INTO prices (asset_id, price, timestamp) VALUES (?, ?, ?)'
    );

    counts.research_profiles = await migrateRows(sqlite, pool, 'research_profiles',
      `SELECT symbol, moat_score, moat_label, moat_summary, leadership_score, leadership_label, leadership_summary,
        industry_score, industry_label, industry_summary, policy_score, policy_label, policy_summary,
        confidence, notes, updated_at FROM research_profiles`,
      row => [
        row.symbol,
        row.moat_score, row.moat_label, row.moat_summary,
        row.leadership_score, row.leadership_label, row.leadership_summary,
        row.industry_score, row.industry_label, row.industry_summary,
        row.policy_score, row.policy_label, row.policy_summary,
        row.confidence, row.notes || '', row.updated_at
      ],
      `INSERT INTO research_profiles (
        symbol, moat_score, moat_label, moat_summary, leadership_score, leadership_label, leadership_summary,
        industry_score, industry_label, industry_summary, policy_score, policy_label, policy_summary,
        confidence, notes, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        moat_score = VALUES(moat_score), moat_label = VALUES(moat_label), moat_summary = VALUES(moat_summary),
        leadership_score = VALUES(leadership_score), leadership_label = VALUES(leadership_label), leadership_summary = VALUES(leadership_summary),
        industry_score = VALUES(industry_score), industry_label = VALUES(industry_label), industry_summary = VALUES(industry_summary),
        policy_score = VALUES(policy_score), policy_label = VALUES(policy_label), policy_summary = VALUES(policy_summary),
        confidence = VALUES(confidence), notes = VALUES(notes), updated_at = VALUES(updated_at)`
    );

    counts.recommendation_factors = await migrateRows(sqlite, pool, 'recommendation_factors',
      'SELECT id, name, description, weight, enabled, sort_order, created_at, updated_at FROM recommendation_factors',
      row => [row.id, row.name, row.description || '', row.weight, row.enabled ?? 1, row.sort_order ?? 0, row.created_at || unixNow(), row.updated_at || unixNow()],
      `INSERT INTO recommendation_factors (id, name, description, weight, enabled, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), weight = VALUES(weight),
        enabled = VALUES(enabled), sort_order = VALUES(sort_order), updated_at = VALUES(updated_at)`
    );

    counts.stock_factor_values = await migrateRows(sqlite, pool, 'stock_factor_values',
      'SELECT symbol, factor_id, score, label, summary, updated_at FROM stock_factor_values',
      row => [row.symbol, row.factor_id, row.score, row.label || '', row.summary || '', row.updated_at || unixNow()],
      `INSERT INTO stock_factor_values (symbol, factor_id, score, label, summary, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE score = VALUES(score), label = VALUES(label), summary = VALUES(summary), updated_at = VALUES(updated_at)`
    );

    counts.recommendation_runs = await migrateRows(sqlite, pool, 'recommendation_runs',
      'SELECT id, generated_at, source FROM recommendation_runs',
      row => [row.id, row.generated_at, row.source],
      `INSERT INTO recommendation_runs (id, generated_at, source)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE generated_at = VALUES(generated_at), source = VALUES(source)`
    );

    counts.recommendation_items = await migrateRows(sqlite, pool, 'recommendation_items',
      'SELECT run_id, horizon, symbol, name, score, action, price, payload_json, factor_contributions_json FROM recommendation_items',
      row => [
        row.run_id,
        row.horizon,
        row.symbol,
        row.name,
        row.score,
        row.action,
        row.price ?? null,
        validJson(row.payload_json, '{}'),
        validJson(row.factor_contributions_json, '[]')
      ],
      `INSERT INTO recommendation_items (run_id, horizon, symbol, name, score, action, price, payload_json, factor_contributions_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    counts.recommendation_reviews = await migrateRows(sqlite, pool, 'recommendation_reviews',
      'SELECT run_id, symbol, horizon, outcome, reason, actual_return, reviewed_at FROM recommendation_reviews',
      row => [row.run_id, row.symbol, row.horizon, row.outcome, row.reason || '', row.actual_return ?? null, row.reviewed_at || unixNow()],
      `INSERT INTO recommendation_reviews (run_id, symbol, horizon, outcome, reason, actual_return, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE outcome = VALUES(outcome), reason = VALUES(reason),
        actual_return = VALUES(actual_return), reviewed_at = VALUES(reviewed_at)`
    );

    console.log('Migration completed');
    for (const [table, count] of Object.entries(counts)) {
      console.log(`${table}: ${count}`);
    }
  } finally {
    sqlite.close();
    await pool.end();
  }
}

async function assertTables(pool: mysql.Pool): Promise<void> {
  const placeholders = requiredTables.map(() => '?').join(',');
  const [rows] = await pool.query<any[]>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name IN (${placeholders})`,
    [databaseConfig.mysql.database, ...requiredTables]
  );
  const found = new Set(rows.map(row => row.TABLE_NAME || row.table_name));
  const missing = requiredTables.filter(table => !found.has(table));
  if (missing.length > 0) {
    throw new Error(`MySQL missing tables: ${missing.join(', ')}. Execute sql/001, sql/002 and sql/003 first.`);
  }
}

async function migrateRows(
  sqlite: SqlJsDatabase,
  pool: mysql.Pool,
  tableName: string,
  selectSql: string,
  mapParams: (row: Row) => any[],
  insertSql: string
): Promise<number> {
  if (!sqliteTableExists(sqlite, tableName)) return 0;
  const rows = sqliteRows(sqlite, selectSql);
  for (const row of rows) {
    await pool.query(insertSql, mapParams(row));
  }
  return rows.length;
}

function sqliteTableExists(sqlite: SqlJsDatabase, tableName: string): boolean {
  const result = sqlite.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [tableName]);
  return result.length > 0 && result[0].values.length > 0;
}

function sqliteRows(sqlite: SqlJsDatabase, sql: string): Row[] {
  const result = sqlite.exec(sql);
  if (result.length === 0) return [];
  const columns = result[0].columns;
  return result[0].values.map(values => {
    const row: Row = {};
    columns.forEach((column, index) => {
      row[column] = values[index];
    });
    return row;
  });
}

function validJson(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  try {
    JSON.parse(value);
    return value;
  } catch {
    return fallback;
  }
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
