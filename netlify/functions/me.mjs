// GET /api/me: report whether an admin exists and whether this request is authenticated.
// Leaks no secrets: only two booleans.
import { readAdmin, isAuthed } from '../lib/auth.mjs';
import { json } from '../lib/respond.mjs';

export default async (request, context) => {
  if (request.method !== 'GET') {
    return json(405, { error: 'method_not_allowed' }, { allow: 'GET' });
  }

  const hasAdmin = !!(await readAdmin());
  const authed = await isAuthed(request);
  return json(200, { hasAdmin, authed }, { 'Cache-Control': 'no-store' });
};
