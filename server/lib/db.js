import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db;

export function getDb() {
  if (db) return db;
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function migrate() {
  const d = getDb();
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  d.exec(schema);
}

let txDepth = 0;

/** Run fn inside a transaction; re-entrant (nested calls join the outer transaction). */
export function tx(fn) {
  const d = getDb();
  if (txDepth > 0) {
    // Join the enclosing transaction; its COMMIT/ROLLBACK governs.
    txDepth += 1;
    try {
      return fn(d);
    } finally {
      txDepth -= 1;
    }
  }
  d.exec('BEGIN IMMEDIATE');
  txDepth = 1;
  try {
    const result = fn(d);
    d.exec('COMMIT');
    return result;
  } catch (err) {
    try { d.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  } finally {
    txDepth = 0;
  }
}

export function now() {
  return new Date().toISOString();
}

/** Query helpers returning plain objects (node:sqlite returns null-prototype rows). */
export function all(sql, ...params) {
  return getDb().prepare(sql).all(...params).map((r) => ({ ...r }));
}

export function get(sql, ...params) {
  const row = getDb().prepare(sql).get(...params);
  return row ? { ...row } : undefined;
}

export function run(sql, ...params) {
  return getDb().prepare(sql).run(...params);
}
