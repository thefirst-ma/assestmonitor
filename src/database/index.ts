import initSqlJs from 'sql.js';
import type { Database as SqlJsDatabase } from 'sql.js';
import mysql, { Pool } from 'mysql2/promise';
import { DATABASE_PATH, databaseConfig } from '../config';
import {
  Asset,
  AssetType,
  PriceData,
  RecommendationAction,
  RecommendationFactor,
  RecommendationHistoryItem,
  RecommendationHorizon,
  RecommendationReview,
  RecommendationRun,
  ResearchProfile,
  ReviewOutcome,
  StagedRecommendations,
  StockFactorValue,
  StrategicFactor,
  User,
  UserPlan
} from '../types';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { UserNotification } from '../services/user-notifications';

const notificationQueries: Record<string, string> = JSON.parse(fs.readFileSync(path.join(__dirname, '../../sql/notification_queries.json'), 'utf8'));
const researchQueries: Record<string, string> = JSON.parse(fs.readFileSync(path.join(__dirname, '../../sql/research_queries.json'), 'utf8'));

type SqlParam = string | number | null | undefined;

interface QueryResult {
  values: any[][];
}

interface DatabaseBackend {
  init(): Promise<void>;
  exec(sql: string, params?: SqlParam[]): Promise<QueryResult>;
  run(sql: string, params?: SqlParam[]): Promise<void>;
  close?(): Promise<void>;
}

class SqlJsBackend implements DatabaseBackend {
  private db?: SqlJsDatabase;

  async init(): Promise<void> {
    const SQL = await initSqlJs();
    const dataDir = path.dirname(DATABASE_PATH);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.db = fs.existsSync(DATABASE_PATH)
      ? new SQL.Database(fs.readFileSync(DATABASE_PATH))
      : new SQL.Database();

    await this.createSchema();
    this.database.run(fs.readFileSync(path.join(__dirname, '../../sql/004_user_notifications_sqljs.sql'), 'utf8'));
    await this.seedDefaultRecommendationFactors();
    this.save();
  }

  async exec(sql: string, params: SqlParam[] = []): Promise<QueryResult> {
    const result = this.database.exec(sql, params as any[]);
    return { values: result.length === 0 ? [] : result[0].values };
  }

  async run(sql: string, params: SqlParam[] = []): Promise<void> {
    this.database.run(sql, params as any[]);
    this.save();
  }

  private get database(): SqlJsDatabase {
    if (!this.db) throw new Error('Database is not initialized');
    return this.db;
  }

  private save(): void {
    fs.writeFileSync(DATABASE_PATH, this.database.export());
  }

  private async createSchema(): Promise<void> {
    const statements = [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        plan TEXT DEFAULT 'free',
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );`,
      `CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        interval INTEGER DEFAULT NULL,
        threshold REAL DEFAULT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );`,
      `CREATE TABLE IF NOT EXISTS prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id TEXT NOT NULL,
        price REAL NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (asset_id) REFERENCES assets(id)
      );`,
      `CREATE INDEX IF NOT EXISTS idx_prices_asset_timestamp ON prices(asset_id, timestamp);`,
      `CREATE TABLE IF NOT EXISTS research_profiles (
        symbol TEXT PRIMARY KEY,
        moat_score INTEGER NOT NULL,
        moat_label TEXT NOT NULL,
        moat_summary TEXT NOT NULL,
        leadership_score INTEGER NOT NULL,
        leadership_label TEXT NOT NULL,
        leadership_summary TEXT NOT NULL,
        industry_score INTEGER NOT NULL,
        industry_label TEXT NOT NULL,
        industry_summary TEXT NOT NULL,
        policy_score INTEGER NOT NULL,
        policy_label TEXT NOT NULL,
        policy_summary TEXT NOT NULL,
        confidence INTEGER NOT NULL DEFAULT 60,
        notes TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS recommendation_runs (
        id TEXT PRIMARY KEY,
        generated_at INTEGER NOT NULL,
        source TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS recommendation_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        horizon TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        score INTEGER NOT NULL,
        action TEXT NOT NULL,
        price REAL DEFAULT NULL,
        payload_json TEXT NOT NULL,
        factor_contributions_json TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY (run_id) REFERENCES recommendation_runs(id)
      );`,
      `CREATE INDEX IF NOT EXISTS idx_recommendation_items_symbol ON recommendation_items(symbol);`,
      `CREATE INDEX IF NOT EXISTS idx_recommendation_items_run ON recommendation_items(run_id);`,
      `CREATE TABLE IF NOT EXISTS recommendation_factors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        weight REAL NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS stock_factor_values (
        symbol TEXT NOT NULL,
        factor_id TEXT NOT NULL,
        score INTEGER NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (symbol, factor_id),
        FOREIGN KEY (factor_id) REFERENCES recommendation_factors(id)
      );`,
      `CREATE TABLE IF NOT EXISTS recommendation_reviews (
        run_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        horizon TEXT NOT NULL,
        outcome TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        actual_return REAL DEFAULT NULL,
        reviewed_at INTEGER NOT NULL,
        PRIMARY KEY (run_id, symbol, horizon),
        FOREIGN KEY (run_id) REFERENCES recommendation_runs(id)
      );`
    ];

    for (const statement of statements) this.database.run(statement);
    for (const migration of [
      `ALTER TABLE assets ADD COLUMN interval INTEGER DEFAULT NULL;`,
      `ALTER TABLE assets ADD COLUMN threshold REAL DEFAULT NULL;`,
      `ALTER TABLE assets ADD COLUMN user_id TEXT NOT NULL DEFAULT '';`,
      `ALTER TABLE recommendation_items ADD COLUMN factor_contributions_json TEXT NOT NULL DEFAULT '[]';`
    ]) {
      try { this.database.run(migration); } catch {}
    }
  }

  private async seedDefaultRecommendationFactors(): Promise<void> {
    const result = this.database.exec('SELECT COUNT(*) FROM recommendation_factors');
    const count = result.length > 0 ? Number(result[0].values[0][0]) : 0;
    if (count > 0) return;
    for (const factor of defaultRecommendationFactors()) {
      this.database.run(`
        INSERT INTO recommendation_factors (id, name, description, weight, enabled, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [factor.id, factor.name, factor.description, factor.weight, factor.enabled ? 1 : 0, factor.sortOrder, factor.createdAt, factor.updatedAt]);
    }
  }
}

class MySqlBackend implements DatabaseBackend {
  private pool?: Pool;

  async init(): Promise<void> {
    this.pool = mysql.createPool({
      host: databaseConfig.mysql.host,
      port: databaseConfig.mysql.port,
      database: databaseConfig.mysql.database,
      user: databaseConfig.mysql.user,
      password: databaseConfig.mysql.password,
      waitForConnections: true,
      connectionLimit: databaseConfig.mysql.connectionLimit,
      connectTimeout: 12000,
      ssl: databaseConfig.mysql.sslCa ? { ca: databaseConfig.mysql.sslCa, rejectUnauthorized: true } : undefined,
      namedPlaceholders: false,
      decimalNumbers: true
    });
    await this.pool.query('SELECT 1');
    await this.assertRequiredTables();
  }

  async exec(sql: string, params: SqlParam[] = []): Promise<QueryResult> {
    const [rows] = await this.poolInstance.query(sql, params);
    return { values: Array.isArray(rows) ? (rows as any[]).map(row => Object.values(row)) : [] };
  }

  async rows<T = any>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const [rows] = await this.poolInstance.query(sql, params);
    return Array.isArray(rows) ? rows as T[] : [];
  }

  async run(sql: string, params: SqlParam[] = []): Promise<void> {
    await this.poolInstance.query(sql, params);
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }

  private get poolInstance(): Pool {
    if (!this.pool) throw new Error('MySQL pool is not initialized');
    return this.pool;
  }

  private async assertRequiredTables(): Promise<void> {
    const required = [
      'users',
      'assets',
      'prices',
      'research_profiles',
      'recommendation_factors',
      'stock_factor_values',
      'recommendation_runs',
      'recommendation_items',
      'recommendation_reviews',
      'user_notifications'
    ];
    const placeholders = required.map(() => '?').join(',');
    const rows = await this.rows<{ table_name: string }>(
      `SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = ? AND table_name IN (${placeholders})`,
      [databaseConfig.mysql.database, ...required]
    );
    const found = new Set(rows.map(row => row.table_name));
    const missing = required.filter(table => !found.has(table));
    if (missing.length > 0) {
      throw new Error(`MySQL 缺少必要表: ${missing.join(', ')}。请先执行 sql/ 下 001 至 004 的 *_mysql.sql 文件`);
    }
  }
}

function defaultRecommendationFactors(): RecommendationFactor[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    { id: 'moat', name: '企业护城河', description: '品牌、网络效应、规模、技术壁垒、转换成本和渠道优势。', weight: 0.30, enabled: true, sortOrder: 10, createdAt: now, updatedAt: now },
    { id: 'leadership', name: '负责人质量', description: '主要负责人的战略判断、执行节奏、资本配置、风险意识和长期主义。', weight: 0.22, enabled: true, sortOrder: 20, createdAt: now, updatedAt: now },
    { id: 'industryTrend', name: '行业趋势', description: '行业需求、技术路线、竞争格局和未来增速。', weight: 0.28, enabled: true, sortOrder: 30, createdAt: now, updatedAt: now },
    { id: 'policyImpact', name: '政策影响', description: '监管、税收、贸易、产业政策和地缘限制对公司的影响。', weight: 0.20, enabled: true, sortOrder: 40, createdAt: now, updatedAt: now }
  ];
}

export class AssetDatabase {
  async getUserNotifications(userId: string): Promise<UserNotification[]> {
    await this.init();
    const rows = await this.queryRows<any>(notificationQueries.list, [userId]);
    return rows.map(row => ({
      userId: this.getValue(row, 'user_id', 0), channel: this.getValue(row, 'channel', 1),
      enabled: !!this.getValue(row, 'enabled', 2), secret: this.getValue(row, 'secret', 3),
      destination: this.getValue(row, 'destination', 4), priceAlerts: !!this.getValue(row, 'price_alerts', 5),
      dailyReport: !!this.getValue(row, 'daily_report', 6)
    }));
  }

  async saveUserNotification(setting: UserNotification): Promise<void> {
    await this.init();
    await this.backend.run(notificationQueries[this.isMysql ? 'mysqlSave' : 'sqljsSave'], [
      setting.userId, setting.channel, Number(setting.enabled), setting.secret, setting.destination,
      Number(setting.priceAlerts), Number(setting.dailyReport), Math.floor(Date.now() / 1000)
    ]);
  }

  async getNotificationSubscribers(): Promise<string[]> {
    await this.init();
    return (await this.queryRows<any>(notificationQueries.subscribers)).map(row => this.getValue(row, 'user_id', 0));
  }

  private backend: DatabaseBackend = databaseConfig.driver === 'mysql' ? new MySqlBackend() : new SqlJsBackend();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.backend.init();
    this.initialized = true;
  }

  get isMysql(): boolean {
    return databaseConfig.driver === 'mysql';
  }

  async createUser(email: string, passwordHash: string): Promise<User> {
    await this.init();
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    if (this.isMysql) {
      await this.backend.run(
        'INSERT INTO users (id, email, password_hash, plan, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, email, passwordHash, 'free', now]
      );
    } else {
      await this.backend.run(
        'INSERT INTO users (id, email, password_hash, plan, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, email, passwordHash, 'free', now]
      );
    }
    return { id, email, passwordHash, plan: 'free', createdAt: now };
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    await this.init();
    const rows = await this.queryRows<any>('SELECT id, email, password_hash, plan, stripe_customer_id, stripe_subscription_id, created_at FROM users WHERE email = ?', [email]);
    return rows[0] ? this.rowToUser(rows[0]) : undefined;
  }

  async getUserById(id: string): Promise<User | undefined> {
    await this.init();
    const rows = await this.queryRows<any>('SELECT id, email, password_hash, plan, stripe_customer_id, stripe_subscription_id, created_at FROM users WHERE id = ?', [id]);
    return rows[0] ? this.rowToUser(rows[0]) : undefined;
  }

  async updateUserPlan(userId: string, plan: UserPlan, stripeCustomerId?: string, stripeSubscriptionId?: string): Promise<void> {
    await this.init();
    await this.backend.run('UPDATE users SET plan = ?, stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?',
      [plan, stripeCustomerId ?? null, stripeSubscriptionId ?? null, userId]);
  }

  async updateStripeCustomer(userId: string, stripeCustomerId: string): Promise<void> {
    await this.init();
    await this.backend.run('UPDATE users SET stripe_customer_id = ? WHERE id = ?', [stripeCustomerId, userId]);
  }

  async getUserByStripeCustomerId(customerId: string): Promise<User | undefined> {
    await this.init();
    const rows = await this.queryRows<any>('SELECT id, email, password_hash, plan, stripe_customer_id, stripe_subscription_id, created_at FROM users WHERE stripe_customer_id = ?', [customerId]);
    return rows[0] ? this.rowToUser(rows[0]) : undefined;
  }

  async addAsset(id: string, userId: string, type: AssetType, symbol: string, name: string, interval?: number, threshold?: number): Promise<void> {
    await this.init();
    const createdAt = Math.floor(Date.now() / 1000);
    if (this.isMysql) {
      await this.backend.run(`
        INSERT INTO assets (id, user_id, type, symbol, name, enabled, interval_ms, threshold, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), type = VALUES(type), symbol = VALUES(symbol),
          name = VALUES(name), enabled = 1, interval_ms = VALUES(interval_ms), threshold = VALUES(threshold)
      `, [id, userId, type, symbol, name, interval ?? null, threshold ?? null, createdAt]);
    } else {
      await this.backend.run(
        'INSERT OR REPLACE INTO assets (id, user_id, type, symbol, name, enabled, interval, threshold) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
        [id, userId, type, symbol, name, interval ?? null, threshold ?? null]
      );
    }
  }

  async updateAsset(id: string, interval?: number, threshold?: number): Promise<void> {
    await this.init();
    await this.backend.run(
      this.isMysql ? 'UPDATE assets SET interval_ms = ?, threshold = ? WHERE id = ?' : 'UPDATE assets SET interval = ?, threshold = ? WHERE id = ?',
      [interval ?? null, threshold ?? null, id]
    );
  }

  async removeAsset(id: string): Promise<void> {
    await this.init();
    await this.backend.run('UPDATE assets SET enabled = 0 WHERE id = ?', [id]);
  }

  async getEnabledAssets(): Promise<Asset[]> {
    await this.init();
    const rows = await this.queryRows<any>(this.assetSelectSql('WHERE enabled = 1'));
    return rows.map(row => this.rowToAsset(row));
  }

  async getAssetsByUser(userId: string): Promise<Asset[]> {
    await this.init();
    const rows = await this.queryRows<any>(this.assetSelectSql('WHERE user_id = ? AND enabled = 1'), [userId]);
    return rows.map(row => this.rowToAsset(row));
  }

  async getAssetByIdForUser(assetId: string, userId: string): Promise<Asset | undefined> {
    await this.init();
    const rows = await this.queryRows<any>(this.assetSelectSql('WHERE id = ? AND user_id = ? AND enabled = 1'), [assetId, userId]);
    return rows[0] ? this.rowToAsset(rows[0]) : undefined;
  }

  async getAssetCountByUser(userId: string): Promise<number> {
    await this.init();
    const rows = await this.queryRows<any>('SELECT COUNT(*) AS count FROM assets WHERE user_id = ? AND enabled = 1', [userId]);
    return Number(this.getValue(rows[0], 'count', 0));
  }

  async savePrice(data: PriceData): Promise<void> {
    await this.init();
    await this.backend.run('INSERT INTO prices (asset_id, price, timestamp) VALUES (?, ?, ?)',
      [data.assetId, data.price, data.timestamp]);
  }

  async getLatestPrice(assetId: string): Promise<PriceData | undefined> {
    await this.init();
    const rows = await this.queryRows<any>('SELECT asset_id, price, timestamp FROM prices WHERE asset_id = ? ORDER BY timestamp DESC LIMIT 1', [assetId]);
    return rows[0] ? this.rowToPrice(rows[0]) : undefined;
  }

  async getHistoricalPrices(assetId: string, fromTimestamp: number): Promise<PriceData[]> {
    await this.init();
    const rows = await this.queryRows<any>('SELECT asset_id, price, timestamp FROM prices WHERE asset_id = ? AND timestamp >= ? ORDER BY timestamp ASC', [assetId, fromTimestamp]);
    return rows.map(row => this.rowToPrice(row));
  }

  async getLastNPrices(assetId: string, n: number): Promise<PriceData[]> {
    await this.init();
    const rows = await this.queryRows<any>('SELECT asset_id, price, timestamp FROM prices WHERE asset_id = ? ORDER BY timestamp DESC LIMIT ?', [assetId, n]);
    return rows.map(row => this.rowToPrice(row)).reverse();
  }

  async cleanOldData(): Promise<void> {
    await this.init();
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
    await this.backend.run('DELETE FROM prices WHERE timestamp < ?', [thirtyDaysAgo]);
  }

  async getResearchProfiles(): Promise<ResearchProfile[]> {
    await this.init();
    const rows = await this.queryRows<any>(`
      SELECT symbol,
        moat_score, moat_label, moat_summary,
        leadership_score, leadership_label, leadership_summary,
        industry_score, industry_label, industry_summary,
        policy_score, policy_label, policy_summary,
        confidence, notes, updated_at
      FROM research_profiles ORDER BY symbol ASC
    `);
    return rows.map(row => this.rowToResearchProfile(row));
  }

  async getResearchProfile(symbol: string): Promise<ResearchProfile | undefined> {
    await this.init();
    const rows = await this.queryRows<any>(`
      SELECT symbol,
        moat_score, moat_label, moat_summary,
        leadership_score, leadership_label, leadership_summary,
        industry_score, industry_label, industry_summary,
        policy_score, policy_label, policy_summary,
        confidence, notes, updated_at
      FROM research_profiles WHERE symbol = ?
    `, [symbol.toUpperCase()]);
    return rows[0] ? this.rowToResearchProfile(rows[0]) : undefined;
  }

  async upsertResearchProfile(profile: ResearchProfile): Promise<ResearchProfile> {
    await this.init();
    const normalized: ResearchProfile = {
      ...profile,
      symbol: profile.symbol.toUpperCase(),
      confidence: Math.min(100, Math.max(0, Math.round(profile.confidence))),
      updatedAt: Math.floor(Date.now() / 1000)
    };
    if (this.isMysql) {
      await this.backend.run(`
        INSERT INTO research_profiles (
          symbol, moat_score, moat_label, moat_summary, leadership_score, leadership_label, leadership_summary,
          industry_score, industry_label, industry_summary, policy_score, policy_label, policy_summary,
          confidence, notes, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          moat_score = VALUES(moat_score), moat_label = VALUES(moat_label), moat_summary = VALUES(moat_summary),
          leadership_score = VALUES(leadership_score), leadership_label = VALUES(leadership_label), leadership_summary = VALUES(leadership_summary),
          industry_score = VALUES(industry_score), industry_label = VALUES(industry_label), industry_summary = VALUES(industry_summary),
          policy_score = VALUES(policy_score), policy_label = VALUES(policy_label), policy_summary = VALUES(policy_summary),
          confidence = VALUES(confidence), notes = VALUES(notes), updated_at = VALUES(updated_at)
      `, this.researchProfileParams(normalized));
    } else {
      await this.backend.run(`
        INSERT OR REPLACE INTO research_profiles (
          symbol, moat_score, moat_label, moat_summary, leadership_score, leadership_label, leadership_summary,
          industry_score, industry_label, industry_summary, policy_score, policy_label, policy_summary,
          confidence, notes, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, this.researchProfileParams(normalized));
    }
    return normalized;
  }

  async getRecommendationFactors(includeDisabled = true): Promise<RecommendationFactor[]> {
    await this.init();
    const rows = await this.queryRows<any>(`
      SELECT id, name, description, weight, enabled, sort_order, created_at, updated_at
      FROM recommendation_factors
      ${includeDisabled ? '' : 'WHERE enabled = 1'}
      ORDER BY sort_order ASC, name ASC
    `);
    return rows.map(row => this.rowToRecommendationFactor(row));
  }

  async upsertRecommendationFactor(input: Partial<RecommendationFactor> & Pick<RecommendationFactor, 'name'>): Promise<RecommendationFactor> {
    await this.init();
    const now = Math.floor(Date.now() / 1000);
    const id = String(input.id || input.name)
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || crypto.randomUUID();
    const existing = (await this.getRecommendationFactors(true)).find(item => item.id === id);
    const factor: RecommendationFactor = {
      id,
      name: String(input.name || existing?.name || id).trim(),
      description: String(input.description ?? existing?.description ?? ''),
      weight: Math.max(0, Number(input.weight ?? existing?.weight ?? 1)),
      enabled: input.enabled ?? existing?.enabled ?? true,
      sortOrder: Math.round(Number(input.sortOrder ?? existing?.sortOrder ?? 100)),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    if (this.isMysql) {
      await this.backend.run(`
        INSERT INTO recommendation_factors (id, name, description, weight, enabled, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), weight = VALUES(weight),
          enabled = VALUES(enabled), sort_order = VALUES(sort_order), updated_at = VALUES(updated_at)
      `, this.recommendationFactorParams(factor));
    } else {
      await this.backend.run(`
        INSERT OR REPLACE INTO recommendation_factors (id, name, description, weight, enabled, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, this.recommendationFactorParams(factor));
    }
    return factor;
  }

  async getStockFactorValues(symbol: string): Promise<StockFactorValue[]> {
    await this.init();
    const rows = await this.queryRows<any>(`
      SELECT symbol, factor_id, score, label, summary, updated_at
      FROM stock_factor_values
      WHERE symbol = ?
      ORDER BY factor_id ASC
    `, [symbol.toUpperCase()]);
    return rows.map(row => this.rowToStockFactorValue(row));
  }

  async upsertStockFactorValue(input: StockFactorValue): Promise<StockFactorValue> {
    await this.init();
    const value: StockFactorValue = {
      symbol: String(input.symbol || '').trim().toUpperCase(),
      factorId: String(input.factorId || '').trim(),
      score: Math.min(100, Math.max(0, Math.round(Number(input.score ?? 60)))),
      label: String(input.label || ''),
      summary: String(input.summary || ''),
      updatedAt: Math.floor(Date.now() / 1000)
    };
    if (!value.symbol || !value.factorId) throw new Error('symbol and factorId are required');
    if (this.isMysql) {
      await this.backend.run(`
        INSERT INTO stock_factor_values (symbol, factor_id, score, label, summary, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE score = VALUES(score), label = VALUES(label), summary = VALUES(summary), updated_at = VALUES(updated_at)
      `, this.stockFactorValueParams(value));
    } else {
      await this.backend.run(`
        INSERT OR REPLACE INTO stock_factor_values (symbol, factor_id, score, label, summary, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, this.stockFactorValueParams(value));
    }
    return value;
  }

  async upsertRecommendationReview(input: RecommendationReview): Promise<RecommendationReview> {
    await this.init();
    const review: RecommendationReview = {
      runId: input.runId,
      symbol: String(input.symbol || '').trim().toUpperCase(),
      horizon: input.horizon,
      outcome: input.outcome,
      reason: String(input.reason || ''),
      actualReturn: input.actualReturn === undefined || input.actualReturn === null ? undefined : Number(input.actualReturn),
      reviewedAt: Math.floor(Date.now() / 1000)
    };
    if (!review.runId || !review.symbol || !review.horizon) throw new Error('runId, symbol and horizon are required');
    if (this.isMysql) {
      await this.backend.run(`
        INSERT INTO recommendation_reviews (run_id, symbol, horizon, outcome, reason, actual_return, reviewed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE outcome = VALUES(outcome), reason = VALUES(reason),
          actual_return = VALUES(actual_return), reviewed_at = VALUES(reviewed_at)
      `, this.recommendationReviewParams(review));
    } else {
      await this.backend.run(`
        INSERT OR REPLACE INTO recommendation_reviews (run_id, symbol, horizon, outcome, reason, actual_return, reviewed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, this.recommendationReviewParams(review));
    }
    return review;
  }

  async saveRecommendationRun(staged: StagedRecommendations, source: string): Promise<RecommendationRun> {
    await this.init();
    const run: RecommendationRun = {
      id: crypto.randomUUID(),
      generatedAt: Math.floor(Date.now() / 1000),
      source
    };
    await this.backend.run('INSERT INTO recommendation_runs (id, generated_at, source) VALUES (?, ?, ?)', [
      run.id,
      run.generatedAt,
      run.source
    ]);
    for (const [horizon, items] of Object.entries(staged) as Array<[RecommendationHorizon, any[]]>) {
      for (const item of items) {
        await this.backend.run(`
          INSERT INTO recommendation_items (run_id, horizon, symbol, name, score, action, price, payload_json, factor_contributions_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          run.id,
          horizon,
          item.symbol,
          item.name,
          item.score,
          item.action,
          item.price ?? null,
          JSON.stringify(item),
          JSON.stringify(item.factorContributions || [])
        ]);
      }
    }
    return run;
  }

  async getRecommendationRuns(limit = 20): Promise<RecommendationRun[]> {
    await this.init();
    const rows = await this.queryRows<any>('SELECT id, generated_at, source FROM recommendation_runs ORDER BY generated_at DESC LIMIT ?', [limit]);
    return rows.map(row => ({
      id: String(this.getValue(row, 'id', 0)),
      generatedAt: Number(this.getValue(row, 'generated_at', 1)),
      source: String(this.getValue(row, 'source', 2))
    }));
  }

  async getRecommendationHistory(limit = 100): Promise<RecommendationHistoryItem[]> {
    await this.init();
    const rows = await this.queryRows<any>(`
      SELECT i.run_id, r.generated_at, r.source, i.horizon, i.symbol, i.name, i.score, i.action, i.price,
        i.factor_contributions_json, rv.outcome, rv.reason, rv.actual_return, rv.reviewed_at
      FROM recommendation_items i
      JOIN recommendation_runs r ON r.id = i.run_id
      LEFT JOIN recommendation_reviews rv
        ON rv.run_id = i.run_id AND rv.symbol = i.symbol AND rv.horizon = i.horizon
      ORDER BY r.generated_at DESC, i.horizon ASC, i.score DESC
      LIMIT ?
    `, [limit]);
    return rows.map(row => this.rowToRecommendationHistoryItem(row));
  }

  async getLatestRecommendationSnapshot(): Promise<{ run: RecommendationRun | null; recommendations: StagedRecommendations }> {
    await this.init();
    const rows = await this.queryRows<any>(researchQueries.latestSnapshot);
    const recommendations: StagedRecommendations = { monthly: [], quarterly: [], yearly: [] };
    if (!rows.length) return { run: null, recommendations };
    const first = rows[0];
    const run = { id: String(this.getValue(first, 'run_id', 0)), generatedAt: Number(this.getValue(first, 'generated_at', 1)), source: String(this.getValue(first, 'source', 2)) };
    for (const row of rows) {
      const horizon = this.getValue(row, 'horizon', 3) as RecommendationHorizon;
      const raw = this.getValue(row, 'payload_json', 4);
      if (!['monthly', 'quarterly', 'yearly'].includes(horizon) || raw == null) continue;
      const item = typeof raw === 'string' ? JSON.parse(raw) : raw;
      recommendations[horizon].push({ ...item, horizon });
    }
    return { run, recommendations };
  }

  async getRecommendationHistoryBySymbol(symbol: string, limit = 30): Promise<RecommendationHistoryItem[]> {
    await this.init();
    const rows = await this.queryRows<any>(`
      SELECT i.run_id, r.generated_at, r.source, i.horizon, i.symbol, i.name, i.score, i.action, i.price,
        i.factor_contributions_json, rv.outcome, rv.reason, rv.actual_return, rv.reviewed_at
      FROM recommendation_items i
      JOIN recommendation_runs r ON r.id = i.run_id
      LEFT JOIN recommendation_reviews rv
        ON rv.run_id = i.run_id AND rv.symbol = i.symbol AND rv.horizon = i.horizon
      WHERE i.symbol = ?
      ORDER BY r.generated_at DESC, i.horizon ASC
      LIMIT ?
    `, [symbol.toUpperCase(), limit]);
    return rows.map(row => this.rowToRecommendationHistoryItem(row));
  }

  private async queryRows<T = any>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    if (this.backend instanceof MySqlBackend) return this.backend.rows<T>(sql, params);
    const result = await this.backend.exec(sql, params);
    return result.values as T[];
  }

  private assetSelectSql(where: string): string {
    return this.isMysql
      ? `SELECT id, user_id, type, symbol, name, enabled, interval_ms, threshold FROM assets ${where}`
      : `SELECT id, user_id, type, symbol, name, enabled, interval, threshold FROM assets ${where}`;
  }

  private getValue(row: any, key: string, index: number): any {
    return Array.isArray(row) ? row[index] : row?.[key];
  }

  private rowToUser(row: any): User {
    return {
      id: String(this.getValue(row, 'id', 0)),
      email: String(this.getValue(row, 'email', 1)),
      passwordHash: String(this.getValue(row, 'password_hash', 2)),
      plan: this.getValue(row, 'plan', 3) as UserPlan,
      stripeCustomerId: this.getValue(row, 'stripe_customer_id', 4) || undefined,
      stripeSubscriptionId: this.getValue(row, 'stripe_subscription_id', 5) || undefined,
      createdAt: Number(this.getValue(row, 'created_at', 6))
    };
  }

  private rowToAsset(row: any): Asset {
    return {
      id: String(this.getValue(row, 'id', 0)),
      userId: String(this.getValue(row, 'user_id', 1) || ''),
      type: this.getValue(row, 'type', 2) as AssetType,
      symbol: String(this.getValue(row, 'symbol', 3)),
      name: String(this.getValue(row, 'name', 4)),
      enabled: Number(this.getValue(row, 'enabled', 5)) === 1,
      interval: this.getValue(row, 'interval_ms', 6) === null || this.getValue(row, 'interval_ms', 6) === undefined ? undefined : Number(this.getValue(row, 'interval_ms', 6)),
      threshold: this.getValue(row, 'threshold', 7) === null || this.getValue(row, 'threshold', 7) === undefined ? undefined : Number(this.getValue(row, 'threshold', 7))
    };
  }

  private rowToPrice(row: any): PriceData {
    return {
      assetId: String(this.getValue(row, 'asset_id', 0)),
      price: Number(this.getValue(row, 'price', 1)),
      timestamp: Number(this.getValue(row, 'timestamp', 2))
    };
  }

  private rowToResearchProfile(row: any): ResearchProfile {
    const factor = (score: any, label: any, summary: any): StrategicFactor => ({
      score: Number(score),
      label: String(label || ''),
      summary: String(summary || '')
    });
    return {
      symbol: String(this.getValue(row, 'symbol', 0)),
      moat: factor(this.getValue(row, 'moat_score', 1), this.getValue(row, 'moat_label', 2), this.getValue(row, 'moat_summary', 3)),
      leadership: factor(this.getValue(row, 'leadership_score', 4), this.getValue(row, 'leadership_label', 5), this.getValue(row, 'leadership_summary', 6)),
      industryTrend: factor(this.getValue(row, 'industry_score', 7), this.getValue(row, 'industry_label', 8), this.getValue(row, 'industry_summary', 9)),
      policyImpact: factor(this.getValue(row, 'policy_score', 10), this.getValue(row, 'policy_label', 11), this.getValue(row, 'policy_summary', 12)),
      confidence: Number(this.getValue(row, 'confidence', 13)),
      notes: String(this.getValue(row, 'notes', 14) || ''),
      updatedAt: Number(this.getValue(row, 'updated_at', 15))
    };
  }

  private rowToRecommendationFactor(row: any): RecommendationFactor {
    return {
      id: String(this.getValue(row, 'id', 0)),
      name: String(this.getValue(row, 'name', 1)),
      description: String(this.getValue(row, 'description', 2) || ''),
      weight: Number(this.getValue(row, 'weight', 3)),
      enabled: Number(this.getValue(row, 'enabled', 4)) === 1,
      sortOrder: Number(this.getValue(row, 'sort_order', 5)),
      createdAt: Number(this.getValue(row, 'created_at', 6)),
      updatedAt: Number(this.getValue(row, 'updated_at', 7))
    };
  }

  private rowToStockFactorValue(row: any): StockFactorValue {
    return {
      symbol: String(this.getValue(row, 'symbol', 0)),
      factorId: String(this.getValue(row, 'factor_id', 1)),
      score: Number(this.getValue(row, 'score', 2)),
      label: String(this.getValue(row, 'label', 3) || ''),
      summary: String(this.getValue(row, 'summary', 4) || ''),
      updatedAt: Number(this.getValue(row, 'updated_at', 5))
    };
  }

  private rowToRecommendationHistoryItem(row: any): RecommendationHistoryItem {
    const rawFactors = this.getValue(row, 'factor_contributions_json', 9);
    let factorContributions = [];
    try {
      factorContributions = typeof rawFactors === 'string' ? JSON.parse(rawFactors || '[]') : rawFactors || [];
    } catch {
      factorContributions = [];
    }
    return {
      runId: String(this.getValue(row, 'run_id', 0)),
      generatedAt: Number(this.getValue(row, 'generated_at', 1)),
      source: String(this.getValue(row, 'source', 2)),
      horizon: this.getValue(row, 'horizon', 3) as RecommendationHorizon,
      symbol: String(this.getValue(row, 'symbol', 4)),
      name: String(this.getValue(row, 'name', 5)),
      score: Number(this.getValue(row, 'score', 6)),
      action: this.getValue(row, 'action', 7) as RecommendationAction,
      price: this.getValue(row, 'price', 8) === null || this.getValue(row, 'price', 8) === undefined ? undefined : Number(this.getValue(row, 'price', 8)),
      factorContributions,
      reviewOutcome: (this.getValue(row, 'outcome', 10) as ReviewOutcome | null) || undefined,
      reviewReason: (this.getValue(row, 'reason', 11) as string | null) || undefined,
      actualReturn: this.getValue(row, 'actual_return', 12) === null || this.getValue(row, 'actual_return', 12) === undefined ? undefined : Number(this.getValue(row, 'actual_return', 12)),
      reviewedAt: this.getValue(row, 'reviewed_at', 13) === null || this.getValue(row, 'reviewed_at', 13) === undefined ? undefined : Number(this.getValue(row, 'reviewed_at', 13))
    };
  }

  private researchProfileParams(profile: ResearchProfile): SqlParam[] {
    return [
      profile.symbol,
      profile.moat.score, profile.moat.label, profile.moat.summary,
      profile.leadership.score, profile.leadership.label, profile.leadership.summary,
      profile.industryTrend.score, profile.industryTrend.label, profile.industryTrend.summary,
      profile.policyImpact.score, profile.policyImpact.label, profile.policyImpact.summary,
      profile.confidence, profile.notes, profile.updatedAt
    ];
  }

  private recommendationFactorParams(factor: RecommendationFactor): SqlParam[] {
    return [factor.id, factor.name, factor.description, factor.weight, factor.enabled ? 1 : 0, factor.sortOrder, factor.createdAt, factor.updatedAt];
  }

  private stockFactorValueParams(value: StockFactorValue): SqlParam[] {
    return [value.symbol, value.factorId, value.score, value.label, value.summary, value.updatedAt];
  }

  private recommendationReviewParams(review: RecommendationReview): SqlParam[] {
    return [review.runId, review.symbol, review.horizon, review.outcome, review.reason, review.actualReturn ?? null, review.reviewedAt];
  }
}

export const database = new AssetDatabase();
