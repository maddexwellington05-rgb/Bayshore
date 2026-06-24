// POST /api/logout: clear the session cookie.
import { clearSessionCookie } from '../lib/auth.mjs';
import { json } from '../lib/respond.mjs';

export default async (request, context) => {
  if (request.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' }, { allow: 'POST' });
  }

  return json(200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
};
