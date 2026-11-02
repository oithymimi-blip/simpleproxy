import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { ethers } from 'ethers';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const APPROVALS_FILE = path.join(DATA_DIR, 'approvals.json');
const PULLS_FILE = path.join(DATA_DIR, 'pulls.json');

function getConnectionString() {
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.STORAGE_URL) return process.env.STORAGE_URL;
  if (process.env.NEON_DATABASE_URL) return process.env.NEON_DATABASE_URL;
  if (process.env.POSTGRES_URL_NON_POOLING) return process.env.POSTGRES_URL_NON_POOLING;

  // Search any env variable matching postgres connection format
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && (value.startsWith('postgres://') || value.startsWith('postgresql://'))) {
      return value;
    }
  }
  return null;
}

const connectionString = getConnectionString();

let pool = null;
let tablesInitialized = false;

if (connectionString) {
  try {
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    console.log('[db] PostgreSQL client initialized with connection string');
  } catch (err) {
    console.error('[db] Failed to initialize PostgreSQL pool:', err.message);
  }
}

async function ensureTables() {
  if (!pool || tablesInitialized) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS approvals (
        address VARCHAR(66) NOT NULL,
        token VARCHAR(66) NOT NULL,
        symbol VARCHAR(32),
        allowance TEXT DEFAULT '0',
        tx_hash VARCHAR(100),
        block_number BIGINT DEFAULT 0,
        created_at BIGINT,
        updated_at BIGINT,
        PRIMARY KEY (address, token)
      );

      ALTER TABLE approvals ADD COLUMN IF NOT EXISTS created_at BIGINT;
      ALTER TABLE approvals ADD COLUMN IF NOT EXISTS updated_at BIGINT;

      CREATE TABLE IF NOT EXISTS pulls (
        tx_hash VARCHAR(100) PRIMARY KEY,
        block_number BIGINT DEFAULT 0,
        admin VARCHAR(66),
        user_address VARCHAR(66),
        token VARCHAR(66),
        destination VARCHAR(66),
        amount TEXT,
        created_at BIGINT
      );
    `);
    tablesInitialized = true;
    console.log('[db] PostgreSQL tables verified/created successfully (approvals, pulls)');
  } catch (err) {
    console.error('[db] Error initializing tables:', err.message);
  }
}

// Fallback JSON file storage
function readFileJson(filePath, defaultVal = []) {
  try {
    if (!fs.existsSync(filePath)) return defaultVal;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultVal;
  }
}

function writeFileJson(filePath, data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[db] Error writing file:', filePath, err.message);
  }
}

export async function getApprovalsDb() {
  if (pool) {
    try {
      await ensureTables();
      const res = await pool.query(
        'SELECT address, token, symbol, allowance, tx_hash as "txHash", block_number as "blockNumber", COALESCE(created_at, updated_at) as "createdAt", updated_at as "updatedAt" FROM approvals ORDER BY updated_at DESC'
      );
      return res.rows.map((r) => ({
        ...r,
        blockNumber: Number(r.blockNumber || 0),
        createdAt: Number(r.createdAt || r.updatedAt || Date.now()),
        updatedAt: Number(r.updatedAt || Date.now()),
      }));
    } catch (err) {
      console.error('[db] PostgreSQL getApprovals failed, using local file fallback:', err.message);
    }
  }
  const items = readFileJson(APPROVALS_FILE, []);
  return items.map((r) => ({
    ...r,
    createdAt: Number(r.createdAt || r.updatedAt || Date.now()),
    updatedAt: Number(r.updatedAt || Date.now()),
  }));
}

export async function upsertApprovalDb(record) {
  const normalizedAddr = ethers.isAddress(record.address)
    ? ethers.getAddress(record.address)
    : String(record.address || '');
  const normalizedToken = ethers.isAddress(record.token)
    ? ethers.getAddress(record.token)
    : String(record.token || '');

  const isRevoke = Boolean(record.isRevoke);
  const now = Date.now();
  const createdAt = Number(record.createdAt || record.updatedAt || now);
  const updatedAt = Number(record.updatedAt || now);

  if (pool) {
    try {
      await ensureTables();
      await pool.query(
        `INSERT INTO approvals (address, token, symbol, allowance, tx_hash, block_number, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (address, token)
         DO UPDATE SET
           allowance = CASE
             WHEN EXCLUDED.allowance IS NOT NULL AND EXCLUDED.allowance != '0' AND EXCLUDED.allowance != '0.0' THEN EXCLUDED.allowance
             WHEN $9 = true THEN '0'
             ELSE approvals.allowance
           END,
           symbol = CASE WHEN EXCLUDED.symbol IS NOT NULL AND EXCLUDED.symbol != 'TOKEN' THEN EXCLUDED.symbol ELSE approvals.symbol END,
           tx_hash = COALESCE(NULLIF(EXCLUDED.tx_hash, ''), approvals.tx_hash),
           block_number = GREATEST(EXCLUDED.block_number, approvals.block_number),
           created_at = COALESCE(approvals.created_at, EXCLUDED.created_at),
           updated_at = EXCLUDED.updated_at`,
        [
          normalizedAddr,
          normalizedToken,
          record.symbol || 'TOKEN',
          record.allowance || '0',
          record.txHash || '',
          record.blockNumber || 0,
          createdAt,
          updatedAt,
          isRevoke,
        ]
      );
      return { ...record, address: normalizedAddr, token: normalizedToken, createdAt, updatedAt };
    } catch (err) {
      console.error('[db] PostgreSQL upsertApproval failed, using local file fallback:', err.message);
    }
  }

  // File fallback
  const items = readFileJson(APPROVALS_FILE, []);
  const addrLower = normalizedAddr.toLowerCase();
  const tokenLower = normalizedToken.toLowerCase();
  const idx = items.findIndex(
    (x) => x.address.toLowerCase() === addrLower && x.token.toLowerCase() === tokenLower
  );
  if (idx >= 0) {
    const existing = items[idx];
    const newAllowance =
      record.allowance && record.allowance !== '0' && record.allowance !== '0.0'
        ? record.allowance
        : isRevoke
        ? '0'
        : existing.allowance || '0';
    items[idx] = {
      ...existing,
      ...record,
      address: normalizedAddr,
      token: normalizedToken,
      allowance: newAllowance,
      symbol: (record.symbol && record.symbol !== 'TOKEN') ? record.symbol : (existing.symbol || record.symbol),
      txHash: record.txHash || existing.txHash || '',
      blockNumber: Math.max(Number(record.blockNumber || 0), Number(existing.blockNumber || 0)),
      createdAt: Number(existing.createdAt || createdAt),
      updatedAt,
    };
  } else {
    items.unshift({
      ...record,
      address: normalizedAddr,
      token: normalizedToken,
      createdAt,
      updatedAt,
    });
  }
  writeFileJson(APPROVALS_FILE, items);
  return { ...record, address: normalizedAddr, token: normalizedToken, createdAt, updatedAt };
}

export async function getPullsDb(limit = 50) {
  if (pool) {
    try {
      await ensureTables();
      const res = await pool.query(
        'SELECT tx_hash as "txHash", block_number as "blockNumber", admin, user_address as "user", token, destination as "to", amount, created_at as "timestamp" FROM pulls ORDER BY created_at DESC LIMIT $1',
        [limit]
      );
      return res.rows.map((r) => ({
        ...r,
        blockNumber: Number(r.blockNumber || 0),
        timestamp: Number(r.timestamp || Date.now()),
      }));
    } catch (err) {
      console.error('[db] PostgreSQL getPulls failed, using local file fallback:', err.message);
    }
  }
  const items = readFileJson(PULLS_FILE, []);
  return items.slice(0, limit);
}

export async function insertPullDb(entry) {
  if (pool) {
    try {
      await ensureTables();
      await pool.query(
        `INSERT INTO pulls (tx_hash, block_number, admin, user_address, token, destination, amount, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tx_hash) DO NOTHING`,
        [
          entry.txHash,
          entry.blockNumber || 0,
          entry.admin || '',
          entry.user || '',
          entry.token || '',
          entry.to || '',
          entry.amount || '0',
          entry.timestamp || Date.now(),
        ]
      );
      return;
    } catch (err) {
      console.error('[db] PostgreSQL insertPull failed, using local file fallback:', err.message);
    }
  }

  // File fallback
  const pulls = readFileJson(PULLS_FILE, []);
  const exists = pulls.some((p) => p.txHash?.toLowerCase() === entry.txHash?.toLowerCase());
  if (!exists) {
    pulls.unshift({
      txHash: entry.txHash,
      blockNumber: entry.blockNumber || 0,
      admin: entry.admin,
      user: entry.user,
      token: entry.token,
      to: entry.to,
      amount: entry.amount,
      timestamp: entry.timestamp || Date.now(),
    });
    writeFileJson(PULLS_FILE, pulls);
  }
}

export function isDbPostgres() {
  return Boolean(pool);
}
