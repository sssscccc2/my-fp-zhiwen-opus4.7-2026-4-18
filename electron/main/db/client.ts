import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic, Statement, SqlValue } from 'sql.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#1677ff',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS proxies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT,
  password TEXT,
  notes TEXT,
  -- JSON: { mode: 'proxy'|'custom', customServer?: string, customLabel?: string }
  dns_config TEXT,
  last_tested_at INTEGER,
  last_test_ip TEXT,
  last_test_country TEXT,
  last_test_latency_ms INTEGER,
  last_test_ok INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_id TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  fingerprint_config TEXT NOT NULL,
  proxy_id TEXT,
  user_data_dir TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_opened_at INTEGER,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_profiles_group ON profiles(group_id);
CREATE INDEX IF NOT EXISTS idx_profiles_proxy ON profiles(proxy_id);
CREATE INDEX IF NOT EXISTS idx_profiles_name ON profiles(name);
`;

let SQL: SqlJsStatic | null = null;
let dbInstance: Database | null = null;
let dbPath: string | null = null;
let saveTimer: NodeJS.Timeout | null = null;

function findWasmPath(): string | undefined {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

export async function initDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;

  if (!SQL) {
    const wasmPath = findWasmPath();
    SQL = await initSqlJs({
      locateFile: (file: string) => {
        if (wasmPath) return wasmPath;
        return file;
      },
    });
  }

  const userDataPath = app.getPath('userData');
  const dataDir = path.join(userDataPath, 'data');
  mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, 'fingerprint-browser.db');

  if (existsSync(dbPath)) {
    try {
      const buf = readFileSync(dbPath);
      dbInstance = new SQL.Database(new Uint8Array(buf));
    } catch (err) {
      console.error('Failed to load existing db, recreating:', err);
      dbInstance = new SQL.Database();
    }
  } else {
    dbInstance = new SQL.Database();
  }

  dbInstance.exec(SCHEMA);
  runMigrations(dbInstance);
  scheduleSave();
  return dbInstance;
}

/**
 * Idempotent migrations for additive column changes. CREATE TABLE IF NOT EXISTS
 * does NOT add new columns to existing tables — we have to ALTER manually.
 *
 * Each migration is wrapped in try/catch since SQLite throws on duplicate
 * column adds, which we treat as "already migrated".
 */
function runMigrations(db: Database): void {
  const safeExec = (sql: string, label: string) => {
    try { db.exec(sql); } catch (err) {
      const msg = (err as Error).message ?? '';
      if (!/duplicate column|already exists/i.test(msg)) {
        console.warn('[db] migration warn:', label, msg);
      }
    }
  };
  // 2026-04-17: per-proxy DNS routing config
  safeExec('ALTER TABLE proxies ADD COLUMN dns_config TEXT', 'add proxies.dns_config');
}

export function getDb(): Database {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 200);
}

export function saveNow(): void {
  if (!dbInstance || !dbPath) return;
  try {
    const data = dbInstance.export();
    const tmp = dbPath + '.tmp';
    writeFileSync(tmp, Buffer.from(data));
    renameSync(tmp, dbPath);
  } catch (err) {
    console.error('Failed to save DB:', err);
  }
}

export function closeDatabase(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveNow();
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// ----- Helper API: synchronous wrappers around sql.js statements -----

export type Params = Record<string, unknown> | unknown[];

function normalize(value: unknown): SqlValue {
  if (value === undefined || value === null) return null as unknown as SqlValue;
  if (typeof value === 'boolean') return (value ? 1 : 0) as unknown as SqlValue;
  if (value instanceof Uint8Array) return value as unknown as SqlValue;
  if (typeof value === 'string' || typeof value === 'number') return value as SqlValue;
  return String(value) as SqlValue;
}

function bindStatement(stmt: Statement, params?: Params): void {
  if (!params) return;
  if (Array.isArray(params)) {
    stmt.bind(params.map(normalize) as SqlValue[]);
    return;
  }
  const named: Record<string, SqlValue> = {};
  for (const [k, v] of Object.entries(params)) {
    const key = k.startsWith('@') || k.startsWith(':') || k.startsWith('$') ? k : '@' + k;
    named[key] = normalize(v);
  }
  stmt.bind(named);
}

export function run(sql: string, params?: Params): void {
  const db = getDb();
  const stmt = db.prepare(sql);
  try {
    bindStatement(stmt, params);
    stmt.step();
  } finally {
    stmt.free();
  }
  scheduleSave();
}

export function all<T = Record<string, unknown>>(sql: string, params?: Params): T[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  const rows: T[] = [];
  try {
    bindStatement(stmt, params);
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
  } finally {
    stmt.free();
  }
  return rows;
}

export function get<T = Record<string, unknown>>(sql: string, params?: Params): T | null {
  const rows = all<T>(sql, params);
  return rows[0] ?? null;
}
