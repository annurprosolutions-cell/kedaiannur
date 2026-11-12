// GET /artikel dan /artikel/: senarai artikel diterbitkan. /artikel dihala ke /artikel/ (URL kanonik).

import { renderIndex } from './[slug].js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  if (url.pathname === '/artikel') return Response.redirect(`${url.origin}/artikel/${url.search}`, 301);
  return renderIndex(context);
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
