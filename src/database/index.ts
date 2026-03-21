import initSqlJs from 'sql.js';
import type { Database as SqlJsDatabase } from 'sql.js';
import { DATABASE_PATH } from '../config';
import { Asset, PriceData, AssetType, User, UserPlan } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

let db: SqlJsDatabase;

async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs();

  const dataDir = path.dirname(DATABASE_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (fs.existsSync(DATABASE_PATH)) {
    const buffer = fs.readFileSync(DATABASE_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT DEFAULT 'free',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS assets (
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
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL,
      price REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES assets(id)
    );
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_prices_asset_timestamp ON prices(asset_id, timestamp);`);

  // Migrations for older databases
  try { db.run(`ALTER TABLE assets ADD COLUMN interval INTEGER DEFAULT NULL;`); } catch {}
  try { db.run(`ALTER TABLE assets ADD COLUMN threshold REAL DEFAULT NULL;`); } catch {}
  try { db.run(`ALTER TABLE assets ADD COLUMN user_id TEXT NOT NULL DEFAULT '';`); } catch {}

  saveDatabase();
}

function saveDatabase(): void {
  const data = db.export();
  fs.writeFileSync(DATABASE_PATH, data);
}

export class AssetDatabase {
  async init(): Promise<void> {
    await initDatabase();
  }

  // ---- User methods ----

  createUser(email: string, passwordHash: string): User {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    db.run('INSERT INTO users (id, email, password_hash, plan, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, email, passwordHash, 'free', now]);
    saveDatabase();
    return { id, email, passwordHash, plan: 'free', createdAt: now };
  }

  getUserByEmail(email: string): User | undefined {
    const result = db.exec('SELECT id, email, password_hash, plan, stripe_customer_id, stripe_subscription_id, created_at FROM users WHERE email = ?', [email]);
    if (result.length === 0 || result[0].values.length === 0) return undefined;
    return this.rowToUser(result[0].values[0]);
  }

  getUserById(id: string): User | undefined {
    const result = db.exec('SELECT id, email, password_hash, plan, stripe_customer_id, stripe_subscription_id, created_at FROM users WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return undefined;
    return this.rowToUser(result[0].values[0]);
  }

  updateUserPlan(userId: string, plan: UserPlan, stripeCustomerId?: string, stripeSubscriptionId?: string): void {
    db.run('UPDATE users SET plan = ?, stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?',
      [plan, stripeCustomerId ?? null, stripeSubscriptionId ?? null, userId]);
    saveDatabase();
  }

  updateStripeCustomer(userId: string, stripeCustomerId: string): void {
    db.run('UPDATE users SET stripe_customer_id = ? WHERE id = ?', [stripeCustomerId, userId]);
    saveDatabase();
  }

  getUserByStripeCustomerId(customerId: string): User | undefined {
    const result = db.exec('SELECT id, email, password_hash, plan, stripe_customer_id, stripe_subscription_id, created_at FROM users WHERE stripe_customer_id = ?', [customerId]);
    if (result.length === 0 || result[0].values.length === 0) return undefined;
    return this.rowToUser(result[0].values[0]);
  }

  private rowToUser(row: any[]): User {
    return {
      id: row[0] as string,
      email: row[1] as string,
      passwordHash: row[2] as string,
      plan: row[3] as UserPlan,
      stripeCustomerId: (row[4] as string) || undefined,
      stripeSubscriptionId: (row[5] as string) || undefined,
      createdAt: row[6] as number
    };
  }

  // ---- Asset methods ----

  addAsset(id: string, userId: string, type: AssetType, symbol: string, name: string, interval?: number, threshold?: number): void {
    db.run('INSERT OR REPLACE INTO assets (id, user_id, type, symbol, name, enabled, interval, threshold) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
      [id, userId, type, symbol, name, interval ?? null, threshold ?? null]);
    saveDatabase();
  }

  updateAsset(id: string, interval?: number, threshold?: number): void {
    db.run('UPDATE assets SET interval = ?, threshold = ? WHERE id = ?',
      [interval ?? null, threshold ?? null, id]);
    saveDatabase();
  }

  removeAsset(id: string): void {
    db.run('UPDATE assets SET enabled = 0 WHERE id = ?', [id]);
    saveDatabase();
  }

  getEnabledAssets(): Asset[] {
    const result = db.exec('SELECT id, user_id, type, symbol, name, enabled, interval, threshold FROM assets WHERE enabled = 1');
    if (result.length === 0) return [];
    return result[0].values.map((row: any[]) => this.rowToAsset(row));
  }

  getAssetsByUser(userId: string): Asset[] {
    const result = db.exec('SELECT id, user_id, type, symbol, name, enabled, interval, threshold FROM assets WHERE user_id = ? AND enabled = 1', [userId]);
    if (result.length === 0) return [];
    return result[0].values.map((row: any[]) => this.rowToAsset(row));
  }

  getAssetCountByUser(userId: string): number {
    const result = db.exec('SELECT COUNT(*) FROM assets WHERE user_id = ? AND enabled = 1', [userId]);
    if (result.length === 0) return 0;
    return result[0].values[0][0] as number;
  }

  private rowToAsset(row: any[]): Asset {
    return {
      id: row[0] as string,
      userId: row[1] as string,
      type: row[2] as AssetType,
      symbol: row[3] as string,
      name: row[4] as string,
      enabled: row[5] === 1,
      interval: row[6] as number | undefined,
      threshold: row[7] as number | undefined
    };
  }

  // ---- Price methods ----

  savePrice(data: PriceData): void {
    db.run('INSERT INTO prices (asset_id, price, timestamp) VALUES (?, ?, ?)',
      [data.assetId, data.price, data.timestamp]);
    saveDatabase();
  }

  getLatestPrice(assetId: string): PriceData | undefined {
    const result = db.exec('SELECT asset_id, price, timestamp FROM prices WHERE asset_id = ? ORDER BY timestamp DESC LIMIT 1', [assetId]);
    if (result.length === 0 || result[0].values.length === 0) return undefined;
    const row = result[0].values[0];
    return { assetId: row[0] as string, price: row[1] as number, timestamp: row[2] as number };
  }

  getHistoricalPrices(assetId: string, fromTimestamp: number): PriceData[] {
    const result = db.exec('SELECT asset_id, price, timestamp FROM prices WHERE asset_id = ? AND timestamp >= ? ORDER BY timestamp ASC',
      [assetId, fromTimestamp]);
    if (result.length === 0) return [];
    return result[0].values.map((row: any[]) => ({
      assetId: row[0] as string, price: row[1] as number, timestamp: row[2] as number
    }));
  }

  cleanOldData(): void {
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
    db.run('DELETE FROM prices WHERE timestamp < ?', [thirtyDaysAgo]);
    saveDatabase();
  }
}

export const database = new AssetDatabase();
