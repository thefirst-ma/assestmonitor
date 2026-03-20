import initSqlJs from 'sql.js';
import type { Database as SqlJsDatabase } from 'sql.js';
import { DATABASE_PATH } from '../config';
import { Asset, PriceData, AssetType } from '../types';
import * as fs from 'fs';
import * as path from 'path';

let db: SqlJsDatabase;

async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs();

  const dataDir = path.dirname(DATABASE_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // 加载或创建数据库
  if (fs.existsSync(DATABASE_PATH)) {
    const buffer = fs.readFileSync(DATABASE_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // 初始化数据库表
  db.run(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
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

  // 迁移：为旧数据库添加 interval/threshold 列
  try {
    db.run(`ALTER TABLE assets ADD COLUMN interval INTEGER DEFAULT NULL;`);
  } catch {}
  try {
    db.run(`ALTER TABLE assets ADD COLUMN threshold REAL DEFAULT NULL;`);
  } catch {}

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

  addAsset(id: string, type: AssetType, symbol: string, name: string, interval?: number, threshold?: number): void {
    db.run('INSERT OR REPLACE INTO assets (id, type, symbol, name, enabled, interval, threshold) VALUES (?, ?, ?, ?, 1, ?, ?)',
      [id, type, symbol, name, interval ?? null, threshold ?? null]);
    saveDatabase();
  }

  updateAsset(id: string, interval?: number, threshold?: number): void {
    db.run('UPDATE assets SET interval = ?, threshold = ? WHERE id = ?',
      [interval ?? null, threshold ?? null, id]);
    saveDatabase();
  }

  // 移除监控资产
  removeAsset(id: string): void {
    db.run('UPDATE assets SET enabled = 0 WHERE id = ?', [id]);
    saveDatabase();
  }

  // 获取所有启用的资产
  getEnabledAssets(): Asset[] {
    const result = db.exec('SELECT id, type, symbol, name, enabled, interval, threshold FROM assets WHERE enabled = 1');
    if (result.length === 0) return [];

    const rows = result[0];
    return rows.values.map((row: any[]) => ({
      id: row[0] as string,
      type: row[1] as AssetType,
      symbol: row[2] as string,
      name: row[3] as string,
      enabled: row[4] === 1,
      interval: row[5] as number | undefined,
      threshold: row[6] as number | undefined
    }));
  }

  // 保存价格数据
  savePrice(data: PriceData): void {
    db.run('INSERT INTO prices (asset_id, price, timestamp) VALUES (?, ?, ?)',
      [data.assetId, data.price, data.timestamp]);
    saveDatabase();
  }

  // 获取最新价格
  getLatestPrice(assetId: string): PriceData | undefined {
    const result = db.exec('SELECT asset_id, price, timestamp FROM prices WHERE asset_id = ? ORDER BY timestamp DESC LIMIT 1', [assetId]);
    if (result.length === 0 || result[0].values.length === 0) return undefined;

    const row = result[0].values[0];
    return {
      assetId: row[0] as string,
      price: row[1] as number,
      timestamp: row[2] as number
    };
  }

  // 获取历史价格
  getHistoricalPrices(assetId: string, fromTimestamp: number): PriceData[] {
    const result = db.exec('SELECT asset_id, price, timestamp FROM prices WHERE asset_id = ? AND timestamp >= ? ORDER BY timestamp ASC',
      [assetId, fromTimestamp]);
    if (result.length === 0) return [];

    const rows = result[0];
    return rows.values.map((row: any[]) => ({
      assetId: row[0] as string,
      price: row[1] as number,
      timestamp: row[2] as number
    }));
  }

  // 清理旧数据（保留最近30天）
  cleanOldData(): void {
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
    db.run('DELETE FROM prices WHERE timestamp < ?', [thirtyDaysAgo]);
    saveDatabase();
  }
}

export const database = new AssetDatabase();
