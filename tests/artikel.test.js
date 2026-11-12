// Artikel diurus superadmin: Markdown selamat, pengesahan, API admin, halaman awam /artikel, sitemap, RSS dan gambar R2.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callApi } from './helpers/pages.js';
import { makeEnv, makeUser } from './helpers/seed.js';
import { fakeJpeg, fakeWebp } from './helpers/r2.js';
import { normalizeArticle, renderMarkdown, seoChecks, slugify } from '../public/assets/js/artikel.js';
import { sweepArticleImages } from '../lib/articles.js';
import { myDate } from '../lib/articlepage.js';

const TEMPLATE = readFileSync(new URL('../public/article.html', import.meta.url), 'utf8');
let env;
let admin;
let user;

beforeEach(async () => {
  env = makeEnv({ MEDIA_BASE_URL: 'https://media.test' });
  env.ASSETS = { fetch: async (url) => (new URL(url).pathname === '/article' ? new Response(TEMPLATE) : new Response('tiada', { status: 404 })) };
  admin = await makeUser(env, 'm', { email: 'admin@annurpro.test' });
  user = await makeUser(env, 'u');
});

const page = (path, headers = {}) => callApi(env, 'GET', path, { origin: null, headers });
const create = (body, who = admin) => callApi(env, 'POST', '/api/admin/articles', { headers: who.headers, body });
const patch = (id, body) => callApi(env, 'PATCH', `/api/admin/articles/${id}`, { headers: admin.headers, body });
const BODY = 'Perenggan pertama tentang katalog online.\n\n## Bahagian satu\n\nIsi.\n\n## Bahagian dua\n\nRujuk [artikel lain](/artikel/katalog-online-order-whatsapp).';
const ART = { title: 'Panduan katalog online untuk kedai kuih', description: 'Cara mudah membina katalog online untuk kedai kuih dan menerima order melalui WhatsApp setiap hari.', body: BODY, focusKeyword: 'katalog online' };

test('Markdown: teks di-escape, hanya tag dibenarkan, pautan dan gambar berbahaya dibuang', () => {
  const md = renderMarkdown('<script>alert(1)</script> & "x"\n\n## Tajuk <b>\n\n## Tajuk <b>\n\n[jahat](javascript:alert(1)) [luar](https://contoh.com/a?b=1&c=2) [dalam](/app/)\n\n![alt](javascript:x)\n\n![Kuih "sedap"](https://media.test/articles/a.webp "Kapsyen *ini*")\n\n- satu\n- **dua**\n\n1. a\n2. b\n\n> petikan\n\n---\n\n`<kod>` dan *condong* dan _juga_');
  assert.ok(!md.html.includes('<script>'));
  assert.ok(md.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;'));
  assert.deepEqual(md.headings.map((x) => x.id), ['tajuk-b', 'tajuk-b-2']);
  assert.ok(!md.html.includes('javascript:'), 'tiada skema javascript:');
  assert.ok(md.html.includes('<a href="https://contoh.com/a?b=1&amp;c=2" rel="noopener" target="_blank">luar</a>'));
  assert.ok(md.html.includes('<a href="/app/">dalam</a>'));
  assert.ok(md.html.includes('<figure><img src="https://media.test/articles/a.webp" alt="Kuih &quot;sedap&quot;" loading="lazy" decoding="async"><figcaption>Kapsyen <em>ini</em></figcaption></figure>'));
  assert.equal(md.images.length, 1, 'gambar src tak sah tidak dikira');
  assert.ok(md.html.includes('<ul><li>satu</li><li><strong>dua</strong></li></ul>'));
  assert.ok(md.html.includes('<ol><li>a</li><li>b</li></ol>'));
  assert.ok(md.html.includes('<blockquote><p>petikan</p></blockquote>'));
  assert.ok(md.html.includes('<hr>'));
  assert.ok(md.html.includes('<code>&lt;kod&gt;</code> dan <em>condong</em> dan <em>juga</em>'));
  assert.equal(slugify('Cara Buat Katalog & Kedai Café!'), 'cara-buat-katalog-dan-kedai-cafe');
});

test('pengesahan: tajuk, slug automatik, slug dikhaskan, terbit perlukan description dan kandungan', () => {
  assert.ok(normalizeArticle({ title: 'abc' }).errors.title);
  assert.equal(normalizeArticle({ title: 'Tajuk yang cukup' }).value.slug, 'tajuk-yang-cukup');
  assert.equal(normalizeArticle({ title: 'Tajuk yang cukup', slug: 'Slug Saya!' }).value.slug, 'slug-saya');
  assert.ok(normalizeArticle({ title: 'Tajuk yang cukup', slug: 'rss' }).errors.slug);
  const pub = normalizeArticle({ title: 'Tajuk yang cukup', status: 'published' }).errors;
  assert.ok(pub.description && pub.body);
  assert.ok(normalizeArticle({ title: 'Tajuk yang cukup', coverKey: 'shops/x/l_a.webp' }).errors.coverKey, 'hanya kunci articles/');
  const checks = seoChecks({ ...ART, slug: 'katalog-online-kuih' });
  assert.ok(checks.find((c) => c.label === 'Kata kunci dalam slug').ok);
  assert.ok(checks.find((c) => c.label === 'Kata kunci dalam perenggan pertama').ok);
  assert.ok(!checks.find((c) => c.label === 'Gambar utama').ok);
});

test('5 artikel asal dimasukkan oleh migrasi dan dihidang dari D1', async () => {
  const idx = await page('/artikel/');
  assert.equal(idx.status, 200);
  assert.equal((idx.text.match(/class="card article-card"/g) || []).length, 5);
  assert.ok(idx.text.includes('<link rel="canonical" href="https://kedai.test/artikel/">'));
  const res = await page('/artikel/katalog-online-order-whatsapp');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('<h1>Cara buat katalog online yang order terus ke WhatsApp</h1>'));
  assert.ok(res.text.includes('<link rel="canonical" href="https://kedai.test/artikel/katalog-online-order-whatsapp">'));
  assert.ok(res.text.includes('<h2 id="1-tentukan-apa-yang-pelanggan-perlu-tahu">'));
  assert.ok(res.text.includes('href="/artikel/tips-gambar-produk-guna-phone"'), 'pautan dalaman kekal');
  assert.ok(res.text.includes('"@type":"BlogPosting"'));
  assert.ok(res.text.includes('<meta property="og:type" content="article">'));
  assert.ok(res.text.includes('class="article-toc'), 'kandungan bila 3 subtajuk ke atas');
  assert.ok(res.text.includes('Artikel lain'));
  assert.match(res.headers.get('content-security-policy'), /img-src [^;]*https:/);
  assert.ok(!/script-src [^;]*unsafe/.test(res.headers.get('content-security-policy')));
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
  assert.ok(!res.text.includes('<!--HEAD-->') && !res.text.includes('<!--MAIN-->'));
  assert.equal(myDate('2026-11-12 20:00:00'), '13/11/2026', 'tarikh dalam waktu Malaysia');
});

test('laluan: /artikel ke /artikel/, .html lama dan huruf besar ke URL kanonik, tiada = 404 noindex', async () => {
  const r1 = await page('/artikel');
  assert.equal(r1.status, 301);
  assert.equal(r1.headers.get('location'), 'https://kedai.test/artikel/');
  const r2 = await page('/artikel/Kod-QR-untuk-gerai-dan-kaunter.html');
  assert.equal(r2.status, 301);
  assert.equal(r2.headers.get('location'), 'https://kedai.test/artikel/kod-qr-untuk-gerai-dan-kaunter');
  const r3 = await page('/artikel/tiada-artikel-ini');
  assert.equal(r3.status, 404);
  assert.ok(r3.text.includes('<meta name="robots" content="noindex">'));
  assert.ok(r3.text.includes('Artikel tak dijumpai'));
});

test('API admin: hanya superadmin; draf tersembunyi dari awam tetapi boleh dipratonton superadmin; terbit muncul di semua tempat', async () => {
  assert.equal((await create(ART, user)).status, 403);
  assert.equal((await callApi(env, 'GET', '/api/admin/articles', { headers: user.headers })).status, 403);

  const c = await create(ART);
  assert.equal(c.status, 201);
  const a = c.json.article;
  assert.equal(a.slug, 'panduan-katalog-online-untuk-kedai-kuih');
  assert.equal(a.status, 'draft');
  assert.equal(a.publishedAt, null);
  assert.equal((await page(`/artikel/${a.slug}`)).status, 404, 'draf: awam tak nampak');
  const pv = await page(`/artikel/${a.slug}`, admin.headers);
  assert.equal(pv.status, 200);
  assert.ok(pv.text.includes('DRAF: belum diterbitkan'));
  assert.ok(pv.text.includes('<meta name="robots" content="noindex, follow">'));
  assert.equal(pv.headers.get('cache-control'), 'private, no-store');
  assert.equal((await page(`/artikel/${a.slug}`, user.headers)).status, 404, 'pengguna biasa tak nampak draf');

  const p = await patch(a.id, { ...ART, status: 'published', featured: true });
  assert.equal(p.status, 200);
  assert.ok(p.json.article.publishedAt);
  const pub = await page(`/artikel/${a.slug}`);
  assert.equal(pub.status, 200);
  assert.ok(pub.text.includes('<meta name="robots" content="index, follow, max-image-preview:large">'));
  const api = await callApi(env, 'GET', '/api/articles?limit=3', { origin: null });
  assert.equal(api.status, 200);
  assert.equal(api.json.articles[0].slug, a.slug, 'artikel Pilihan didahulukan');
  assert.equal(api.json.articles.length, 3);
  assert.ok(!('body' in api.json.articles[0]) && !('focusKeyword' in api.json.articles[0]));
  assert.ok((await page('/sitemap.xml')).text.includes(`<loc>https://kedai.test/artikel/${a.slug}</loc>`));
  assert.ok((await page('/artikel/rss.xml')).text.includes(`<link>https://kedai.test/artikel/${a.slug}</link>`));

  // noindex: kekal boleh dibuka tetapi keluar dari sitemap dan RSS.
  await patch(a.id, { noindex: true });
  assert.ok((await page(`/artikel/${a.slug}`)).text.includes('<meta name="robots" content="noindex, follow">'));
  assert.ok(!(await page('/sitemap.xml')).text.includes(a.slug));
  assert.ok(!(await page('/artikel/rss.xml')).text.includes(a.slug));

  // Tarik balik ke draf: tarikh terbit asal kekal, awam 404.
  const back = await patch(a.id, { status: 'draft' });
  assert.equal(back.json.article.publishedAt, p.json.article.publishedAt);
  assert.equal((await page(`/artikel/${a.slug}`)).status, 404);
  const audit = env.DB.sqlite.prepare("SELECT action FROM audit_log WHERE action LIKE 'article_%' ORDER BY id").all().map((r) => r.action);
  assert.deepEqual(audit, ['article_create', 'article_publish', 'article_update', 'article_unpublish']);
});

test('slug bertembung 409; tukar slug; terbit tanpa description ditolak dengan mesej medan', async () => {
  const dup = await create({ ...ART, slug: 'katalog-online-order-whatsapp' });
  assert.equal(dup.status, 409);
  assert.ok(dup.json.fields.slug);
  const bad = await create({ title: 'Artikel tanpa ringkasan', body: 'x', status: 'published' });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.fields.description);
  const a = (await create(ART)).json.article;
  const r = await patch(a.id, { slug: 'Slug Baru Saya' });
  assert.equal(r.json.article.slug, 'slug-baru-saya');
  assert.equal((await patch(a.id, { slug: 'kod-qr-untuk-gerai-dan-kaunter' })).status, 409);
  assert.equal((await patch('tiada', { title: 'Apa-apa sahaja' })).status, 404);
  const big = await create({ ...ART, body: 'x'.repeat(230 * 1024) });
  assert.equal(big.status, 413);
});

test('gambar: muat naik superadmin sahaja, kunci articles/, gambar utama mesti wujud, padam artikel membuang gambarnya', async () => {
  const up = (kind, bytes, who = admin, type = 'image/jpeg') => callApi(env, 'POST', `/api/admin/upload?kind=${kind}`, { headers: { ...who.headers, 'Content-Type': type }, body: bytes });
  assert.equal((await up('cover', fakeJpeg(), user)).status, 403);
  assert.equal((await up('logo', fakeJpeg())).status, 400);
  assert.equal((await up('cover', fakeJpeg(), admin, 'image/webp')).status, 415, 'bait tak sepadan dengan jenis');
  assert.equal((await up('cover', fakeJpeg(301 * 1024))).status, 413);
  const cover = await up('cover', fakeJpeg());
  assert.equal(cover.status, 200);
  assert.match(cover.json.key, /^articles\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(cover.json.url, `https://media.test/${cover.json.key}`);
  const inline = (await up('inline', fakeWebp(), admin, 'image/webp')).json;

  assert.equal((await create({ ...ART, coverKey: 'articles/00000000-0000-4000-8000-000000000000.webp' })).status, 400, 'gambar tiada dalam R2');
  const a = (await create({ ...ART, status: 'published', coverKey: cover.json.key, coverAlt: 'Kuih', body: `${BODY}\n\n![Gambar](${inline.url})` })).json.article;
  const res = await page(`/artikel/${a.slug}`);
  assert.ok(res.text.includes(`<meta property="og:image" content="https://media.test/${cover.json.key}">`));
  assert.ok(res.text.includes('class="article-cover"'));
  assert.ok((await page('/artikel/')).text.includes(`src="https://media.test/${cover.json.key}"`));

  // Gambar yatim lama dibersihkan; gambar yang dirujuk kekal.
  const orphan = (await up('inline', fakeJpeg())).json.key;
  for (const k of [orphan, cover.json.key, inline.key]) env.MEDIA.age(k, 7 * 3600 * 1000);
  assert.equal(await sweepArticleImages(env), 1);
  assert.ok(!env.MEDIA.objects.has(orphan));
  assert.ok(env.MEDIA.objects.has(cover.json.key) && env.MEDIA.objects.has(inline.key));

  assert.equal((await callApi(env, 'DELETE', `/api/admin/articles/${a.id}`, { headers: admin.headers, body: {} })).status, 200);
  assert.ok(!env.MEDIA.objects.has(cover.json.key) && !env.MEDIA.objects.has(inline.key), 'gambar artikel dipadam');
  assert.equal((await page(`/artikel/${a.slug}`)).status, 404);
});

test('menu: tab Artikel ada pada sale page dan halaman awam lain; seksyen Artikel terkini di landing page', () => {
  for (const f of ['index.html', 'marketplace.html', 'privasi.html', 'terma.html', 'article.html']) {
    const html = readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
    const nav = /<nav class="site-nav"[^>]*>([\s\S]*?)<\/nav>/.exec(html)[1];
    assert.ok(nav.includes('<a href="/artikel/">Artikel</a>'), `${f}: tab Artikel dalam menu utama`);
    const menu = /<div class="menu-panel"[^>]*>([\s\S]*?)<\/div>/.exec(html)[1];
    assert.ok(menu.includes('<a href="/artikel/">Artikel</a>'), `${f}: menu phone`);
  }
  const home = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(home.includes('data-home-articles-list'));
});
