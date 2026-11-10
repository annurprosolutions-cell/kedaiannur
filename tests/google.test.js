import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { verifyGoogleIdToken, TokenError } from '../lib/google.js';
import { createFakeGoogle, CLIENT_ID } from './helpers/google.js';

let g;
before(async () => {
  g = await createFakeGoogle();
  g.install();
});
after(() => g.restore());

async function rejects(token, reason) {
  await assert.rejects(verifyGoogleIdToken(token, CLIENT_ID), (err) => {
    assert.ok(err instanceof TokenError, `jangka TokenError, dapat ${err}`);
    assert.equal(err.reason, reason);
    return true;
  });
}

test('token sah dipulangkan sebagai profil, e-mel huruf kecil', async () => {
  const profile = await verifyGoogleIdToken(await g.sign(), CLIENT_ID);
  assert.deepEqual(profile, { sub: '1234567890', email: 'peniaga@gmail.com', name: 'Peniaga Ujian' });
});

test('iss tanpa https juga diterima (format lama Google)', async () => {
  const profile = await verifyGoogleIdToken(await g.sign({ iss: 'accounts.google.com' }), CLIENT_ID);
  assert.equal(profile.sub, '1234567890');
});

test('aud lain ditolak', async () => {
  await rejects(await g.sign({ aud: 'aplikasi-lain.apps.googleusercontent.com' }), 'aud');
});

test('iss lain ditolak', async () => {
  await rejects(await g.sign({ iss: 'https://evil.example.com' }), 'iss');
});

test('token tamat ditolak (lebih 60 saat lepas)', async () => {
  const now = Math.floor(Date.now() / 1000);
  await rejects(await g.sign({ iat: now - 7200, exp: now - 120 }), 'exp');
});

test('iat jauh di masa depan ditolak', async () => {
  const now = Math.floor(Date.now() / 1000);
  await rejects(await g.sign({ iat: now + 600, exp: now + 4200 }), 'iat');
});

test('email_verified palsu ditolak', async () => {
  await rejects(await g.sign({ email_verified: false }), 'email_verified');
});

test('tiada e-mel ditolak', async () => {
  await rejects(await g.sign({ email: undefined }), 'email');
});

test('payload diubah selepas tandatangan ditolak', async () => {
  const [h, , s] = (await g.sign()).split('.');
  const forged = Buffer.from(JSON.stringify({
    iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'penyerang', email: 'x@y.com',
    email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  await rejects(`${h}.${forged}.${s}`, 'signature');
});

test('tandatangan dengan kunci lain (kid sama) ditolak', async () => {
  await rejects(await g.sign({}, { signWith: g.otherPrivateKey }), 'signature');
});

test('alg none dan HS256 ditolak sebelum semakan kunci', async () => {
  const [, p] = (await g.sign()).split('.');
  const none = Buffer.from(JSON.stringify({ alg: 'none', kid: g.kid })).toString('base64url');
  await rejects(`${none}.${p}.`, 'alg');
  await rejects(await g.sign({}, { header: { alg: 'HS256' } }), 'alg');
});

test('kid tidak dikenali ditolak', async () => {
  await rejects(await g.sign({}, { header: { kid: 'kid-tiada' } }), 'kid');
});

test('token rosak ditolak dengan format', async () => {
  await rejects('bukan-token', 'format');
  await rejects('a.b.c', 'format');
  await rejects('x'.repeat(5000), 'format');
  await rejects(null, 'format');
});

test('JWKS dicache: banyak pengesahan, satu fetch sahaja', async () => {
  g.install(); // reset cache
  for (let i = 0; i < 5; i++) await verifyGoogleIdToken(await g.sign(), CLIENT_ID);
  assert.equal(g.state.jwksCalls >= 1, true);
  const calls = g.state.jwksCalls;
  await verifyGoogleIdToken(await g.sign(), CLIENT_ID);
  assert.equal(g.state.jwksCalls, calls);
});

test('JWKS gagal dimuat dibaling sebagai Error biasa (bukan TokenError) supaya jadi 500', async () => {
  g.install();
  g.state.jwksFail = true;
  try {
    await assert.rejects(verifyGoogleIdToken(await g.sign(), CLIENT_ID), (err) => !(err instanceof TokenError));
  } finally {
    g.state.jwksFail = false;
  }
});

test('tanpa GOOGLE_CLIENT_ID baling ralat konfigurasi', async () => {
  await assert.rejects(verifyGoogleIdToken(await g.sign(), ''), /GOOGLE_CLIENT_ID/);
});

test('IPD 1.4: masa pengesahan token jauh di bawah 10 ms (kunci sudah dicache)', async () => {
  const token = await g.sign();
  await verifyGoogleIdToken(token, CLIENT_ID); // panaskan cache
  const n = 200;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) await verifyGoogleIdToken(token, CLIENT_ID);
  const avg = (performance.now() - t0) / n;
  console.log(`  purata pengesahan ID token: ${avg.toFixed(3)} ms`);
  assert.ok(avg < 10, `purata ${avg} ms`);
});
