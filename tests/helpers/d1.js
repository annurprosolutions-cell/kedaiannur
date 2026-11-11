// Adapter D1 ringkas atas node:sqlite untuk ujian. Meniru API yang digunakan oleh kod:
// prepare().bind().first()/all()/run(), batch() (satu transaksi) dan exec().

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Semua migrasi db/NNNN_*.sql mengikut urutan, sama seperti D1 sebenar selepas setiap fail dijalankan.
const DB_DIR = fileURLToPath(new URL('../../db/', import.meta.url));
const MIGRATIONS = readdirSync(DB_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

function plain(row) {
  return row ? { ...row } : null;
}

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...values) {
    for (const v of values) {
      // D1 sebenar menolak undefined; tiru supaya pepijat sama muncul dalam ujian.
      if (v === undefined) throw new Error('D1_TYPE_ERROR: Type \'undefined\' not supported');
    }
    return new Statement(this.db, this.sql, values);
  }

  _stmt() {
    this.db.queries.push(this.sql);
    return this.db.sqlite.prepare(this.sql);
  }

  async first(column) {
    const row = plain(this._stmt().get(...this.params));
    if (!row) return null;
    return column ? row[column] : row;
  }

  async all() {
    const results = this._stmt().all(...this.params).map(plain);
    return { success: true, results, meta: {} };
  }

  async run() {
    const stmt = this._stmt();
    if (/\breturning\b/i.test(this.sql)) {
      return { success: true, results: stmt.all(...this.params).map(plain), meta: {} };
    }
    const info = stmt.run(...this.params);
    return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
}

export class FakeD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys = ON;'); // D1 menguatkuasakan foreign key
    for (const f of MIGRATIONS) this.sqlite.exec(readFileSync(DB_DIR + f, 'utf8'));
    this.queries = [];
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const out = [];
      // Seperti D1: setiap hasil ada meta.changes untuk pernyataan tulis.
      for (const s of statements) out.push(/^\s*(select|with)\b/i.test(s.sql) ? await s.all() : await s.run());
      this.sqlite.exec('COMMIT');
      return out;
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw err;
    }
  }

  async exec(sql) {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }

  // Pembantu ujian (bukan API D1)
  rows(sql, ...params) {
    return this.sqlite.prepare(sql).all(...params).map(plain);
  }
}
