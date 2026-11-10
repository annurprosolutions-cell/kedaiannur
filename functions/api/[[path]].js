// Laluan /api/* yang tiada handler: pulangkan JSON 404 (bukan halaman HTML 404).

import { fail, MSG } from '../../lib/http.js';

export function onRequest() {
  return fail(404, 'tiada', MSG.tiada);
}
