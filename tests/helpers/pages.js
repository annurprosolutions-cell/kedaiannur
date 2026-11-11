// Peniru kecil penghalaan Cloudflare Pages Functions untuk ujian Node:
// functions/api/_middleware.js dijalankan dahulu, kemudian handler ikut fail dan method.
// Fail [[path]].js menjadi catch-all. Laluan dijana daripada struktur folder supaya tak terlepas.

import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FUNCTIONS_DIR = fileURLToPath(new URL('../../functions', import.meta.url));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(FUNCTIONS_DIR).filter((f) => f.endsWith('.js'));
const routes = [];
let catchAll = null;
let middleware = null;

for (const file of files) {
  const rel = relative(FUNCTIONS_DIR, file).split(sep).join('/').replace(/\.js$/, '');
  const mod = await import(pathToFileURL(file).href);
  if (rel === 'api/_middleware') middleware = mod;
  else if (rel === 'api/[[path]]') catchAll = mod;
  else {
    // index.js -> laluan folder; [id].js -> segmen dinamik (seperti penghalaan fail Pages)
    const segments = `/${rel}`.replace(/\/index$/, '').split('/').slice(1);
    routes.push({ path: `/${segments.join('/')}`, segments, dynamic: segments.some((x) => /^\[\w+\]$/.test(x)), mod });
  }
}
// Laluan statik didahulukan, sama seperti keutamaan Pages.
routes.sort((a, b) => Number(a.dynamic) - Number(b.dynamic));

function matchRoute(pathname, method) {
  const parts = pathname.split('/').slice(1);
  for (const r of routes) {
    if (r.segments.length !== parts.length) continue;
    const params = {};
    const ok = r.segments.every((seg, i) => {
      const m = /^\[(\w+)\]$/.exec(seg);
      if (m) {
        params[m[1]] = decodeURIComponent(parts[i]);
        return true;
      }
      return seg === parts[i];
    });
    if (ok && pickHandler(r.mod, method)) return { route: r, params };
  }
  return null;
}

export const routePaths = routes.map((r) => r.path);

function pickHandler(mod, method) {
  if (!mod) return null;
  const name = `onRequest${method[0]}${method.slice(1).toLowerCase()}`;
  return mod[name] || mod.onRequest || null;
}

export async function callApi(env, method, path, { headers = {}, body, origin = 'https://kedai.test' } = {}) {
  const init = { method, headers: { ...headers } };
  if (origin && !('Origin' in init.headers)) init.headers.Origin = origin;
  if (origin === null) delete init.headers.Origin;
  if (body !== undefined) {
    const binary = body instanceof Uint8Array || body instanceof ArrayBuffer;
    init.body = binary || typeof body === 'string' ? body : JSON.stringify(body);
    if (!binary && !('Content-Type' in init.headers)) init.headers['Content-Type'] = 'application/json';
  }
  const request = new Request(`https://kedai.test${path}`, init);
  const match = matchRoute(new URL(request.url).pathname, method);
  const handler = match ? pickHandler(match.route.mod, method) : pickHandler(catchAll, method);

  const chain = [...[].concat(middleware.onRequest), handler];
  let i = 0;
  const pending = [];
  const context = {
    request, env, data: {}, params: match ? match.params : {},
    waitUntil(p) {
      pending.push(p);
    },
    passThroughOnException() {},
  };
  context.next = async () => chain[i++](context);
  const res = await context.next();
  await Promise.all(pending); // kerja waitUntil (contoh pembersihan R2) selesai sebelum ujian menyemak
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* bukan JSON */
  }
  return { status: res.status, headers: res.headers, json, text };
}

export function cookieFrom(res) {
  const set = res.headers.get('set-cookie') || '';
  const m = /__Host-sid=([^;]*)/.exec(set);
  return m ? m[1] : null;
}
