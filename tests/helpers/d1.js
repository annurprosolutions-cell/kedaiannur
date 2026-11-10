// Adapter D1 ringkas atas node:sqlite untuk ujian. Meniru API yang digunakan oleh kod:
// prepare().bind().first()/all()/run(), batch() (satu transaksi) dan exec().

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCHEMA = fileURLToPath(new URL('../../db/0001_init.sql', import.meta.url));

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
    this.sqlite.exec(readFileSync(SCHEMA, 'utf8'));
    this.queries = [];
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const out = [];
      for (const s of statements) out.push(await s.all());
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
