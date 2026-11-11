// Semakan fail statik Pages: _routes.json sah dan setiap fail statik di akar dikecualikan
// daripada Functions (supaya tak mengira dalam kuota 100,000 request sehari).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const routes = JSON.parse(readFileSync(join(PUBLIC, '_routes.json'), 'utf8'));

test('_routes.json ikut had Cloudflare (versi 1, maksimum 100 peraturan, 100 aksara setiap satu)', () => {
  assert.equal(routes.version, 1);
  const rules = [...routes.include, ...routes.exclude];
  assert.ok(rules.length <= 100, `${rules.length} peraturan`);
  for (const r of rules) {
    assert.ok(r.startsWith('/'), r);
    assert.ok(r.length <= 100, r);
  }
  assert.ok(routes.include.includes('/*'), 'laluan kedai /<slug> perlukan Functions');
});

test('setiap fail dan folder statik di akar public/ dikecualikan', () => {
  const special = new Set(['_routes.json', '_headers', '_redirects']);
  for (const name of readdirSync(PUBLIC)) {
    if (special.has(name)) continue;
    if (statSync(join(PUBLIC, name)).isDirectory()) {
      assert.ok(routes.exclude.includes(`/${name}/*`), `tambah "/${name}/*" ke exclude`);
    } else if (name === 'index.html') {
      assert.ok(routes.exclude.includes('/'));
    } else {
      assert.ok(routes.exclude.includes(`/${name}`), `tambah "/${name}" ke exclude`);
      // Pages menukar /x.html kepada /x (308): bentuk tanpa .html mesti dikecualikan juga, jika tidak ia jatuh ke Functions
      // sebagai slug kedai dan memberi 404.
      if (name.endsWith('.html') && !['404.html'].includes(name)) {
        assert.ok(routes.exclude.includes(`/${name.slice(0, -5)}`), `tambah "/${name.slice(0, -5)}" ke exclude`);
      }
    }
  }
});

test('_headers ada CSP ketat untuk skrip (tiada unsafe-inline/eval) dan header asas', () => {
  const headers = readFileSync(join(PUBLIC, '_headers'), 'utf8');
  const csp = /Content-Security-Policy: (.+)/.exec(headers)[1];
  const scriptSrc = /script-src ([^;]+)/.exec(csp)[1];
  assert.ok(!scriptSrc.includes('unsafe'), scriptSrc);
  assert.ok(csp.includes("frame-ancestors 'none'"));
  for (const h of ['X-Content-Type-Options: nosniff', 'Referrer-Policy: strict-origin-when-cross-origin']) {
    assert.ok(headers.includes(h), h);
  }
});

test('HTML statik tiada skrip inline (CSP akan sekat)', () => {
  const htmlFiles = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.html')) htmlFiles.push(p);
    }
  };
  walk(PUBLIC);
  for (const f of htmlFiles) {
    const html = readFileSync(f, 'utf8');
    // Blok data JSON (type="application/json") tak dilaksanakan, jadi dibenarkan oleh CSP.
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>/g)];
    assert.equal(inline.length, 0, `${f} ada skrip inline`);
    assert.ok(!/\son[a-z]+=/i.test(html), `${f} ada atribut on*`);
  }
});
